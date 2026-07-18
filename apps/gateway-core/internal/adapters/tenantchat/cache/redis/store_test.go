package redis

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"

	goredis "github.com/redis/go-redis/v9"
)

type fakeCacheClient struct {
	key   string
	field string
	value []byte
	err   error
}

func (f *fakeCacheClient) HGet(_ context.Context, key string, field string) *goredis.StringCmd {
	if f.err != nil {
		return goredis.NewStringResult("", f.err)
	}
	if key != f.key || field != f.field || len(f.value) == 0 {
		return goredis.NewStringResult("", goredis.Nil)
	}
	return goredis.NewStringResult(string(f.value), nil)
}

func (f *fakeCacheClient) Eval(_ context.Context, _ string, keys []string, args ...any) *goredis.Cmd {
	f.key = keys[0]
	f.field = args[0].(string)
	f.value = append([]byte(nil), args[1].([]byte)...)
	return goredis.NewCmdResult(int64(1), f.err)
}

func TestStoreEncryptsExactCacheWithinTenantUserNamespace(t *testing.T) {
	client := &fakeCacheClient{}
	keySets := &KeySets{byID: map[string]KeySet{
		"keys_001": {ID: "keys_001", FingerprintKey: bytesOf(1), EncryptionKey: bytesOf(2)},
	}}
	store := NewStore(client, keySets)
	store.now = func() time.Time { return time.Unix(1_700_000_000, 0).UTC() }
	store.rand = strings.NewReader("0123456789ab")
	requestContext := tenantchat.RequestContext{
		ExecutionScope: tenantchat.ExecutionScope{
			TenantID: "tenant_001", Actor: tenantchat.Actor{UserID: "user_001"},
		},
		UsageIntent: &tenantchat.UsageIntent{
			EstimatedInputTokens: 10, MaxOutputTokens: 32, RequestedTier: "standard", CacheStrategy: "exact",
		},
	}
	snapshot := tenantruntime.Snapshot{
		Digest: "sha256:synthetic", Policies: tenantruntime.Policies{Cache: tenantruntime.CachePolicy{
			Strategy: "exact", Enabled: true, TTLSeconds: 300, MaxEntriesPerUser: 10, KeySetID: "keys_001",
		}, Quota: tenantruntime.QuotaPolicy{DefaultMonthlyTokenLimit: 1_000_000}},
	}
	input := tenantchat.CompletionInput{Messages: []tenantchat.EphemeralMessage{{Role: "user", Content: "synthetic private prompt"}}, Stream: true}
	entry := tenantchat.ExactCacheEntry{
		ResponseText: "synthetic private response", EffectiveProviderID: "provider_001",
		EffectiveModelKey: "model_001", EffectiveRouteTier: "standard", SourceCostMicroUSD: 125,
	}
	if err := store.Put(context.Background(), requestContext, snapshot, input, entry); err != nil {
		t.Fatalf("put exact cache: %v", err)
	}
	originalField := client.field
	differentIntent := requestContext
	differentIntent.UsageIntent = &tenantchat.UsageIntent{
		EstimatedInputTokens: 10, MaxOutputTokens: 64, RequestedTier: "standard", CacheStrategy: "exact",
	}
	_, _, differentField, err := store.resolve(differentIntent, snapshot, input)
	if err != nil || differentField == originalField {
		t.Fatalf("usage intent must be bound into exact-cache fingerprint: field=%q err=%v", differentField, err)
	}
	differentQuota := snapshot
	differentQuota.Digest = "sha256:quota-policy-snapshot"
	differentQuota.Policies.Quota.DefaultMonthlyTokenLimit = 0
	differentQuota.Policies.Quota.EmployeeWeeklyTokenLimits = []tenantruntime.EmployeeWeeklyTokenLimit{{
		EmployeeID: "employee_001", LimitTokens: 0,
	}}
	_, _, quotaOnlyField, err := store.resolve(requestContext, differentQuota, input)
	if err != nil || quotaOnlyField != originalField {
		t.Fatalf("quota-only snapshot change must preserve exact-cache hit: field=%q err=%v", quotaOnlyField, err)
	}
	differentCache := snapshot
	differentCache.Digest = "sha256:different-cache-policy-snapshot"
	differentCache.Policies.Cache.TTLSeconds = 301
	_, _, differentCacheField, err := store.resolve(requestContext, differentCache, input)
	if err != nil || differentCacheField == originalField {
		t.Fatalf("cache policy must be bound into exact-cache fingerprint: field=%q err=%v", differentCacheField, err)
	}
	differentSafety := snapshot
	differentSafety.Digest = "sha256:different-safety-policy-snapshot"
	differentSafety.Policies.Safety.Enabled = true
	_, _, differentSafetyField, err := store.resolve(requestContext, differentSafety, input)
	if err != nil || differentSafetyField == originalField {
		t.Fatalf("entire safety policy must be bound into exact-cache fingerprint: field=%q err=%v", differentSafetyField, err)
	}
	differentModel := requestContext
	differentModel.Routing = &tenantchat.RoutingDecision{
		ModelRef:               "tc_different",
		RoutingPolicyHash:      "sha256:routing-policy",
		RoutingDecisionKeyHash: "sha256:routing-decision",
	}
	_, _, differentModelField, err := store.resolve(differentModel, snapshot, input)
	if err != nil || differentModelField == originalField {
		t.Fatalf("routed model must be bound into exact-cache fingerprint: field=%q err=%v", differentModelField, err)
	}
	differentRoutingDecision := differentModel
	differentRoutingDecision.Routing = &tenantchat.RoutingDecision{
		ModelRef:               differentModel.Routing.ModelRef,
		RoutingPolicyHash:      differentModel.Routing.RoutingPolicyHash,
		RoutingDecisionKeyHash: "sha256:other-routing-decision",
	}
	_, _, differentRoutingDecisionField, err := store.resolve(differentRoutingDecision, snapshot, input)
	if err != nil || differentRoutingDecisionField == differentModelField {
		t.Fatalf("routing decision must be bound into exact-cache fingerprint: field=%q err=%v", differentRoutingDecisionField, err)
	}
	if client.key != "tenant-chat:exact-cache:v2:tenant_001:user_001" || strings.Contains(client.key, client.field) {
		t.Fatalf("unexpected cache namespace: %q", client.key)
	}
	if strings.Contains(string(client.value), input.Messages[0].Content) || strings.Contains(string(client.value), entry.ResponseText) {
		t.Fatal("cache value exposed plaintext content")
	}
	var encoded envelope
	if err := json.Unmarshal(client.value, &encoded); err != nil || encoded.Ciphertext == "" || encoded.Nonce == "" {
		t.Fatalf("invalid encrypted envelope: %v %+v", err, encoded)
	}
	got, hit, err := store.Get(context.Background(), requestContext, snapshot, input)
	if err != nil || !hit || got != entry {
		t.Fatalf("get exact cache: hit=%t err=%v entry=%+v", hit, err, got)
	}

	client.value[len(client.value)-2] ^= 1
	if _, _, err := store.Get(context.Background(), requestContext, snapshot, input); !errors.Is(err, ErrCacheUnavailable) {
		t.Fatalf("tampered cache must fail closed, got %v", err)
	}
}

func TestStoreHitsWhenLatestTurnImmediatelyRepeatsInSameConversation(t *testing.T) {
	client := &fakeCacheClient{}
	store := NewStore(client, &KeySets{byID: map[string]KeySet{
		"keys_001": {ID: "keys_001", FingerprintKey: bytesOf(1), EncryptionKey: bytesOf(2)},
	}})
	store.now = func() time.Time { return time.Unix(1_700_000_000, 0).UTC() }
	store.rand = strings.NewReader("0123456789ab")
	snapshot := tenantruntime.Snapshot{
		Digest: "sha256:synthetic", Policies: tenantruntime.Policies{Cache: tenantruntime.CachePolicy{
			Strategy: "exact", Enabled: true, TTLSeconds: 300, MaxEntriesPerUser: 10, KeySetID: "keys_001",
		}},
	}
	initialInput := tenantchat.CompletionInput{Messages: []tenantchat.EphemeralMessage{
		{Role: "system", Content: "synthetic system context"},
		{Role: "user", Content: "repeat this exact question"},
	}, Stream: true}
	requestContext := tenantchat.RequestContext{
		ExecutionScope: tenantchat.ExecutionScope{
			TenantID: "tenant_001", Actor: tenantchat.Actor{UserID: "user_001"},
		},
		UsageIntent: &tenantchat.UsageIntent{
			EstimatedInputTokens: estimatedInputBytes(initialInput.Messages),
			MaxOutputTokens:      32, RequestedTier: "standard", CacheStrategy: "exact",
		},
	}
	entry := tenantchat.ExactCacheEntry{
		ResponseText: "synthetic private response", EffectiveProviderID: "provider_001",
		EffectiveModelKey: "model_001", EffectiveRouteTier: "standard", SourceCostMicroUSD: 125,
	}
	if err := store.Put(context.Background(), requestContext, snapshot, initialInput, entry); err != nil {
		t.Fatalf("put initial exact cache: %v", err)
	}

	repeatedInput := tenantchat.CompletionInput{Messages: []tenantchat.EphemeralMessage{
		{Role: "system", Content: "synthetic system context"},
		{Role: "user", Content: "repeat this exact question"},
		{Role: "assistant", Content: "synthetic private response"},
		{Role: "user", Content: "repeat this exact question"},
	}, Stream: true}
	repeatedContext := requestContext
	repeatedContext.UsageIntent = &tenantchat.UsageIntent{
		EstimatedInputTokens: estimatedInputBytes(repeatedInput.Messages),
		MaxOutputTokens:      32, RequestedTier: "standard", CacheStrategy: "exact",
	}
	got, hit, err := store.Get(context.Background(), repeatedContext, snapshot, repeatedInput)
	if err != nil || !hit || got != entry {
		t.Fatalf("get repeated-turn exact cache: hit=%t err=%v entry=%+v", hit, err, got)
	}

	differentInput := repeatedInput
	differentInput.Messages = append([]tenantchat.EphemeralMessage(nil), repeatedInput.Messages...)
	differentInput.Messages[len(differentInput.Messages)-1].Content = "a different question"
	if _, hit, err := store.Get(context.Background(), repeatedContext, snapshot, differentInput); err != nil || hit {
		t.Fatalf("different latest question must miss: hit=%t err=%v", hit, err)
	}

	differentContext := repeatedInput
	differentContext.Messages = append([]tenantchat.EphemeralMessage(nil), repeatedInput.Messages...)
	differentContext.Messages[0].Content = "synthetic system contexx"
	if _, hit, err := store.Get(context.Background(), repeatedContext, snapshot, differentContext); err != nil || hit {
		t.Fatalf("different earlier context must miss: hit=%t err=%v", hit, err)
	}
}

func bytesOf(value byte) []byte {
	result := make([]byte, 32)
	for index := range result {
		result[index] = value
	}
	return result
}
