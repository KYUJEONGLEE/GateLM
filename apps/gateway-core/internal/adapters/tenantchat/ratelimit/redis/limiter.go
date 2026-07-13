package redis

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"

	goredis "github.com/redis/go-redis/v9"
)

const defaultKeyPrefix = "tenant-chat:provider-token-rate:v1"

var ErrTokenRateUnavailable = errors.New("tenant chat provider token rate unavailable")

type Client interface {
	Eval(ctx context.Context, script string, keys []string, args ...any) *goredis.Cmd
}

type Limiter struct {
	client    Client
	keyPrefix string
	now       func() time.Time
}

func NewLimiter(client Client) *Limiter {
	return &Limiter{client: client, keyPrefix: defaultKeyPrefix, now: time.Now}
}

func (l *Limiter) Check(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
	route tenantchat.SelectedRoute,
) (tenantchat.ProviderTokenRateDecision, error) {
	if l == nil || l.client == nil || requestContext.UsageIntent == nil {
		return tenantchat.ProviderTokenRateDecision{}, ErrTokenRateUnavailable
	}
	weight := requestContext.UsageIntent.EstimatedInputTokens + requestContext.UsageIntent.MaxOutputTokens
	if weight <= 0 {
		return tenantchat.ProviderTokenRateDecision{}, ErrTokenRateUnavailable
	}
	var policy *tenantruntime.ProviderTokenWindow
	for index := range snapshot.Policies.ProviderTokenRate.Providers {
		candidate := &snapshot.Policies.ProviderTokenRate.Providers[index]
		if candidate.ProviderID == route.ProviderID {
			policy = candidate
			break
		}
	}
	if policy == nil || policy.LimitTokens <= 0 || policy.WindowSeconds <= 0 {
		return tenantchat.ProviderTokenRateDecision{}, ErrTokenRateUnavailable
	}
	tenantID := strings.TrimSpace(requestContext.ExecutionScope.TenantID)
	providerID := strings.TrimSpace(route.ProviderID)
	if tenantID == "" || providerID == "" {
		return tenantchat.ProviderTokenRateDecision{}, ErrTokenRateUnavailable
	}
	now := l.now().UTC()
	windowSeconds := int64(policy.WindowSeconds)
	windowStart := (now.Unix() / windowSeconds) * windowSeconds
	resetAt := time.Unix(windowStart+windowSeconds, 0).UTC()
	ttlMillis := max(resetAt.Sub(now).Milliseconds(), 1)
	key := strings.Join([]string{l.keyPrefix, tenantID, providerID, strconv.FormatInt(windowStart, 10)}, ":")
	raw, err := l.client.Eval(ctx, tokenRateScript, []string{key}, policy.LimitTokens, weight, ttlMillis).Result()
	if err != nil {
		return tenantchat.ProviderTokenRateDecision{}, ErrTokenRateUnavailable
	}
	values, ok := raw.([]any)
	if !ok || len(values) < 1 {
		return tenantchat.ProviderTokenRateDecision{}, ErrTokenRateUnavailable
	}
	allowed, err := redisInt64(values[0])
	if err != nil {
		return tenantchat.ProviderTokenRateDecision{}, ErrTokenRateUnavailable
	}
	retry := 0
	if allowed != 1 {
		retry = int((resetAt.Sub(now) + time.Second - time.Nanosecond) / time.Second)
	}
	return tenantchat.ProviderTokenRateDecision{Allowed: allowed == 1, RetryAfterSeconds: retry}, nil
}

func redisInt64(value any) (int64, error) {
	switch typed := value.(type) {
	case int64:
		return typed, nil
	case int:
		return int64(typed), nil
	case string:
		return strconv.ParseInt(typed, 10, 64)
	case []byte:
		return strconv.ParseInt(string(typed), 10, 64)
	default:
		return 0, fmt.Errorf("unexpected redis integer %T", value)
	}
}

const tokenRateScript = `
local limit = tonumber(ARGV[1])
local weight = tonumber(ARGV[2])
local ttl_millis = tonumber(ARGV[3])
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
if current + weight > limit then
  local ttl = redis.call("PTTL", KEYS[1])
  if ttl < 0 and current > 0 then
    redis.call("PEXPIRE", KEYS[1], ttl_millis)
  end
  return {0, current}
end
local updated = redis.call("INCRBY", KEYS[1], weight)
if current == 0 then
  redis.call("PEXPIRE", KEYS[1], ttl_millis)
end
return {1, updated}`
