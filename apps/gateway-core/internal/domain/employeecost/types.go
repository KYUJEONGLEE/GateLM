package employeecost

import (
	"errors"
	"time"
)

var ErrGuardUnavailable = errors.New("employee cost guard unavailable")

const (
	CurrencyUSD           = "USD"
	DefaultPeriodTimezone = "Asia/Seoul"
	MicroUSDPerUSD        = int64(1_000_000)
	TokensPerPricingUnit  = int64(1_000_000)
)

type Surface string

const (
	SurfaceProjectApplication Surface = "project_application"
	SurfaceTenantChat         Surface = "tenant_chat"
)

func (surface Surface) Valid() bool {
	switch surface {
	case SurfaceProjectApplication, SurfaceTenantChat:
		return true
	default:
		return false
	}
}

type RolloutMode string

const (
	RolloutModeOff     RolloutMode = "off"
	RolloutModeShadow  RolloutMode = "shadow"
	RolloutModeEnforce RolloutMode = "enforce"
)

func (mode RolloutMode) Valid() bool {
	switch mode {
	case RolloutModeOff, RolloutModeShadow, RolloutModeEnforce:
		return true
	default:
		return false
	}
}

type Rollout struct {
	Mode                 RolloutMode
	ActivationBoundaryAt *time.Time
}

func (rollout Rollout) EffectiveMode(now time.Time) (RolloutMode, error) {
	if !rollout.Mode.Valid() || now.IsZero() {
		return "", ErrInvalidDecision
	}
	if rollout.Mode != RolloutModeEnforce {
		return rollout.Mode, nil
	}
	if rollout.ActivationBoundaryAt == nil {
		return "", ErrInvalidDecision
	}
	if now.Before(*rollout.ActivationBoundaryAt) {
		return RolloutModeShadow, nil
	}
	return RolloutModeEnforce, nil
}

type PeriodKind string

const (
	PeriodKindDay  PeriodKind = "day"
	PeriodKindWeek PeriodKind = "week"
)

func (kind PeriodKind) Valid() bool {
	switch kind {
	case PeriodKindDay, PeriodKindWeek:
		return true
	default:
		return false
	}
}

type PeriodState string

const (
	PeriodStateNotConfigured PeriodState = "not_configured"
	PeriodStatePendingLedger PeriodState = "pending_ledger"
	PeriodStateNormal        PeriodState = "normal"
	PeriodStateWarning       PeriodState = "warning"
	PeriodStateExceeded      PeriodState = "exceeded"
)

func (state PeriodState) Valid() bool {
	switch state {
	case PeriodStateNotConfigured, PeriodStatePendingLedger, PeriodStateNormal, PeriodStateWarning, PeriodStateExceeded:
		return true
	default:
		return false
	}
}

type EnforcementMode string

const (
	EnforcementModeMonitor          EnforcementMode = "monitor"
	EnforcementModeRestrictHighCost EnforcementMode = "restrict_high_cost"
)

func (mode EnforcementMode) Valid() bool {
	switch mode {
	case EnforcementModeMonitor, EnforcementModeRestrictHighCost:
		return true
	default:
		return false
	}
}

type CandidateCostClass string

const (
	CandidateCostClassLower   CandidateCostClass = "lower_cost"
	CandidateCostClassHigh    CandidateCostClass = "high_cost"
	CandidateCostClassUnknown CandidateCostClass = "unknown"

	ProjectCostTierLow      = "low"
	ProjectCostTierBalanced = "balanced"
	ProjectCostTierPremium  = "premium"

	TenantChatRouteTierEconomy     = "economy"
	TenantChatRouteTierStandard    = "standard"
	TenantChatRouteTierHighQuality = "high_quality"
)

func (class CandidateCostClass) Valid() bool {
	switch class {
	case CandidateCostClassLower, CandidateCostClassHigh, CandidateCostClassUnknown:
		return true
	default:
		return false
	}
}

// ClassifyCandidate maps only the exact, surface-specific contract values. It
// intentionally does not infer cost from model names, providers, or categories.
func ClassifyCandidate(surface Surface, exactTier string) CandidateCostClass {
	switch surface {
	case SurfaceProjectApplication:
		switch exactTier {
		case ProjectCostTierLow, ProjectCostTierBalanced:
			return CandidateCostClassLower
		case ProjectCostTierPremium:
			return CandidateCostClassHigh
		}
	case SurfaceTenantChat:
		switch exactTier {
		case TenantChatRouteTierEconomy, TenantChatRouteTierStandard:
			return CandidateCostClassLower
		case TenantChatRouteTierHighQuality:
			return CandidateCostClassHigh
		}
	}
	return CandidateCostClassUnknown
}

type Limit struct {
	Enabled       bool
	LimitMicroUSD int64
}

type Policy struct {
	Configured              bool
	Version                 int64
	Currency                string
	PeriodTimezone          string
	Daily                   Limit
	Weekly                  Limit
	WarningThresholdPercent int
	EnforcementMode         EnforcementMode
}

func (policy Policy) HasEnabledLimit() bool {
	return policy.Daily.Enabled || policy.Weekly.Enabled
}

type PeriodBounds struct {
	Kind     PeriodKind
	Start    time.Time
	End      time.Time
	Timezone string
}

type PeriodBalance struct {
	Authoritative              bool
	ConfirmedCostMicroUSD      int64
	ReservedCostMicroUSD       int64
	UnconfirmedCostMicroUSD    int64
	LastEvaluatedPolicyVersion int64
}

type Period struct {
	TenantID             string
	EmployeeID           string
	Bounds               PeriodBounds
	Currency             string
	CreatedPolicyVersion int64
	Balance              PeriodBalance
}

type PricingPin struct {
	RuleID                           string
	Version                          string
	Currency                         string
	InputMicroUSDPerMillion          int64
	OutputMicroUSDPerMillion         int64
	CacheReadInputMicroUSDPerMillion *int64
	EstimateVersion                  string
	EstimatedInputTokens             int64
	MaxOutputTokens                  int64
}

type AttemptKind string

const (
	AttemptKindPrimary  AttemptKind = "primary"
	AttemptKindFallback AttemptKind = "fallback"
)

func (kind AttemptKind) Valid() bool {
	return kind == AttemptKindPrimary || kind == AttemptKindFallback
}

type DispatchState string

const (
	DispatchStateNotStarted DispatchState = "not_started"
	DispatchStateStarted    DispatchState = "started"
)

func (state DispatchState) Valid() bool {
	return state == DispatchStateNotStarted || state == DispatchStateStarted
}

type UsageQuality string

const (
	UsageQualityNotAvailable       UsageQuality = "not_available"
	UsageQualityConfirmed          UsageQuality = "confirmed"
	UsageQualityPendingUnconfirmed UsageQuality = "pending_unconfirmed"
)

func (quality UsageQuality) Valid() bool {
	switch quality {
	case UsageQualityNotAvailable, UsageQualityConfirmed, UsageQualityPendingUnconfirmed:
		return true
	default:
		return false
	}
}

type AttemptOutcome string

const (
	AttemptOutcomeSucceeded       AttemptOutcome = "succeeded"
	AttemptOutcomeFailedPreDelta  AttemptOutcome = "failed_pre_delta"
	AttemptOutcomeFailedPostDelta AttemptOutcome = "failed_post_delta"
	AttemptOutcomeCancelled       AttemptOutcome = "cancelled"
	AttemptOutcomeTimedOut        AttemptOutcome = "timed_out"
)

func (outcome AttemptOutcome) Valid() bool {
	switch outcome {
	case AttemptOutcomeSucceeded, AttemptOutcomeFailedPreDelta, AttemptOutcomeFailedPostDelta, AttemptOutcomeCancelled, AttemptOutcomeTimedOut:
		return true
	default:
		return false
	}
}

type ReservationState string

const (
	ReservationStateReserved    ReservationState = "reserved"
	ReservationStateSettled     ReservationState = "settled"
	ReservationStateReleased    ReservationState = "released"
	ReservationStateUnconfirmed ReservationState = "unconfirmed"
)

func (state ReservationState) Valid() bool {
	switch state {
	case ReservationStateReserved, ReservationStateSettled, ReservationStateReleased, ReservationStateUnconfirmed:
		return true
	default:
		return false
	}
}

type LedgerEntryKind string

const (
	LedgerEntryKindReserve        LedgerEntryKind = "reserve"
	LedgerEntryKindTopUp          LedgerEntryKind = "top_up"
	LedgerEntryKindSettle         LedgerEntryKind = "settle"
	LedgerEntryKindRelease        LedgerEntryKind = "release"
	LedgerEntryKindUnconfirmed    LedgerEntryKind = "unconfirmed"
	LedgerEntryKindLateCorrection LedgerEntryKind = "late_correction"
)

func (kind LedgerEntryKind) Valid() bool {
	switch kind {
	case LedgerEntryKindReserve, LedgerEntryKindTopUp, LedgerEntryKindSettle, LedgerEntryKindRelease, LedgerEntryKindUnconfirmed, LedgerEntryKindLateCorrection:
		return true
	default:
		return false
	}
}

type ProviderAttempt struct {
	AttemptNo                     int
	Kind                          AttemptKind
	ProviderID                    string
	ModelKey                      string
	Pricing                       PricingPin
	DispatchState                 DispatchState
	Outcome                       AttemptOutcome
	UsageQuality                  UsageQuality
	ReservedCostMicroUSD          int64
	ConfirmedInputTokens          int64
	ConfirmedOutputTokens         int64
	ConfirmedCacheReadInputTokens int64
	ConfirmedCostMicroUSD         int64
	UnconfirmedCostMicroUSD       int64
	StartedAt                     time.Time
	CompletedAt                   *time.Time
}
