package redis

import (
	"context"
	"errors"
	"os"
	"strconv"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/employeepolicy"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"

	goredis "github.com/redis/go-redis/v9"
)

func TestDailyTokenUsageStoreSeedsAndAddsWithRequestDedupe(t *testing.T) {
	client := &fakeClient{results: []any{int64(120), int64(150)}}
	store := NewDailyTokenUsageStore(client)
	dayStart := time.Date(2026, 7, 11, 0, 0, 0, 0, time.UTC)
	key := employeepolicy.DailyTokenUsageKey{
		TenantID: "tenant", ProjectID: "project", EmployeeID: "employee", DayStart: dayStart,
	}

	used, err := store.GetOrSeed(context.Background(), key, 120, dayStart.Add(25*time.Hour))
	if err != nil || used != 120 {
		t.Fatalf("unexpected seeded usage: used=%d err=%v", used, err)
	}
	if err := store.Add(context.Background(), key, "request-1", 30, dayStart.Add(25*time.Hour)); err != nil {
		t.Fatalf("add daily tokens: %v", err)
	}
	if len(client.keys) != 2 || len(client.keys[1]) != 2 || client.keys[1][0] == client.keys[1][1] {
		t.Fatalf("expected usage and dedupe keys, got %#v", client.keys)
	}
}

func TestTrackingTerminalLogWriterAddsEmployeeProviderTokens(t *testing.T) {
	store := &fakeUsageStore{}
	next := &fakeTerminalWriter{}
	writer := NewTrackingTerminalLogWriter(next, store)
	completedAt := time.Date(2026, 7, 11, 12, 0, 0, 0, time.UTC)
	err := writer.WriteTerminalLog(context.Background(), invocationlog.TerminalLog{
		RequestID: "request-1", TenantID: "tenant", ProjectID: "project",
		TotalTokens: 42, CompletedAt: completedAt,
		EmployeePolicyDecision: &employeepolicy.Decision{
			EmployeeID: "employee", DailyTokenLimit: 1000,
		},
	})
	if err != nil {
		t.Fatalf("write tracked terminal log: %v", err)
	}
	if next.calls != 1 || store.tokens != 42 || store.requestID != "request-1" {
		t.Fatalf("unexpected tracking result: next=%d store=%#v", next.calls, store)
	}
}

func TestTrackingTerminalLogWriterDoesNotFailWhenDailyUsageUpdateFails(t *testing.T) {
	store := &fakeUsageStore{err: errors.New("redis unavailable")}
	next := &fakeTerminalWriter{}
	writer := NewTrackingTerminalLogWriter(next, store)
	err := writer.WriteTerminalLog(context.Background(), invocationlog.TerminalLog{
		RequestID: "request-redis-failure", TenantID: "tenant", ProjectID: "project",
		TotalTokens: 42, CompletedAt: time.Date(2026, 7, 11, 12, 0, 0, 0, time.UTC),
		EmployeePolicyDecision: &employeepolicy.Decision{
			EmployeeID: "employee", DailyTokenLimit: 1000,
		},
	})
	if err != nil {
		t.Fatalf("redis update failure must not fail terminal log: %v", err)
	}
	if next.calls != 1 {
		t.Fatalf("expected downstream terminal writer once, got %d", next.calls)
	}
}

type fakeClient struct {
	results []any
	calls   int
	keys    [][]string
}

func (c *fakeClient) Eval(_ context.Context, _ string, keys []string, _ ...any) *goredis.Cmd {
	result := c.results[c.calls]
	c.calls++
	c.keys = append(c.keys, append([]string(nil), keys...))
	return goredis.NewCmdResult(result, nil)
}

type fakeTerminalWriter struct{ calls int }

func (w *fakeTerminalWriter) WriteTerminalLog(_ context.Context, _ invocationlog.TerminalLog) error {
	w.calls++
	return nil
}

type fakeUsageStore struct {
	err       error
	requestID string
	tokens    int64
}

func (s *fakeUsageStore) GetOrSeed(_ context.Context, _ employeepolicy.DailyTokenUsageKey, seed int64, _ time.Time) (int64, error) {
	return seed, nil
}

func (s *fakeUsageStore) Add(_ context.Context, _ employeepolicy.DailyTokenUsageKey, requestID string, tokens int64, _ time.Time) error {
	s.requestID = requestID
	s.tokens = tokens
	return s.err
}

func TestDailyTokenUsageStoreRedisIntegration(t *testing.T) {
	redisURL := os.Getenv("GATELM_TEST_REDIS_URL")
	if redisURL == "" {
		t.Skip("GATELM_TEST_REDIS_URL is not configured")
	}
	options, err := goredis.ParseURL(redisURL)
	if err != nil {
		t.Fatalf("parse redis url: %v", err)
	}
	client := goredis.NewClient(options)
	defer client.Close()
	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Fatalf("ping redis: %v", err)
	}

	store := &DailyTokenUsageStore{
		client:    client,
		keyPrefix: defaultDailyTokenKeyPrefix + ":integration:" + strconv.FormatInt(time.Now().UnixNano(), 10),
	}
	dayStart := time.Now().UTC().Truncate(24 * time.Hour)
	expiresAt := time.Now().UTC().Add(2 * time.Minute)
	key := employeepolicy.DailyTokenUsageKey{
		TenantID: "tenant", ProjectID: "project", EmployeeID: "employee", DayStart: dayStart,
	}
	used, err := store.GetOrSeed(ctx, key, 100, expiresAt)
	if err != nil || used != 100 {
		t.Fatalf("seed redis usage: used=%d err=%v", used, err)
	}
	if err := store.Add(ctx, key, "request-1", 25, expiresAt); err != nil {
		t.Fatalf("add redis usage: %v", err)
	}
	if err := store.Add(ctx, key, "request-1", 25, expiresAt); err != nil {
		t.Fatalf("dedupe redis usage: %v", err)
	}
	used, err = store.GetOrSeed(ctx, key, 0, expiresAt)
	if err != nil || used != 125 {
		t.Fatalf("expected deduped usage 125, got used=%d err=%v", used, err)
	}
	used, err = store.GetOrSeed(ctx, key, 150, expiresAt)
	if err != nil || used != 150 {
		t.Fatalf("expected postgres seed to repair redis usage to 150, got used=%d err=%v", used, err)
	}
}
