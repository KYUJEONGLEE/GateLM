package redis

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/employeepolicy"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"

	goredis "github.com/redis/go-redis/v9"
)

const defaultDailyTokenKeyPrefix = "gatelm:employee_daily_tokens:v1"

type Client interface {
	Eval(ctx context.Context, script string, keys []string, args ...any) *goredis.Cmd
}

type DailyTokenUsageStore struct {
	client    Client
	keyPrefix string
}

func NewDailyTokenUsageStore(client Client) *DailyTokenUsageStore {
	return &DailyTokenUsageStore{client: client, keyPrefix: defaultDailyTokenKeyPrefix}
}

func (s *DailyTokenUsageStore) GetOrSeed(
	ctx context.Context,
	key employeepolicy.DailyTokenUsageKey,
	seed int64,
	expiresAt time.Time,
) (int64, error) {
	if s == nil || s.client == nil {
		return seed, fmt.Errorf("daily token usage store requires redis client")
	}
	redisKey, err := s.usageKey(key)
	if err != nil {
		return seed, err
	}
	if seed < 0 {
		seed = 0
	}
	raw, err := s.client.Eval(
		ctx,
		getOrSeedDailyTokenScript,
		[]string{redisKey},
		seed,
		normalizeExpiry(expiresAt).Unix(),
	).Result()
	if err != nil {
		return seed, fmt.Errorf("get or seed employee daily tokens: %w", err)
	}
	return redisInt64(raw)
}

func (s *DailyTokenUsageStore) Add(
	ctx context.Context,
	key employeepolicy.DailyTokenUsageKey,
	requestID string,
	tokens int64,
	expiresAt time.Time,
) error {
	if tokens <= 0 {
		return nil
	}
	if s == nil || s.client == nil {
		return fmt.Errorf("daily token usage store requires redis client")
	}
	usageKey, err := s.usageKey(key)
	if err != nil {
		return err
	}
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return fmt.Errorf("daily token usage request id is required")
	}
	dedupeKey := usageKey + ":request:" + requestID
	if _, err := s.client.Eval(
		ctx,
		addDailyTokenScript,
		[]string{usageKey, dedupeKey},
		tokens,
		normalizeExpiry(expiresAt).Unix(),
	).Result(); err != nil {
		return fmt.Errorf("add employee daily tokens: %w", err)
	}
	return nil
}

func (s *DailyTokenUsageStore) usageKey(key employeepolicy.DailyTokenUsageKey) (string, error) {
	tenantID := strings.TrimSpace(key.TenantID)
	projectID := strings.TrimSpace(key.ProjectID)
	employeeID := strings.TrimSpace(key.EmployeeID)
	if tenantID == "" || projectID == "" || employeeID == "" {
		return "", fmt.Errorf("daily token usage scope is incomplete")
	}
	dayStart := key.DayStart.UTC()
	if dayStart.IsZero() {
		return "", fmt.Errorf("daily token usage day is required")
	}
	return strings.Join([]string{
		s.keyPrefix, tenantID, projectID, employeeID, dayStart.Format("20060102"),
	}, ":"), nil
}

type TrackingTerminalLogWriter struct {
	next  invocationlog.TerminalLogWriter
	store employeepolicy.DailyTokenUsageStore
}

func NewTrackingTerminalLogWriter(
	next invocationlog.TerminalLogWriter,
	store employeepolicy.DailyTokenUsageStore,
) *TrackingTerminalLogWriter {
	return &TrackingTerminalLogWriter{next: next, store: store}
}

func (w *TrackingTerminalLogWriter) WriteTerminalLog(ctx context.Context, entry invocationlog.TerminalLog) error {
	if w == nil || w.next == nil {
		return fmt.Errorf("tracking terminal log writer requires downstream writer")
	}
	if err := w.next.WriteTerminalLog(ctx, entry); err != nil {
		return err
	}
	decision := entry.EmployeePolicyDecision
	if w.store == nil || decision == nil ||
		decision.DailyTokenOutcome == employeepolicy.DailyTokenOutcomeNotUsed ||
		decision.DailyTokenLimit <= 0 || entry.TotalTokens <= 0 {
		return nil
	}
	completedAt := entry.CompletedAt.UTC()
	if completedAt.IsZero() {
		completedAt = time.Now().UTC()
	}
	dayStart := time.Date(completedAt.Year(), completedAt.Month(), completedAt.Day(), 0, 0, 0, 0, time.UTC)
	return w.store.Add(ctx, employeepolicy.DailyTokenUsageKey{
		TenantID: entry.TenantID, ProjectID: entry.ProjectID,
		EmployeeID: decision.EmployeeID, DayStart: dayStart,
	}, entry.RequestID, int64(entry.TotalTokens), dayStart.AddDate(0, 0, 1).Add(time.Hour))
}

func normalizeExpiry(expiresAt time.Time) time.Time {
	if expiresAt.IsZero() {
		return time.Now().UTC().Add(25 * time.Hour)
	}
	return expiresAt.UTC()
}

func redisInt64(value any) (int64, error) {
	switch typed := value.(type) {
	case int64:
		return typed, nil
	case string:
		return strconv.ParseInt(typed, 10, 64)
	case []byte:
		return strconv.ParseInt(string(typed), 10, 64)
	default:
		return 0, fmt.Errorf("unexpected redis integer type %T", value)
	}
}

const getOrSeedDailyTokenScript = `
local current = redis.call("GET", KEYS[1])
if not current then
  redis.call("SET", KEYS[1], ARGV[1], "EXAT", ARGV[2], "NX")
  current = redis.call("GET", KEYS[1])
end
return current
`

const addDailyTokenScript = `
local inserted = redis.call("SET", KEYS[2], "1", "EXAT", ARGV[2], "NX")
if inserted then
  local total = redis.call("INCRBY", KEYS[1], ARGV[1])
  redis.call("EXPIREAT", KEYS[1], ARGV[2])
  return total
end
return redis.call("GET", KEYS[1]) or 0
`
