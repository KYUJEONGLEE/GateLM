package tenantchat

import (
	"errors"
	"time"
)

var (
	ErrIdempotencyConflict   = errors.New("tenant chat idempotency conflict")
	ErrAdmissionExpired      = errors.New("tenant chat admission expired")
	ErrRateLimited           = errors.New("tenant chat request rate limited")
	ErrConcurrencyLimited    = errors.New("tenant chat concurrency limited")
	ErrUsageGuardUnavailable = errors.New("tenant chat usage guard unavailable")
	ErrUserDisabled          = errors.New("tenant chat user disabled")
	ErrTenantDisabled        = errors.New("tenant chat tenant disabled")
	ErrMembershipDisabled    = errors.New("tenant chat membership disabled")
	ErrEmployeeDisabled      = errors.New("tenant chat employee disabled")
	ErrQuotaHardLimit        = errors.New("tenant chat user quota hard limit")
	ErrBudgetHardLimit       = errors.New("tenant chat tenant budget hard limit")
	ErrNoEligibleRoute       = errors.New("tenant chat has no eligible route")
)

type AdmissionLimits struct {
	RequestsPerWindow          int
	Window                     time.Duration
	MaxActiveAdmissionsPerUser int
	AdmissionTTL               time.Duration
}

type Admission struct {
	AdmissionID string
	RequestID   string
	State       string
	ExpiresAt   time.Time
	Replayed    bool
}

type AdmissionCancellation struct {
	AdmissionID  string
	RequestID    string
	State        string
	SlotReleased bool
	Replayed     bool
}

type SelectedRoute struct {
	RouteID                                string
	Tier                                   string
	ProviderID                             string
	ModelKey                               string
	PricingVersion                         int64
	InputMicroUSDPerMillionTokens          int64
	OutputMicroUSDPerMillionTokens         int64
	CacheReadInputMicroUSDPerMillionTokens *int64
}

type UsageReservation struct {
	ReservationID        string
	RequestID            string
	State                string
	ReservedTokens       int64
	ReservedCostMicroUSD int64
	QuotaState           string
	BudgetState          string
	LedgerVersion        int64
	Route                SelectedRoute
	Replayed             bool
}

type ConfirmedUsage struct {
	InputTokens          int64
	OutputTokens         int64
	CacheReadInputTokens int64
}

type ProviderAttempt struct {
	RequestID    string
	AttemptNo    int
	Kind         string
	ProviderID   string
	ModelKey     string
	Outcome      string
	UsageQuality string
	InputTokens  int64
	OutputTokens int64
	CostMicroUSD int64
}

type UsageSettlement struct {
	RequestID             string
	ReservationID         string
	State                 string
	ConfirmedInputTokens  int64
	ConfirmedOutputTokens int64
	ConfirmedCostMicroUSD int64
	QuotaState            string
	BudgetState           string
	LedgerVersion         int64
	Attempts              []ProviderAttempt
	Replayed              bool
}
