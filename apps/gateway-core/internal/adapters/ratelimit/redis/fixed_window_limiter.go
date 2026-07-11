package redis

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/ratelimit"

	goredis "github.com/redis/go-redis/v9"
)

const defaultFixedWindowKeyPrefix = "gatelm:rate_limit:fixed_window:v1"

var (
	ErrMissingConfig = errors.New("rate limit config is missing")
	ErrMissingScope  = errors.New("rate limit request scope is missing")
)

type Client interface {
	Eval(ctx context.Context, script string, keys []string, args ...any) *goredis.Cmd
}

type FixedWindowLimiter struct {
	client    Client
	keyPrefix string
}

func NewFixedWindowLimiter(client Client) *FixedWindowLimiter {
	return NewFixedWindowLimiterWithKeyPrefix(client, defaultFixedWindowKeyPrefix)
}

func NewFixedWindowLimiterWithKeyPrefix(client Client, keyPrefix string) *FixedWindowLimiter {
	trimmedPrefix := strings.TrimSpace(keyPrefix)
	if trimmedPrefix == "" {
		trimmedPrefix = defaultFixedWindowKeyPrefix
	}
	return &FixedWindowLimiter{
		client:    client,
		keyPrefix: trimmedPrefix,
	}
}

func (l *FixedWindowLimiter) Check(ctx context.Context, req ratelimit.Request) (ratelimit.Decision, error) {
	startedAt := time.Now()
	config := ratelimit.NormalizeConfig(req.Config)
	tenantID := strings.TrimSpace(req.TenantID)
	scopeID := strings.TrimSpace(ratelimit.ScopeID(config.Scope, req))
	now := normalizeNow(req.Now)
	windowStart := fixedWindowStart(now, config.WindowSeconds)
	resetAt := windowStart.Add(time.Duration(config.WindowSeconds) * time.Second)
	decision := ratelimit.Decision{
		Scope:             config.Scope,
		ScopeID:           scopeID,
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
	if err := validateFixedWindowRequest(config, tenantID, scopeID); err != nil {
		decision.Allowed = false
		decision.Remaining = 0
		decision.Reason = ratelimit.ReasonConfigMissing
		if errors.Is(err, ErrMissingScope) {
			decision.Reason = ratelimit.ReasonInternalError
		}
		decision.DurationMS = time.Since(startedAt).Milliseconds()
		return decision, err
	}
	if l == nil || l.client == nil {
		decision.Allowed = false
		decision.Remaining = 0
		decision.Reason = ratelimit.ReasonInternalError
		decision.DurationMS = time.Since(startedAt).Milliseconds()
		return decision, errors.New("redis fixed-window rate limiter requires a client")
	}

	ttlMillis := max(resetAt.Sub(now).Milliseconds(), 1)
	key := l.fixedWindowKey(tenantID, config.Scope, scopeID, windowStart)
	raw, err := l.client.Eval(ctx, fixedWindowScript, []string{key}, config.Limit, ttlMillis).Result()
	if err != nil {
		decision.Allowed = false
		decision.Remaining = 0
		decision.Reason = ratelimit.ReasonInternalError
		decision.DurationMS = time.Since(startedAt).Milliseconds()
		return decision, fmt.Errorf("check redis fixed-window rate limit counter: %w", err)
	}

	allowed, requestCount, err := parseFixedWindowResult(raw)
	if err != nil {
		decision.Allowed = false
		decision.Remaining = 0
		decision.Reason = ratelimit.ReasonInternalError
		decision.DurationMS = time.Since(startedAt).Milliseconds()
		return decision, err
	}

	decision.Allowed = allowed
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

func (l *FixedWindowLimiter) fixedWindowKey(tenantID string, scope string, scopeID string, windowStart time.Time) string {
	prefix := defaultFixedWindowKeyPrefix
	if l != nil && strings.TrimSpace(l.keyPrefix) != "" {
		prefix = strings.TrimSpace(l.keyPrefix)
	}
	return strings.Join([]string{
		prefix,
		tenantID,
		scope,
		scopeID,
		strconv.FormatInt(windowStart.Unix(), 10),
	}, ":")
}

func validateFixedWindowRequest(config ratelimit.Config, tenantID string, scopeID string) error {
	if config.Scope != ratelimit.ScopeApplication && config.Scope != ratelimit.ScopeProject && config.Scope != ratelimit.ScopeEmployee {
		return fmt.Errorf("%w: unsupported scope %q", ErrMissingConfig, config.Scope)
	}
	if config.Algorithm != ratelimit.AlgorithmFixedWindow {
		return fmt.Errorf("%w: unsupported algorithm %q", ErrMissingConfig, config.Algorithm)
	}
	if config.WindowSeconds <= 0 || config.Limit <= 0 {
		return fmt.Errorf("%w: windowSeconds and limit must be positive", ErrMissingConfig)
	}
	if tenantID == "" || scopeID == "" {
		return ErrMissingScope
	}
	return nil
}

func parseFixedWindowResult(raw any) (bool, int, error) {
	values, ok := raw.([]any)
	if !ok {
		return false, 0, fmt.Errorf("unexpected redis fixed-window result %T", raw)
	}
	if len(values) < 2 {
		return false, 0, fmt.Errorf("unexpected redis fixed-window result length %d", len(values))
	}
	allowedFlag, err := intFromRedisValue(values[0])
	if err != nil {
		return false, 0, fmt.Errorf("parse redis fixed-window allowed flag: %w", err)
	}
	requestCount, err := intFromRedisValue(values[1])
	if err != nil {
		return false, 0, fmt.Errorf("parse redis fixed-window request count: %w", err)
	}
	return allowedFlag == 1, requestCount, nil
}

func intFromRedisValue(value any) (int, error) {
	switch v := value.(type) {
	case int:
		return v, nil
	case int64:
		return int(v), nil
	case string:
		parsed, err := strconv.Atoi(v)
		if err != nil {
			return 0, err
		}
		return parsed, nil
	case []byte:
		parsed, err := strconv.Atoi(string(v))
		if err != nil {
			return 0, err
		}
		return parsed, nil
	default:
		return 0, fmt.Errorf("unsupported value type %T", value)
	}
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

const fixedWindowScript = `
local limit = tonumber(ARGV[1])
local ttl_millis = tonumber(ARGV[2])
local current = redis.call("GET", KEYS[1])

if current and tonumber(current) >= limit then
  local ttl = redis.call("PTTL", KEYS[1])
  if ttl < 0 then
    redis.call("PEXPIRE", KEYS[1], ttl_millis)
    ttl = ttl_millis
  end
  return {0, tonumber(current), ttl}
end

current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ttl_millis)
end
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ttl_millis)
  ttl = ttl_millis
end
return {1, tonumber(current), ttl}`
