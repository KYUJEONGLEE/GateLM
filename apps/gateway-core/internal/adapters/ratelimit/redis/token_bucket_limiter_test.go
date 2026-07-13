package redis

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/ratelimit"
)

func TestTokenBucketLimiterAllowsRequestWithinCapacity(t *testing.T) {
	now := time.Date(2026, 6, 27, 9, 0, 10, 0, time.UTC)
	client := &fakeClient{result: []any{int64(1), "59", int64(0)}}
	limiter := NewTokenBucketLimiter(client)

	decision, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Config:        testTokenBucketConfig(60),
		Now:           now,
	})

	if err != nil {
		t.Fatalf("expected allowed decision, got %v", err)
	}
	if !decision.Allowed || decision.Reason != ratelimit.ReasonWithinLimit || decision.Remaining != 59 {
		t.Fatalf("unexpected decision: %#v", decision)
	}
	if client.calls != 1 {
		t.Fatalf("expected one redis eval, got %d", client.calls)
	}
	if !strings.Contains(client.script, "HMGET") || !strings.Contains(client.script, "refill_per_millis") {
		t.Fatalf("expected token bucket script, got %s", client.script)
	}
	if len(client.keys) != 1 || !strings.Contains(client.keys[0], "token_bucket") || strings.Contains(client.keys[0], "raw prompt") {
		t.Fatalf("unexpected token bucket key: %#v", client.keys)
	}
	if len(client.args) != 4 || client.args[0] != now.UnixMilli() || client.args[1] != 60 {
		t.Fatalf("unexpected token bucket args: %#v", client.args)
	}
}

func TestTokenBucketLimiterBlocksUntilRefill(t *testing.T) {
	now := time.Date(2026, 6, 27, 9, 0, 10, 0, time.UTC)
	client := &fakeClient{result: []any{int64(0), "0.25", int64(750)}}
	limiter := NewTokenBucketLimiter(client)

	decision, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Config:        testTokenBucketConfig(60),
		Now:           now,
	})

	if err != nil {
		t.Fatalf("expected limit_exceeded decision, got %v", err)
	}
	if decision.Allowed || decision.Reason != ratelimit.ReasonLimitExceeded {
		t.Fatalf("unexpected decision: %#v", decision)
	}
	if decision.Remaining != 0 || decision.RetryAfterSeconds != 1 || decision.ResetAt != now.Add(time.Second) {
		t.Fatalf("unexpected retry fields: %#v", decision)
	}
}

func TestTokenBucketLimiterDoesNotResetAtFixedWindowBoundary(t *testing.T) {
	limiter := NewTokenBucketLimiter(&fakeClient{})
	keyBefore := limiter.tokenBucketKey(testTenantID, ratelimit.ScopeApplication, testApplicationID)
	keyAfter := limiter.tokenBucketKey(testTenantID, ratelimit.ScopeApplication, testApplicationID)

	if keyBefore != keyAfter {
		t.Fatalf("token bucket key must not include window boundary, before=%q after=%q", keyBefore, keyAfter)
	}
	if strings.Contains(keyBefore, "Authorization") || strings.Contains(keyBefore, "provider key") {
		t.Fatalf("redis key must not contain auth or provider secret material: %q", keyBefore)
	}
}

func TestTokenBucketLimiterUsesConfiguredKeyPrefix(t *testing.T) {
	limiter := NewTokenBucketLimiterWithKeyPrefix(&fakeClient{}, "gatelm:rate_limit:perf:run_001:token_bucket:v1")

	key := limiter.tokenBucketKey(testTenantID, ratelimit.ScopeApplication, testApplicationID)

	if !strings.HasPrefix(key, "gatelm:rate_limit:perf:run_001:token_bucket:v1:") {
		t.Fatalf("expected configured prefix, got %q", key)
	}
	if strings.Contains(key, "Authorization") || strings.Contains(key, "provider key") {
		t.Fatalf("redis key must not contain auth or provider secret material: %q", key)
	}
}

func TestTokenBucketLimiterUsesProjectEmployeeKey(t *testing.T) {
	client := &fakeClient{result: []any{int64(1), "4", int64(0)}}
	limiter := NewTokenBucketLimiter(client)

	_, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:   testTenantID,
		ProjectID:  testProjectID,
		EmployeeID: "employee_demo",
		Config: ratelimit.Config{
			Enabled:       true,
			Scope:         ratelimit.ScopeEmployee,
			Algorithm:     ratelimit.AlgorithmTokenBucket,
			WindowSeconds: 60,
			Limit:         5,
		},
		Now: time.Date(2026, 7, 10, 9, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("expected employee bucket request, got %v", err)
	}
	wantSuffix := ":" + testTenantID + ":employee:" + testProjectID + ":employee_demo"
	if len(client.keys) != 1 || !strings.HasSuffix(client.keys[0], wantSuffix) {
		t.Fatalf("expected isolated project employee key suffix %q, got %#v", wantSuffix, client.keys)
	}
}

func TestTokenBucketLimiterDoesNotTouchRedisWhenDisabled(t *testing.T) {
	client := &fakeClient{}
	limiter := NewTokenBucketLimiter(client)

	decision, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Config: ratelimit.Config{
			Enabled:       false,
			Scope:         ratelimit.ScopeApplication,
			Algorithm:     ratelimit.AlgorithmTokenBucket,
			WindowSeconds: 60,
			Limit:         60,
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

func TestTokenBucketLimiterFailsClosedOnRedisError(t *testing.T) {
	client := &fakeClient{err: errors.New("redis unavailable")}
	limiter := NewTokenBucketLimiter(client)

	decision, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Config:        testTokenBucketConfig(60),
		Now:           time.Date(2026, 6, 27, 9, 0, 10, 0, time.UTC),
	})

	if err == nil {
		t.Fatal("expected redis error")
	}
	if decision.Allowed || decision.Reason != ratelimit.ReasonInternalError {
		t.Fatalf("unexpected error decision: %#v", decision)
	}
}

func TestRedisLimiterRoutesByAlgorithm(t *testing.T) {
	client := &fakeClient{result: []any{int64(1), "59", int64(0)}}
	limiter := NewLimiter(client)

	_, err := limiter.Check(context.Background(), ratelimit.Request{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testApplicationID,
		Config:        testTokenBucketConfig(60),
		Now:           time.Date(2026, 6, 27, 9, 0, 10, 0, time.UTC),
	})

	if err != nil {
		t.Fatalf("expected routed token bucket decision, got %v", err)
	}
	if !strings.Contains(client.keys[0], "token_bucket") {
		t.Fatalf("expected token bucket key, got %#v", client.keys)
	}
}

func testTokenBucketConfig(limit int) ratelimit.Config {
	return ratelimit.Config{
		Enabled:       true,
		Scope:         ratelimit.ScopeApplication,
		Algorithm:     ratelimit.AlgorithmTokenBucket,
		WindowSeconds: 60,
		Limit:         limit,
	}
}
