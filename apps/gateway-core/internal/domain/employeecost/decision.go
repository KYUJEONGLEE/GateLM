package employeecost

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrInvalidPolicy     = errors.New("invalid employee cost policy")
	ErrInvalidPricingPin = errors.New("invalid employee cost pricing pin")
	ErrInvalidDecision   = errors.New("invalid employee cost decision input")
)

func (policy Policy) Validate() error {
	if policy.Configured {
		if policy.Version <= 0 {
			return fmt.Errorf("%w: configured policy version must be positive", ErrInvalidPolicy)
		}
	} else {
		if policy.Version != 0 {
			return fmt.Errorf("%w: virtual policy version must be zero", ErrInvalidPolicy)
		}
		if policy.Daily.Enabled || policy.Daily.LimitMicroUSD != 0 ||
			policy.Weekly.Enabled || policy.Weekly.LimitMicroUSD != 0 ||
			policy.EnforcementMode != EnforcementModeMonitor {
			return fmt.Errorf("%w: virtual policy must be monitor-only with disabled limits", ErrInvalidPolicy)
		}
	}
	if policy.Currency != CurrencyUSD {
		return fmt.Errorf("%w: currency must be USD", ErrInvalidPolicy)
	}
	if strings.TrimSpace(policy.PeriodTimezone) != policy.PeriodTimezone || policy.PeriodTimezone == "" {
		return fmt.Errorf("%w: period timezone is required", ErrInvalidPolicy)
	}
	if _, err := time.LoadLocation(policy.PeriodTimezone); err != nil {
		return fmt.Errorf("%w: period timezone is not IANA", ErrInvalidPolicy)
	}
	if policy.WarningThresholdPercent < 1 || policy.WarningThresholdPercent > 99 {
		return fmt.Errorf("%w: warning threshold must be between 1 and 99", ErrInvalidPolicy)
	}
	if !policy.EnforcementMode.Valid() {
		return fmt.Errorf("%w: enforcement mode is not bounded", ErrInvalidPolicy)
	}
	if err := validateLimit(policy.Daily); err != nil {
		return fmt.Errorf("%w: daily limit: %v", ErrInvalidPolicy, err)
	}
	if err := validateLimit(policy.Weekly); err != nil {
		return fmt.Errorf("%w: weekly limit: %v", ErrInvalidPolicy, err)
	}
	return nil
}

func validateLimit(limit Limit) error {
	if limit.LimitMicroUSD < 0 {
		return ErrInvalidArithmeticInput
	}
	if limit.Enabled && limit.LimitMicroUSD <= 0 {
		return errors.New("enabled limit must be positive")
	}
	return nil
}

func (pin PricingPin) Validate() error {
	if strings.TrimSpace(pin.RuleID) == "" || strings.TrimSpace(pin.Version) == "" {
		return fmt.Errorf("%w: rule and version are required", ErrInvalidPricingPin)
	}
	if pin.Currency != CurrencyUSD {
		return fmt.Errorf("%w: currency must be USD", ErrInvalidPricingPin)
	}
	if strings.TrimSpace(pin.EstimateVersion) == "" {
		return fmt.Errorf("%w: estimate version is required", ErrInvalidPricingPin)
	}
	if pin.EstimatedInputTokens < 1 || pin.MaxOutputTokens < 1 {
		return fmt.Errorf("%w: estimated input and max output must be positive", ErrInvalidPricingPin)
	}
	if pin.InputMicroUSDPerMillion < 0 || pin.OutputMicroUSDPerMillion < 0 {
		return fmt.Errorf("%w: pricing rates must be non-negative", ErrInvalidPricingPin)
	}
	if pin.CacheReadInputMicroUSDPerMillion != nil &&
		(*pin.CacheReadInputMicroUSDPerMillion < 0 ||
			*pin.CacheReadInputMicroUSDPerMillion > pin.InputMicroUSDPerMillion) {
		return fmt.Errorf("%w: cache-read input price must be bounded by regular input price", ErrInvalidPricingPin)
	}
	return nil
}

type PeriodEvaluation struct {
	Kind                      PeriodKind
	State                     PeriodState
	CurrentExposureMicroUSD   int64
	ProjectedExposureMicroUSD int64
	WarningAtMicroUSD         int64
	LimitMicroUSD             int64
}

func EvaluatePeriod(kind PeriodKind, limit Limit, warningThresholdPercent int, balance PeriodBalance, additionalExposureMicroUSD int64) (PeriodEvaluation, error) {
	if !kind.Valid() || additionalExposureMicroUSD < 0 || warningThresholdPercent < 1 || warningThresholdPercent > 99 {
		return PeriodEvaluation{}, ErrInvalidDecision
	}
	if err := validateLimit(limit); err != nil {
		return PeriodEvaluation{}, fmt.Errorf("%w: %v", ErrInvalidDecision, err)
	}
	currentExposure, err := Exposure(balance)
	if err != nil {
		return PeriodEvaluation{}, err
	}
	projectedExposure, err := addNonNegative(currentExposure, additionalExposureMicroUSD)
	if err != nil {
		return PeriodEvaluation{}, err
	}
	evaluation := PeriodEvaluation{
		Kind:                      kind,
		State:                     PeriodStateNotConfigured,
		CurrentExposureMicroUSD:   currentExposure,
		ProjectedExposureMicroUSD: projectedExposure,
		LimitMicroUSD:             limit.LimitMicroUSD,
	}
	if !limit.Enabled {
		return evaluation, nil
	}
	warningAt, err := WarningThreshold(limit.LimitMicroUSD, warningThresholdPercent)
	if err != nil {
		return PeriodEvaluation{}, err
	}
	evaluation.WarningAtMicroUSD = warningAt
	if !balance.Authoritative {
		evaluation.State = PeriodStatePendingLedger
		return evaluation, nil
	}
	switch {
	case projectedExposure >= limit.LimitMicroUSD:
		evaluation.State = PeriodStateExceeded
	case projectedExposure >= warningAt:
		evaluation.State = PeriodStateWarning
	default:
		evaluation.State = PeriodStateNormal
	}
	return evaluation, nil
}

type ReservationDecisionOutcome string

const (
	ReservationDecisionRolloutOff         ReservationDecisionOutcome = "rollout_off"
	ReservationDecisionReserved           ReservationDecisionOutcome = "reserved"
	ReservationDecisionObserved           ReservationDecisionOutcome = "observed"
	ReservationDecisionGuardUnavailable   ReservationDecisionOutcome = "guard_unavailable"
	ReservationDecisionHighCostRestricted ReservationDecisionOutcome = "high_cost_restricted"
)

func (outcome ReservationDecisionOutcome) Valid() bool {
	switch outcome {
	case ReservationDecisionRolloutOff, ReservationDecisionReserved, ReservationDecisionObserved, ReservationDecisionGuardUnavailable, ReservationDecisionHighCostRestricted:
		return true
	default:
		return false
	}
}

type ReservationDecisionInput struct {
	Rollout                Rollout
	Now                    time.Time
	Policy                 Policy
	DailyBalance           PeriodBalance
	WeeklyBalance          PeriodBalance
	CandidateCostClass     CandidateCostClass
	AdditionalCostMicroUSD int64
}

type ReservationDecision struct {
	Outcome          ReservationDecisionOutcome
	ShouldReserve    bool
	RestrictHighCost bool
	GuardUnavailable bool
	CoverageInvalid  bool
	EffectiveState   PeriodState
	Daily            PeriodEvaluation
	Weekly           PeriodEvaluation
}

func EvaluateReservation(input ReservationDecisionInput) (ReservationDecision, error) {
	if !input.CandidateCostClass.Valid() || input.AdditionalCostMicroUSD < 0 {
		return ReservationDecision{}, ErrInvalidDecision
	}
	effectiveRolloutMode, err := input.Rollout.EffectiveMode(input.Now)
	if err != nil {
		return ReservationDecision{}, err
	}
	if err := input.Policy.Validate(); err != nil {
		return ReservationDecision{}, err
	}

	daily, err := EvaluatePeriod(
		PeriodKindDay,
		input.Policy.Daily,
		input.Policy.WarningThresholdPercent,
		input.DailyBalance,
		input.AdditionalCostMicroUSD,
	)
	if err != nil {
		return ReservationDecision{}, err
	}
	weekly, err := EvaluatePeriod(
		PeriodKindWeek,
		input.Policy.Weekly,
		input.Policy.WarningThresholdPercent,
		input.WeeklyBalance,
		input.AdditionalCostMicroUSD,
	)
	if err != nil {
		return ReservationDecision{}, err
	}

	decision := ReservationDecision{
		Outcome:        ReservationDecisionRolloutOff,
		EffectiveState: effectiveState(daily.State, weekly.State),
		Daily:          daily,
		Weekly:         weekly,
	}
	if effectiveRolloutMode == RolloutModeOff {
		return decision, nil
	}

	decision.ShouldReserve = true
	decision.Outcome = ReservationDecisionObserved
	if effectiveRolloutMode == RolloutModeShadow {
		decision.CoverageInvalid = input.CandidateCostClass == CandidateCostClassUnknown
		return decision, nil
	}

	if input.Policy.HasEnabledLimit() && (daily.State == PeriodStatePendingLedger || weekly.State == PeriodStatePendingLedger) {
		decision.Outcome = ReservationDecisionGuardUnavailable
		decision.ShouldReserve = false
		decision.GuardUnavailable = true
		return decision, nil
	}
	if input.Policy.HasEnabledLimit() && input.CandidateCostClass == CandidateCostClassUnknown {
		decision.Outcome = ReservationDecisionGuardUnavailable
		decision.ShouldReserve = false
		decision.GuardUnavailable = true
		decision.CoverageInvalid = true
		return decision, nil
	}
	if input.CandidateCostClass == CandidateCostClassUnknown {
		decision.CoverageInvalid = true
	}
	if input.Policy.EnforcementMode == EnforcementModeRestrictHighCost &&
		input.CandidateCostClass == CandidateCostClassHigh &&
		decision.EffectiveState == PeriodStateExceeded {
		decision.Outcome = ReservationDecisionHighCostRestricted
		decision.ShouldReserve = false
		decision.RestrictHighCost = true
		return decision, nil
	}

	decision.Outcome = ReservationDecisionReserved
	return decision, nil
}

func effectiveState(states ...PeriodState) PeriodState {
	result := PeriodStateNotConfigured
	for _, state := range states {
		if state == PeriodStatePendingLedger {
			return PeriodStatePendingLedger
		}
		if periodStateSeverity(state) > periodStateSeverity(result) {
			result = state
		}
	}
	return result
}

func periodStateSeverity(state PeriodState) int {
	switch state {
	case PeriodStateNormal:
		return 1
	case PeriodStateWarning:
		return 2
	case PeriodStateExceeded:
		return 3
	default:
		return 0
	}
}
