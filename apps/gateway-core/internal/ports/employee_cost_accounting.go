package ports

import (
	"context"
	"time"

	"gatelm/apps/gateway-core/internal/domain/employeecost"
)

type EmployeeCostReserveRequest struct {
	TenantID                string
	EmployeeID              string
	RequestID               string
	CandidateTier           string
	RestrictedFromHigh      bool
	ProviderID              string
	ModelKey                string
	ProviderPricingKeys     []string
	ModelPricingKeys        []string
	EstimatedInputTokens    int64
	MaxOutputTokens         int64
	DispatchIntentExpiresAt time.Time
}

type EmployeeCostTopUpRequest struct {
	CandidateTier           string
	ProviderID              string
	ModelKey                string
	ProviderPricingKeys     []string
	ModelPricingKeys        []string
	EstimatedInputTokens    int64
	MaxOutputTokens         int64
	DispatchIntentExpiresAt time.Time
}

type EmployeeCostReservation struct {
	Active           bool
	Observed         bool
	RestrictHighCost bool
	GuardUnavailable bool
	CoverageInvalid  bool
	TenantID         string
	EmployeeID       string
	RequestID        string
	ReservationID    string
	AttemptNo        int
	LedgerVersion    int64
	HasConfirmed     bool
	HasPending       bool
}

type EmployeeCostAttemptDecision struct {
	Active           bool
	RestrictHighCost bool
	GuardUnavailable bool
	CoverageInvalid  bool
	AttemptNo        int
}

type EmployeeCostUsage struct {
	InputTokens          int64
	OutputTokens         int64
	CacheReadInputTokens int64
}

type ProjectEmployeeCostAccounting interface {
	Reserve(ctx context.Context, request EmployeeCostReserveRequest) (EmployeeCostReservation, error)
	TopUp(ctx context.Context, reservation *EmployeeCostReservation, request EmployeeCostTopUpRequest) (EmployeeCostAttemptDecision, error)
	MarkDispatched(ctx context.Context, reservation *EmployeeCostReservation) error
	RecordConfirmed(ctx context.Context, reservation *EmployeeCostReservation, usage EmployeeCostUsage, outcome employeecost.AttemptOutcome) error
	RecordPreCallFailure(ctx context.Context, reservation *EmployeeCostReservation) error
	MarkPending(ctx context.Context, reservation *EmployeeCostReservation, outcome employeecost.AttemptOutcome) error
	Settle(ctx context.Context, reservation *EmployeeCostReservation) (int64, error)
	Release(ctx context.Context, reservation *EmployeeCostReservation) error
}
