package postgres

import (
	"errors"
	"time"

	"gatelm/apps/gateway-core/internal/domain/employeecost"
)

var (
	ErrInvalidInput        = errors.New("invalid employee cost postgres input")
	ErrInvariantViolation  = errors.New("employee cost postgres invariant violation")
	ErrIdempotencyConflict = errors.New("employee cost postgres idempotency conflict")
)

type Decision string

const (
	DecisionRolloutOff         Decision = "rollout_off"
	DecisionObserved           Decision = "observed"
	DecisionReserved           Decision = "reserved"
	DecisionHighCostRestricted Decision = "high_cost_restricted"
	DecisionGuardUnavailable   Decision = "guard_unavailable"
)

type PeriodEvidence struct {
	Kind                    employeecost.PeriodKind
	Start                   time.Time
	End                     time.Time
	Timezone                string
	State                   employeecost.PeriodState
	ConfirmedCostMicroUSD   int64
	ReservedCostMicroUSD    int64
	UnconfirmedCostMicroUSD int64
}

type ReserveResult struct {
	Applied          bool
	Replayed         bool
	RestrictHighCost bool
	GuardUnavailable bool
	CoverageInvalid  bool
	Decision         Decision
	ReservationID    string
	State            employeecost.ReservationState
	LedgerVersion    int64
	Daily            PeriodEvidence
	Weekly           PeriodEvidence
}

type TransitionResult struct {
	Applied                 bool
	Replayed                bool
	ReservationID           string
	State                   employeecost.ReservationState
	LedgerVersion           int64
	ConfirmedCostMicroUSD   int64
	ReservedCostMicroUSD    int64
	UnconfirmedCostMicroUSD int64
}

type TopUpResult struct {
	Applied          bool
	Replayed         bool
	RestrictHighCost bool
	GuardUnavailable bool
	CoverageInvalid  bool
	LedgerVersion    int64
}

type AttemptInput struct {
	AttemptNo  int
	Kind       employeecost.AttemptKind
	ProviderID string
	ModelKey   string
	Pricing    employeecost.PricingPin
}

type ReserveInput struct {
	TenantID                string
	EmployeeID              string
	Surface                 employeecost.Surface
	RequestID               string
	ReservationID           string
	CandidateTier           string
	RestrictedFromHigh      bool
	Pricing                 employeecost.PricingPin
	PrimaryAttempt          *AttemptInput
	DispatchIntentExpiresAt time.Time
	Now                     time.Time
}

type TopUpAttemptInput struct {
	TenantID                string
	EmployeeID              string
	Surface                 employeecost.Surface
	RequestID               string
	ReservationID           string
	CandidateTier           string
	Attempt                 AttemptInput
	DispatchIntentExpiresAt time.Time
	Now                     time.Time
}

type StartPrimaryAttemptInput struct {
	TenantID                string
	EmployeeID              string
	Surface                 employeecost.Surface
	RequestID               string
	ReservationID           string
	Attempt                 AttemptInput
	DispatchIntentExpiresAt time.Time
	Now                     time.Time
}

type AttemptRef struct {
	TenantID      string
	EmployeeID    string
	Surface       employeecost.Surface
	RequestID     string
	ReservationID string
	AttemptNo     int
	Now           time.Time
}

type ConfirmedUsage struct {
	InputTokens          int64
	OutputTokens         int64
	CacheReadInputTokens int64
}

type RecordConfirmedAttemptInput struct {
	AttemptRef
	Usage   ConfirmedUsage
	Outcome employeecost.AttemptOutcome
}

type ConfirmPendingAttemptInput struct {
	AttemptRef
	Usage ConfirmedUsage
}

type MarkPendingInput struct {
	AttemptRef
	Outcome employeecost.AttemptOutcome
}

type SettleInput struct {
	TenantID              string
	EmployeeID            string
	Surface               employeecost.Surface
	RequestID             string
	ReservationID         string
	AttemptNo             int
	ExpectedLedgerVersion int64
	Now                   time.Time
}

type ReleaseInput struct {
	TenantID              string
	EmployeeID            string
	Surface               employeecost.Surface
	RequestID             string
	ReservationID         string
	AttemptNo             *int
	ExpectedLedgerVersion int64
	Now                   time.Time
}

type ReconcileInput struct {
	TenantID              string
	EmployeeID            string
	Surface               employeecost.Surface
	RequestID             string
	ReservationID         string
	ExpectedLedgerVersion int64
	Now                   time.Time
}

type LateReceiptInput struct {
	AttemptRef
	Usage                 ConfirmedUsage
	ExpectedLedgerVersion int64
}
