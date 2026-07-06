package redis

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/ratelimit"

	goredis "github.com/redis/go-redis/v9"
)

const (
	testTenantID      = "00000000-0000-4000-8000-000000000100"
	testProjectID     = "00000000-0000-4000-8000-000000000200"
	testApplicationID = "00000000-0000-4000-8000-000000000300"
)

func TestFixedWindowLimiterAllowsRequestWithinRedisWindow(t *testing.T) {
	now := time.Date(2026, 6, 27, 9, 0, 10, 0, time.UTC)
	client := &fakeClient{result: []any{int64(1), int64(2), int64(50_000)}}
	limiter := NewFixedWindowLimiter(client)

	decision, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Config:        testFixedWindowConfig(3),
		Now:           now,
	})

	if err != nil {
		t.Fatalf("expected allowed decision, got %v", err)
	}
	if !decision.Allowed || decision.Reason != ratelimit.ReasonWithinLimit || decision.Remaining != 1 {
		t.Fatalf("unexpected decision: %#v", decision)
	}
	if decision.WindowStart != time.Date(2026, 6, 27, 9, 0, 0, 0, time.UTC) {
		t.Fatalf("unexpected window start: %s", decision.WindowStart)
	}
	if decision.ResetAt != time.Date(2026, 6, 27, 9, 1, 0, 0, time.UTC) {
		t.Fatalf("unexpected resetAt: %s", decision.ResetAt)
	}
	if client.calls != 1 {
		t.Fatalf("expected one redis eval, got %d", client.calls)
	}
	if !strings.Contains(client.script, "redis.call(\"INCR\"") || !strings.Contains(client.script, "redis.call(\"PEXPIRE\"") {
		t.Fatalf("expected atomic fixed-window script, got %s", client.script)
	}
	if len(client.keys) != 1 || !strings.Contains(client.keys[0], testTenantID) || !strings.Contains(client.keys[0], testApplicationID) {
		t.Fatalf("unexpected redis key: %#v", client.keys)
	}
	if len(client.args) != 2 || client.args[0] != 3 || client.args[1] != int64(50_000) {
		t.Fatalf("unexpected redis args: %#v", client.args)
	}
}

func TestFixedWindowLimiterBlocksWithoutIncrementingOverLimitRequest(t *testing.T) {
	now := time.Date(2026, 6, 27, 9, 0, 42, 0, time.UTC)
	client := &fakeClient{result: []any{int64(0), int64(3), int64(18_000)}}
	limiter := NewFixedWindowLimiter(client)

	decision, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Config:        testFixedWindowConfig(3),
		Now:           now,
	})

	if err != nil {
		t.Fatalf("expected limit_exceeded decision, got %v", err)
	}
	if decision.Allowed || decision.Reason != ratelimit.ReasonLimitExceeded {
		t.Fatalf("unexpected decision: %#v", decision)
	}
	if decision.Remaining != 0 || decision.RetryAfterSeconds != 18 {
		t.Fatalf("unexpected quota fields: %#v", decision)
	}
	if !strings.Contains(client.script, "tonumber(current) >= limit") {
		t.Fatalf("script must check limit before INCR, got %s", client.script)
	}
}

func TestFixedWindowLimiterUsesDifferentKeyForNextWindow(t *testing.T) {
	limiter := NewFixedWindowLimiter(&fakeClient{})
	first := limiter.fixedWindowKey(testTenantID, ratelimit.ScopeApplication, testApplicationID, time.Date(2026, 6, 27, 9, 0, 0, 0, time.UTC))
	second := limiter.fixedWindowKey(testTenantID, ratelimit.ScopeApplication, testApplicationID, time.Date(2026, 6, 27, 9, 1, 0, 0, time.UTC))

	if first == second {
		t.Fatalf("expected window-specific redis keys, got %q", first)
	}
	if strings.Contains(first, "raw prompt") || strings.Contains(first, "Authorization") || strings.Contains(first, "provider key") {
		t.Fatalf("redis key must not contain raw prompt, auth, or provider secret material: %q", first)
	}
}

func TestFixedWindowLimiterUsesConfiguredKeyPrefix(t *testing.T) {
	limiter := NewFixedWindowLimiterWithKeyPrefix(&fakeClient{}, "gatelm:rate_limit:perf:run_001:fixed_window:v1")

	key := limiter.fixedWindowKey(testTenantID, ratelimit.ScopeApplication, testApplicationID, time.Date(2026, 6, 27, 9, 0, 0, 0, time.UTC))

	if !strings.HasPrefix(key, "gatelm:rate_limit:perf:run_001:fixed_window:v1:") {
		t.Fatalf("expected configured prefix, got %q", key)
	}
	if strings.Contains(key, "raw prompt") || strings.Contains(key, "Authorization") || strings.Contains(key, "provider key") {
		t.Fatalf("redis key must not contain raw prompt, auth, or provider secret material: %q", key)
	}
}

func TestFixedWindowLimiterDoesNotTouchRedisWhenDisabled(t *testing.T) {
	client := &fakeClient{}
	limiter := NewFixedWindowLimiter(client)

	decision, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Config: ratelimit.Config{
			Enabled:       false,
			Scope:         ratelimit.ScopeApplication,
			Algorithm:     ratelimit.AlgorithmFixedWindow,
			WindowSeconds: 60,
			Limit:         3,
		},
		Now: time.Date(2026, 6, 27, 9, 0, 10, 0, time.UTC),
	})

	if err != nil {
		t.Fatalf("expected disabled decision, got %v", err)
	}
	if !decision.Allowed || decision.Reason != ratelimit.ReasonRateLimitDisabled {
		t.Fatalf("unexpected disabled decision: %#v", decision)
	}
	if client.calls != 0 {
		t.Fatalf("disabled rate limit must not touch redis, got %d calls", client.calls)
	}
}

func TestFixedWindowLimiterFailsClosedOnRedisError(t *testing.T) {
	client := &fakeClient{err: errors.New("redis unavailable")}
	limiter := NewFixedWindowLimiter(client)

	decision, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Config:        testFixedWindowConfig(3),
		Now:           time.Date(2026, 6, 27, 9, 0, 10, 0, time.UTC),
	})

	if err == nil {
		t.Fatal("expected redis error")
	}
	if decision.Allowed || decision.Reason != ratelimit.ReasonInternalError {
		t.Fatalf("unexpected error decision: %#v", decision)
	}
}

func TestFixedWindowLimiterReturnsConfigMissingForInvalidAlgorithm(t *testing.T) {
	client := &fakeClient{}
	limiter := NewFixedWindowLimiter(client)
	config := testFixedWindowConfig(3)
	config.Algorithm = ratelimit.AlgorithmTokenBucket

	decision, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Config:        config,
		Now:           time.Date(2026, 6, 27, 9, 0, 10, 0, time.UTC),
	})

	if err == nil {
		t.Fatal("expected config error")
	}
	if decision.Allowed || decision.Reason != ratelimit.ReasonConfigMissing {
		t.Fatalf("unexpected config decision: %#v", decision)
	}
	if client.calls != 0 {
		t.Fatalf("invalid config must not touch redis, got %d calls", client.calls)
	}
}

func testFixedWindowConfig(limit int) ratelimit.Config {
	return ratelimit.Config{
		Enabled:       true,
		Scope:         ratelimit.ScopeApplication,
		Algorithm:     ratelimit.AlgorithmFixedWindow,
		WindowSeconds: 60,
		Limit:         limit,
	}
}

type fakeClient struct {
	result any
	err    error
	calls  int
	script string
	keys   []string
	args   []any
}

func (c *fakeClient) Eval(_ context.Context, script string, keys []string, args ...any) *goredis.Cmd {
	c.calls++
	c.script = script
	c.keys = append([]string(nil), keys...)
	c.args = append([]any(nil), args...)
	return goredis.NewCmdResult(c.result, c.err)
}
