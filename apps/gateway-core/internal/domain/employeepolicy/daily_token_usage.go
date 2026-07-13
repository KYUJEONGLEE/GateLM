package employeepolicy

import (
	"context"
	"time"
)

type DailyTokenUsageKey struct {
	TenantID   string
	ProjectID  string
	EmployeeID string
	DayStart   time.Time
}

type DailyTokenUsageStore interface {
	GetOrSeed(ctx context.Context, key DailyTokenUsageKey, seed int64, expiresAt time.Time) (int64, error)
	Add(ctx context.Context, key DailyTokenUsageKey, requestID string, tokens int64, expiresAt time.Time) error
}
