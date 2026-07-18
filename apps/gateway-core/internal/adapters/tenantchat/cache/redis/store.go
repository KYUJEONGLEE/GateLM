package redis

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"

	goredis "github.com/redis/go-redis/v9"
)

const defaultKeyPrefix = "tenant-chat:exact-cache:v1"

var ErrCacheUnavailable = errors.New("tenant chat exact cache unavailable")

type Client interface {
	HGet(ctx context.Context, key string, field string) *goredis.StringCmd
	Eval(ctx context.Context, script string, keys []string, args ...any) *goredis.Cmd
}

type envelope struct {
	Version    int    `json:"version"`
	KeySetID   string `json:"keySetId"`
	ExpiresAt  int64  `json:"expiresAt"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

type fingerprintMaterial struct {
	CacheCompatibility cacheCompatibility         `json:"cacheCompatibility"`
	ModelRef           string                     `json:"modelRef,omitempty"`
	UsageIntent        *tenantchat.UsageIntent    `json:"usageIntent"`
	Input              tenantchat.CompletionInput `json:"input"`
}

// cacheCompatibility binds a cache entry to only the policy that can change
// the safety or meaning of a replayed response. Usage policy is intentionally
// excluded: a quota/budget change must block the next Provider call, not an
// already cached exact response.
type cacheCompatibility struct {
	Cache                  tenantruntime.CachePolicy  `json:"cache"`
	Safety                 tenantruntime.SafetyPolicy `json:"safety"`
	RoutingPolicyHash      string                     `json:"routingPolicyHash,omitempty"`
	RoutingDecisionKeyHash string                     `json:"routingDecisionKeyHash,omitempty"`
}

type Store struct {
	client    Client
	keySets   *KeySets
	keyPrefix string
	now       func() time.Time
	rand      io.Reader
}

func NewStore(client Client, keySets *KeySets) *Store {
	return &Store{client: client, keySets: keySets, keyPrefix: defaultKeyPrefix, now: time.Now, rand: rand.Reader}
}

func (s *Store) Get(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
	input tenantchat.CompletionInput,
) (tenantchat.ExactCacheEntry, bool, error) {
	keySet, namespace, fingerprint, err := s.resolve(requestContext, snapshot, input)
	if err != nil {
		return tenantchat.ExactCacheEntry{}, false, err
	}
	raw, err := s.client.HGet(ctx, namespace, fingerprint).Bytes()
	if errors.Is(err, goredis.Nil) {
		return tenantchat.ExactCacheEntry{}, false, nil
	}
	if err != nil {
		return tenantchat.ExactCacheEntry{}, false, ErrCacheUnavailable
	}
	var encoded envelope
	if err := json.Unmarshal(raw, &encoded); err != nil || encoded.Version != 1 || encoded.KeySetID != keySet.ID {
		return tenantchat.ExactCacheEntry{}, false, ErrCacheUnavailable
	}
	if !time.Unix(encoded.ExpiresAt, 0).After(s.now().UTC()) {
		return tenantchat.ExactCacheEntry{}, false, nil
	}
	nonce, err := base64.RawURLEncoding.DecodeString(encoded.Nonce)
	if err != nil {
		return tenantchat.ExactCacheEntry{}, false, ErrCacheUnavailable
	}
	ciphertext, err := base64.RawURLEncoding.DecodeString(encoded.Ciphertext)
	if err != nil {
		return tenantchat.ExactCacheEntry{}, false, ErrCacheUnavailable
	}
	aead, err := newGCM(keySet.EncryptionKey)
	if err != nil || len(nonce) != aead.NonceSize() {
		return tenantchat.ExactCacheEntry{}, false, ErrCacheUnavailable
	}
	plaintext, err := aead.Open(nil, nonce, ciphertext, cacheAAD(namespace, fingerprint, keySet.ID))
	if err != nil {
		return tenantchat.ExactCacheEntry{}, false, ErrCacheUnavailable
	}
	var entry tenantchat.ExactCacheEntry
	if err := json.Unmarshal(plaintext, &entry); err != nil || entry.ResponseText == "" || entry.EffectiveModelKey == "" {
		return tenantchat.ExactCacheEntry{}, false, ErrCacheUnavailable
	}
	return entry, true, nil
}

func (s *Store) Put(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
	input tenantchat.CompletionInput,
	entry tenantchat.ExactCacheEntry,
) error {
	if entry.ResponseText == "" || entry.EffectiveModelKey == "" {
		return ErrCacheUnavailable
	}
	keySet, namespace, fingerprint, err := s.resolve(requestContext, snapshot, input)
	if err != nil {
		return err
	}
	plaintext, err := json.Marshal(entry)
	if err != nil {
		return ErrCacheUnavailable
	}
	aead, err := newGCM(keySet.EncryptionKey)
	if err != nil {
		return ErrCacheUnavailable
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(s.rand, nonce); err != nil {
		return ErrCacheUnavailable
	}
	encoded := envelope{
		Version: 1, KeySetID: keySet.ID,
		ExpiresAt: s.now().UTC().Add(time.Duration(snapshot.Policies.Cache.TTLSeconds) * time.Second).Unix(),
		Nonce:     base64.RawURLEncoding.EncodeToString(nonce),
		Ciphertext: base64.RawURLEncoding.EncodeToString(aead.Seal(
			nil, nonce, plaintext, cacheAAD(namespace, fingerprint, keySet.ID),
		)),
	}
	value, err := json.Marshal(encoded)
	if err != nil {
		return ErrCacheUnavailable
	}
	if err := s.client.Eval(
		ctx, putScript, []string{namespace}, fingerprint, value,
		snapshot.Policies.Cache.MaxEntriesPerUser, snapshot.Policies.Cache.TTLSeconds,
	).Err(); err != nil {
		return ErrCacheUnavailable
	}
	return nil
}

func (s *Store) resolve(
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
	input tenantchat.CompletionInput,
) (KeySet, string, string, error) {
	if s == nil || s.client == nil || s.keySets == nil || requestContext.UsageIntent == nil ||
		requestContext.UsageIntent.CacheStrategy != "exact" || snapshot.Policies.Cache.Strategy != "exact" ||
		snapshot.Policies.Cache.TTLSeconds <= 0 || snapshot.Policies.Cache.MaxEntriesPerUser <= 0 {
		return KeySet{}, "", "", ErrCacheUnavailable
	}
	keySet, err := s.keySets.Resolve(snapshot.Policies.Cache.KeySetID)
	if err != nil {
		return KeySet{}, "", "", ErrCacheUnavailable
	}
	tenantID := strings.TrimSpace(requestContext.ExecutionScope.TenantID)
	userID := strings.TrimSpace(requestContext.ExecutionScope.Actor.UserID)
	if tenantID == "" || userID == "" {
		return KeySet{}, "", "", ErrCacheUnavailable
	}
	fingerprintInput := normalizeImmediateRepeatedTurn(input)
	fingerprintUsageIntent := *requestContext.UsageIntent
	fingerprintUsageIntent.EstimatedInputTokens = estimatedInputBytes(fingerprintInput.Messages)
	material, err := json.Marshal(fingerprintMaterial{
		CacheCompatibility: cacheCompatibility{
			Cache:                  snapshot.Policies.Cache,
			Safety:                 snapshot.Policies.Safety,
			RoutingPolicyHash:      routingPolicyHash(requestContext),
			RoutingDecisionKeyHash: routingDecisionKeyHash(requestContext),
		},
		ModelRef:    routingModelRef(requestContext),
		UsageIntent: &fingerprintUsageIntent,
		Input:       fingerprintInput,
	})
	if err != nil {
		return KeySet{}, "", "", ErrCacheUnavailable
	}
	mac := hmac.New(sha256.New, keySet.FingerprintKey)
	_, _ = mac.Write(material)
	fingerprint := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	namespace := strings.Join([]string{s.keyPrefix, tenantID, userID}, ":")
	return keySet, namespace, fingerprint, nil
}

func routingModelRef(requestContext tenantchat.RequestContext) string {
	if requestContext.Routing == nil {
		return ""
	}
	return strings.TrimSpace(requestContext.Routing.ModelRef)
}

func routingPolicyHash(requestContext tenantchat.RequestContext) string {
	if requestContext.Routing == nil {
		return ""
	}
	return strings.TrimSpace(requestContext.Routing.RoutingPolicyHash)
}

func routingDecisionKeyHash(requestContext tenantchat.RequestContext) string {
	if requestContext.Routing == nil {
		return ""
	}
	return strings.TrimSpace(requestContext.Routing.RoutingDecisionKeyHash)
}

// A repeated latest user turn should address the cache entry created before its
// assistant response was appended. Other conversation context remains bound.
func normalizeImmediateRepeatedTurn(input tenantchat.CompletionInput) tenantchat.CompletionInput {
	messages := input.Messages
	if len(messages) < 3 || messages[len(messages)-1].Role != "user" {
		return input
	}
	latest := messages[len(messages)-1]
	previousUser := -1
	for index := len(messages) - 2; index >= 0; index-- {
		if messages[index].Role == "user" {
			previousUser = index
			break
		}
	}
	if previousUser < 0 || messages[previousUser].Content != latest.Content {
		return input
	}
	for index := previousUser + 1; index < len(messages)-1; index++ {
		if messages[index].Role != "assistant" {
			return input
		}
	}
	normalized := input
	normalized.Messages = append([]tenantchat.EphemeralMessage(nil), messages[:previousUser+1]...)
	return normalized
}

func estimatedInputBytes(messages []tenantchat.EphemeralMessage) int64 {
	var total int64
	for _, message := range messages {
		total += int64(len(message.Content))
	}
	if total < 1 {
		return 1
	}
	return total
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create tenant chat cache cipher: %w", err)
	}
	return cipher.NewGCM(block)
}

func cacheAAD(namespace string, fingerprint string, keySetID string) []byte {
	return []byte(namespace + "\x00" + fingerprint + "\x00" + keySetID)
}

const putScript = `
local field = ARGV[1]
local value = ARGV[2]
local max_entries = tonumber(ARGV[3])
local ttl_seconds = tonumber(ARGV[4])
redis.call("HSET", KEYS[1], field, value)
local size = redis.call("HLEN", KEYS[1])
if size > max_entries then
  local fields = redis.call("HKEYS", KEYS[1])
  for _, candidate in ipairs(fields) do
    if candidate ~= field then
      redis.call("HDEL", KEYS[1], candidate)
      size = size - 1
      if size <= max_entries then
        break
      end
    end
  end
end
redis.call("EXPIRE", KEYS[1], ttl_seconds)
return size`
