package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/ratelimit"

	"github.com/jackc/pgx/v5"
)

var (
	ErrMissingConfig = errors.New("rate limit config is missing")
	ErrMissingScope  = errors.New("rate limit request scope is missing")
)

type Queryer interface {
	QueryRow(ctx context.Context, sql string, arguments ...any) pgx.Row
}

type Limiter struct {
	db Queryer
}

func NewLimiter(db Queryer) *Limiter {
	return &Limiter{db: db}
}

func (l *Limiter) Check(ctx context.Context, req ratelimit.Request) (ratelimit.Decision, error) {
	startedAt := time.Now()
	config := ratelimit.NormalizeConfig(req.Config)
	tenantID := strings.TrimSpace(req.TenantID)
	applicationID := strings.TrimSpace(req.ApplicationID)
	now := normalizeNow(req.Now)
	windowStart := fixedWindowStart(now, config.WindowSeconds)
	resetAt := windowStart.Add(time.Duration(config.WindowSeconds) * time.Second)
	decision := ratelimit.Decision{
		Scope:             config.Scope,
		ScopeID:           applicationID,
		Limit:             config.Limit,
		WindowSeconds:     config.WindowSeconds,
		WindowStart:       windowStart,
		ResetAt:           resetAt,
		RetryAfterSeconds: retryAfterSeconds(now, resetAt),
	}

	if !config.Enabled {
		decision.Allowed = true
		decision.Remaining = max(config.Limit, 0)
		decision.RetryAfterSeconds = 0
		decision.Reason = ratelimit.ReasonRateLimitDisabled
		decision.DurationMS = time.Since(startedAt).Milliseconds()
		return decision, nil
	}
	if err := validateRequest(config, tenantID, applicationID); err != nil {
		decision.Allowed = false
		decision.Remaining = 0
		decision.Reason = ratelimit.ReasonConfigMissing
		if errors.Is(err, ErrMissingScope) {
			decision.Reason = ratelimit.ReasonInternalError
		}
		decision.DurationMS = time.Since(startedAt).Milliseconds()
		return decision, err
	}
	if l == nil || l.db == nil {
		decision.Allowed = false
		decision.Remaining = 0
		decision.Reason = ratelimit.ReasonInternalError
		decision.DurationMS = time.Since(startedAt).Milliseconds()
		return decision, errors.New("postgres rate limiter requires a database queryer")
	}

	var requestCount int
	counted := true
	if err := l.db.QueryRow(ctx, checkAndIncrementSQL,
		tenantID,
		applicationID,
		windowStart,
		config.WindowSeconds,
		config.Limit,
	).Scan(&requestCount); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			decision.Allowed = false
			decision.Remaining = 0
			decision.Reason = ratelimit.ReasonInternalError
			decision.DurationMS = time.Since(startedAt).Milliseconds()
			return decision, fmt.Errorf("check postgres rate limit counter: %w", err)
		}

		counted = false
		if err := l.db.QueryRow(ctx, currentCounterSQL,
			tenantID,
			applicationID,
			windowStart,
		).Scan(&requestCount); err != nil {
			decision.Allowed = false
			decision.Remaining = 0
			decision.Reason = ratelimit.ReasonInternalError
			decision.DurationMS = time.Since(startedAt).Milliseconds()
			return decision, fmt.Errorf("read capped postgres rate limit counter: %w", err)
		}
	}

	decision.Allowed = counted && requestCount <= config.Limit
	decision.Remaining = max(config.Limit-requestCount, 0)
	if decision.Allowed {
		decision.RetryAfterSeconds = 0
		decision.Reason = ratelimit.ReasonWithinLimit
	} else {
		decision.Reason = ratelimit.ReasonLimitExceeded
	}
	decision.DurationMS = time.Since(startedAt).Milliseconds()
	return decision, nil
}

func validateRequest(config ratelimit.Config, tenantID string, applicationID string) error {
	if config.Scope != ratelimit.ScopeApplication {
		return fmt.Errorf("%w: unsupported scope %q", ErrMissingConfig, config.Scope)
	}
	if config.Algorithm != ratelimit.AlgorithmFixedWindow {
		return fmt.Errorf("%w: unsupported algorithm %q", ErrMissingConfig, config.Algorithm)
	}
	if config.WindowSeconds <= 0 || config.Limit <= 0 {
		return fmt.Errorf("%w: windowSeconds and limit must be positive", ErrMissingConfig)
	}
	if tenantID == "" || applicationID == "" {
		return ErrMissingScope
	}
	return nil
}

func normalizeNow(now time.Time) time.Time {
	if now.IsZero() {
		return time.Now().UTC()
	}
	return now.UTC()
}

func fixedWindowStart(now time.Time, windowSeconds int) time.Time {
	if windowSeconds <= 0 {
		windowSeconds = 60
	}
	windowStartUnix := (now.Unix() / int64(windowSeconds)) * int64(windowSeconds)
	return time.Unix(windowStartUnix, 0).UTC()
}

func retryAfterSeconds(now time.Time, resetAt time.Time) int {
	if !resetAt.After(now) {
		return 0
	}
	duration := resetAt.Sub(now)
	return int((duration + time.Second - time.Nanosecond) / time.Second)
}

const checkAndIncrementSQL = `
insert into gateway_rate_limit_counters (
  tenant_id,
  application_id,
  window_start,
  window_seconds,
  limit_value,
  request_count,
  created_at,
  updated_at
) values (
  $1::uuid,
  $2::uuid,
  $3::timestamptz,
  $4::int,
  $5::int,
  1,
  now(),
  now()
)
on conflict (tenant_id, application_id, window_start)
do update set
  request_count = gateway_rate_limit_counters.request_count + 1,
  window_seconds = excluded.window_seconds,
  limit_value = excluded.limit_value,
  updated_at = now()
where gateway_rate_limit_counters.request_count < excluded.limit_value
returning request_count`

const currentCounterSQL = `
select request_count
from gateway_rate_limit_counters
where tenant_id = $1::uuid
  and application_id = $2::uuid
  and window_start = $3::timestamptz`
