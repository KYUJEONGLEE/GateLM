package redis

import (
	"context"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"

	goredis "github.com/redis/go-redis/v9"
)

type fakeLimiterClient struct {
	keys   []string
	args   []any
	result any
	err    error
}

func (f *fakeLimiterClient) Eval(_ context.Context, _ string, keys []string, args ...any) *goredis.Cmd {
	f.keys = append([]string(nil), keys...)
	f.args = append([]any(nil), args...)
	return goredis.NewCmdResult(f.result, f.err)
}

func TestLimiterConsumesEstimatedInputAndMaxOutputOnce(t *testing.T) {
	client := &fakeLimiterClient{result: []any{int64(1), int64(44)}}
	limiter := NewLimiter(client)
	limiter.now = func() time.Time { return time.Unix(1_700_000_001, 0).UTC() }
	decision, err := limiter.Check(
		context.Background(),
		tenantchat.RequestContext{
			ExecutionScope: tenantchat.ExecutionScope{TenantID: "tenant_001"},
			UsageIntent:    &tenantchat.UsageIntent{EstimatedInputTokens: 12, MaxOutputTokens: 32},
		},
		tenantruntime.Snapshot{Policies: tenantruntime.Policies{ProviderTokenRate: tenantruntime.ProviderTokenRatePolicy{
			Providers: []tenantruntime.ProviderTokenWindow{{ProviderID: "provider_001", LimitTokens: 100, WindowSeconds: 60}},
		}}},
		tenantchat.SelectedRoute{ProviderID: "provider_001"},
	)
	if err != nil || !decision.Allowed {
		t.Fatalf("check provider token rate: decision=%+v err=%v", decision, err)
	}
	if len(client.keys) != 1 || client.args[1] != int64(44) {
		t.Fatalf("unexpected weighted token gate call: keys=%v args=%v", client.keys, client.args)
	}
}
