package redis

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/ratelimit"
)

const defaultTokenBucketKeyPrefix = "gatelm:rate_limit:token_bucket:v1"

type TokenBucketLimiter struct {
	client    Client
	keyPrefix string
}

func NewTokenBucketLimiter(client Client) *TokenBucketLimiter {
	return NewTokenBucketLimiterWithKeyPrefix(client, defaultTokenBucketKeyPrefix)
}

func NewTokenBucketLimiterWithKeyPrefix(client Client, keyPrefix string) *TokenBucketLimiter {
	trimmedPrefix := strings.TrimSpace(keyPrefix)
	if trimmedPrefix == "" {
		trimmedPrefix = defaultTokenBucketKeyPrefix
	}
	return &TokenBucketLimiter{
		client:    client,
		keyPrefix: trimmedPrefix,
	}
}

func (l *TokenBucketLimiter) Check(ctx context.Context, req ratelimit.Request) (ratelimit.Decision, error) {
	startedAt := time.Now()
	config := ratelimit.NormalizeConfig(req.Config)
	tenantID := strings.TrimSpace(req.TenantID)
	scopeID := strings.TrimSpace(ratelimit.ScopeID(config.Scope, req))
	now := normalizeNow(req.Now)
	decision := ratelimit.Decision{
		Scope:         config.Scope,
		ScopeID:       scopeID,
		Limit:         config.Limit,
		WindowSeconds: config.WindowSeconds,
		WindowStart:   now,
		ResetAt:       now,
	}

	if !config.Enabled {
		decision.Allowed = true
		decision.Remaining = max(config.Limit, 0)
		decision.RetryAfterSeconds = 0
		decision.Reason = ratelimit.ReasonRateLimitDisabled
		decision.DurationMS = time.Since(startedAt).Milliseconds()
		return decision, nil
	}
	if err := validateTokenBucketRequest(config, tenantID, scopeID); err != nil {
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
		return decision, errors.New("redis token-bucket rate limiter requires a client")
	}

	refillPerMillis := float64(config.Limit) / float64(config.WindowSeconds) / 1000
	ttlMillis := max(int64(config.WindowSeconds)*2*1000, 1000)
	key := l.tokenBucketKey(tenantID, config.Scope, scopeID)
	raw, err := l.client.Eval(ctx, tokenBucketScript, []string{key},
		now.UnixMilli(),
		config.Limit,
		strconv.FormatFloat(refillPerMillis, 'f', -1, 64),
		ttlMillis,
	).Result()
	if err != nil {
		decision.Allowed = false
		decision.Remaining = 0
		decision.Reason = ratelimit.ReasonInternalError
		decision.DurationMS = time.Since(startedAt).Milliseconds()
		return decision, fmt.Errorf("check redis token-bucket rate limit counter: %w", err)
	}

	allowed, tokens, retryAfterMillis, err := parseTokenBucketResult(raw)
	if err != nil {
		decision.Allowed = false
		decision.Remaining = 0
		decision.Reason = ratelimit.ReasonInternalError
		decision.DurationMS = time.Since(startedAt).Milliseconds()
		return decision, err
	}

	decision.Allowed = allowed
	decision.Remaining = max(int(math.Floor(tokens)), 0)
	if decision.Allowed {
		decision.RetryAfterSeconds = 0
		decision.ResetAt = now
		decision.Reason = ratelimit.ReasonWithinLimit
	} else {
		decision.RetryAfterSeconds = retryAfterSecondsFromMillis(retryAfterMillis)
		decision.ResetAt = now.Add(time.Duration(decision.RetryAfterSeconds) * time.Second)
		decision.Reason = ratelimit.ReasonLimitExceeded
	}
	decision.DurationMS = time.Since(startedAt).Milliseconds()
	return decision, nil
}

func (l *TokenBucketLimiter) tokenBucketKey(tenantID string, scope string, scopeID string) string {
	prefix := defaultTokenBucketKeyPrefix
	if l != nil && strings.TrimSpace(l.keyPrefix) != "" {
		prefix = strings.TrimSpace(l.keyPrefix)
	}
	return strings.Join([]string{
		prefix,
		tenantID,
		scope,
		scopeID,
	}, ":")
}

func validateTokenBucketRequest(config ratelimit.Config, tenantID string, scopeID string) error {
	if config.Scope != ratelimit.ScopeApplication && config.Scope != ratelimit.ScopeProject && config.Scope != ratelimit.ScopeEmployee {
		return fmt.Errorf("%w: unsupported scope %q", ErrMissingConfig, config.Scope)
	}
	if config.Algorithm != ratelimit.AlgorithmTokenBucket {
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

func parseTokenBucketResult(raw any) (bool, float64, int64, error) {
	values, ok := raw.([]any)
	if !ok {
		return false, 0, 0, fmt.Errorf("unexpected redis token-bucket result %T", raw)
	}
	if len(values) < 3 {
		return false, 0, 0, fmt.Errorf("unexpected redis token-bucket result length %d", len(values))
	}
	allowedFlag, err := intFromRedisValue(values[0])
	if err != nil {
		return false, 0, 0, fmt.Errorf("parse redis token-bucket allowed flag: %w", err)
	}
	tokens, err := floatFromRedisValue(values[1])
	if err != nil {
		return false, 0, 0, fmt.Errorf("parse redis token-bucket tokens: %w", err)
	}
	retryAfterMillis, err := int64FromRedisValue(values[2])
	if err != nil {
		return false, 0, 0, fmt.Errorf("parse redis token-bucket retry: %w", err)
	}
	return allowedFlag == 1, tokens, retryAfterMillis, nil
}

func floatFromRedisValue(value any) (float64, error) {
	switch v := value.(type) {
	case float64:
		return v, nil
	case int:
		return float64(v), nil
	case int64:
		return float64(v), nil
	case string:
		return strconv.ParseFloat(v, 64)
	case []byte:
		return strconv.ParseFloat(string(v), 64)
	default:
		return 0, fmt.Errorf("unsupported value type %T", value)
	}
}

func int64FromRedisValue(value any) (int64, error) {
	switch v := value.(type) {
	case int:
		return int64(v), nil
	case int64:
		return v, nil
	case string:
		return strconv.ParseInt(v, 10, 64)
	case []byte:
		return strconv.ParseInt(string(v), 10, 64)
	default:
		return 0, fmt.Errorf("unsupported value type %T", value)
	}
}

func retryAfterSecondsFromMillis(millis int64) int {
	if millis <= 0 {
		return 0
	}
	return int((time.Duration(millis)*time.Millisecond + time.Second - time.Nanosecond) / time.Second)
}

const tokenBucketScript = `
local now_millis = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refill_per_millis = tonumber(ARGV[3])
local ttl_millis = tonumber(ARGV[4])

local bucket = redis.call("HMGET", KEYS[1], "tokens", "updated_at")
local tokens = tonumber(bucket[1])
local updated_at = tonumber(bucket[2])

if tokens == nil or updated_at == nil then
  tokens = capacity
  updated_at = now_millis
end

if now_millis > updated_at then
  tokens = math.min(capacity, tokens + ((now_millis - updated_at) * refill_per_millis))
  updated_at = now_millis
end

local allowed = 0
local retry_after_millis = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry_after_millis = math.ceil((1 - tokens) / refill_per_millis)
end

redis.call("HSET", KEYS[1], "tokens", tostring(tokens), "updated_at", tostring(updated_at))
redis.call("PEXPIRE", KEYS[1], ttl_millis)
return {allowed, tostring(tokens), retry_after_millis}`
