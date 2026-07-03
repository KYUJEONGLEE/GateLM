package ratelimitstage

import (
	"context"
	"errors"
	"testing"
	"time"

	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/request"
)

func TestStageAllowsRequestWithinLimit(t *testing.T) {
	// Given 같은 Application이 아직 제한 범위 안에 있다
	limiter := &fakeLimiter{
		decision: ratelimit.Decision{
			Allowed:   true,
			Limit:     10,
			Remaining: 9,
			Reason:    ratelimit.ReasonWithinLimit,
		},
	}
	stage := NewStage(limiter, testConfig())
	stage.now = func() time.Time {
		return time.Date(2026, 6, 27, 9, 0, 0, 0, time.UTC)
	}
	gatewayCtx := testGatewayContext()

	// When Gateway가 provider 호출 전에 rate limit을 확인한다
	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected allowed request to pass, got %v", err)
	}

	// Then stage는 요청을 계속 진행시키고 decision을 context에 남긴다
	if gatewayCtx.Status.Status != "" {
		t.Fatalf("expected no terminal status, got %#v", gatewayCtx.Status)
	}
	if gatewayCtx.Governance.RateLimitDecision == nil || !gatewayCtx.Governance.RateLimitDecision.Allowed {
		t.Fatalf("expected allowed rate limit decision, got %#v", gatewayCtx.Governance.RateLimitDecision)
	}
	if limiter.request.ApplicationID != "app_demo" {
		t.Fatalf("expected application scope input, got %#v", limiter.request)
	}
}

func TestStageUsesRuntimeRateLimitConfigWhenLoaded(t *testing.T) {
	// Given fallback config와 다른 runtime rate limit config가 로드되어 있다
	limiter := &fakeLimiter{
		decision: ratelimit.Decision{
			Allowed: true,
			Reason:  ratelimit.ReasonWithinLimit,
		},
	}
	stage := NewStage(limiter, testConfig())
	gatewayCtx := testGatewayContext()
	gatewayCtx.Runtime.RateLimitConfig = ratelimit.Config{
		Enabled:       true,
		Scope:         ratelimit.ScopeApplication,
		Algorithm:     ratelimit.AlgorithmFixedWindow,
		WindowSeconds: 60,
		Limit:         7,
	}
	gatewayCtx.Runtime.HasRateLimitConfig = true

	// When RateLimit stage가 실행된다
	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected runtime config request to pass, got %v", err)
	}

	// Then limiter에는 runtime config의 limit이 전달된다
	if limiter.request.Config.Limit != 7 {
		t.Fatalf("expected runtime limit 7, got %#v", limiter.request.Config)
	}
}

func TestStagePassesProjectScopedRuntimeRateLimitConfig(t *testing.T) {
	limiter := &fakeLimiter{
		decision: ratelimit.Decision{
			Allowed: true,
			Reason:  ratelimit.ReasonWithinLimit,
		},
	}
	stage := NewStage(limiter, testConfig())
	gatewayCtx := testGatewayContext()
	gatewayCtx.Runtime.RateLimitConfig = ratelimit.Config{
		Enabled:       true,
		Scope:         ratelimit.ScopeProject,
		Algorithm:     ratelimit.AlgorithmFixedWindow,
		WindowSeconds: 60,
		Limit:         11,
	}
	gatewayCtx.Runtime.HasRateLimitConfig = true

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected project scoped runtime config request to pass, got %v", err)
	}

	if limiter.request.Config.Scope != ratelimit.ScopeProject || limiter.request.ProjectID != "project_demo" {
		t.Fatalf("expected project scoped rate limit request, got %#v", limiter.request)
	}
}

func TestStageBlocksRequestWhenLimitExceeded(t *testing.T) {
	// Given 같은 Application이 이미 limit을 초과했다
	stage := NewStage(&fakeLimiter{
		decision: ratelimit.Decision{
			Allowed:           false,
			Limit:             1,
			Remaining:         0,
			RetryAfterSeconds: 60,
			Reason:            ratelimit.ReasonLimitExceeded,
		},
	}, testConfig())
	gatewayCtx := testGatewayContext()

	// When Gateway가 rate limit을 확인한다
	err := stage.Execute(context.Background(), gatewayCtx)

	// Then Gateway는 rate_limited terminal outcome을 만든다
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected GatewayError, got %T %v", err, err)
	}
	if gatewayErr.Code != "rate_limited" || gatewayErr.HTTPStatus != 429 || gatewayErr.Stage != StageName {
		t.Fatalf("unexpected gateway error: %#v", gatewayErr)
	}
	if gatewayCtx.Status.Status != "rate_limited" || gatewayCtx.Status.HTTPStatus != 429 {
		t.Fatalf("unexpected terminal status: %#v", gatewayCtx.Status)
	}
	if gatewayCtx.Cache.CacheStatus != "bypass" || gatewayCtx.Cache.CacheType != "none" {
		t.Fatalf("rate limited request must bypass cache, got %#v", gatewayCtx.Cache)
	}
}

func TestStageFailsClosedOnLimiterError(t *testing.T) {
	// Given counter 저장소 확인 중 오류가 발생한다
	stage := NewStage(&fakeLimiter{
		err: errors.New("counter store unavailable"),
	}, testConfig())
	gatewayCtx := testGatewayContext()

	// When Gateway가 rate limit을 확인한다
	err := stage.Execute(context.Background(), gatewayCtx)

	// Then Gateway는 provider 호출 전에 fail-closed error를 만든다
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected GatewayError, got %T %v", err, err)
	}
	if gatewayErr.Code != "internal_error" || gatewayErr.HTTPStatus != 500 || gatewayErr.Stage != StageName {
		t.Fatalf("unexpected gateway error: %#v", gatewayErr)
	}
	if gatewayCtx.Status.Status != "failed" || gatewayCtx.Status.HTTPStatus != 500 {
		t.Fatalf("unexpected terminal status: %#v", gatewayCtx.Status)
	}
	if gatewayCtx.Governance.RateLimitDecision == nil || gatewayCtx.Governance.RateLimitDecision.Reason != ratelimit.ReasonInternalError {
		t.Fatalf("expected internal_error decision, got %#v", gatewayCtx.Governance.RateLimitDecision)
	}
	if gatewayCtx.Governance.RateLimitDecision.ScopeID != "app_demo" || gatewayCtx.Governance.RateLimitDecision.Limit != 1 {
		t.Fatalf("expected normalized decision context, got %#v", gatewayCtx.Governance.RateLimitDecision)
	}
}

func TestStageUsesDefaultClockWhenConstructedWithoutNewStage(t *testing.T) {
	// Given Stage가 생성자를 거치지 않아 now 함수가 비어 있다
	limiter := &fakeLimiter{
		decision: ratelimit.Decision{
			Allowed: true,
			Reason:  ratelimit.ReasonWithinLimit,
		},
	}
	stage := &Stage{
		limiter: limiter,
		config:  testConfig(),
	}
	gatewayCtx := testGatewayContext()

	// When Gateway가 rate limit을 확인한다
	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected stage to use default clock, got %v", err)
	}

	// Then limiter에는 0 시간이 아닌 현재 시간이 전달된다
	if limiter.request.Now.IsZero() {
		t.Fatalf("expected default clock to populate request time")
	}
}

type fakeLimiter struct {
	decision ratelimit.Decision
	err      error
	request  ratelimit.Request
}

func (l *fakeLimiter) Check(_ context.Context, req ratelimit.Request) (ratelimit.Decision, error) {
	l.request = req
	return l.decision, l.err
}

func testConfig() ratelimit.Config {
	return ratelimit.Config{
		Enabled:       true,
		Scope:         ratelimit.ScopeApplication,
		Algorithm:     ratelimit.AlgorithmFixedWindow,
		WindowSeconds: 60,
		Limit:         1,
	}
}

func testGatewayContext() *request.GatewayContext {
	return &request.GatewayContext{
		Identity: request.IdentityContext{
			TenantID:      "tenant_demo",
			ProjectID:     "project_demo",
			ApplicationID: "app_demo",
		},
	}
}
