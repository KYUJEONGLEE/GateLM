package employeecost

import (
	"errors"
	"testing"
	"time"
)

func TestEvaluatePeriodThresholdBoundaries(t *testing.T) {
	limit := Limit{Enabled: true, LimitMicroUSD: 101}
	tests := []struct {
		name          string
		balance       PeriodBalance
		additional    int64
		wantState     PeriodState
		wantCurrent   int64
		wantProjected int64
	}{
		{
			name:          "normal below rounded warning",
			balance:       authoritativeBalance(80, 0, 0),
			wantState:     PeriodStateNormal,
			wantCurrent:   80,
			wantProjected: 80,
		},
		{
			name:          "warning starts at ceiling",
			balance:       authoritativeBalance(80, 0, 0),
			additional:    1,
			wantState:     PeriodStateWarning,
			wantCurrent:   80,
			wantProjected: 81,
		},
		{
			name:          "limit is inclusive",
			balance:       authoritativeBalance(100, 0, 0),
			additional:    1,
			wantState:     PeriodStateExceeded,
			wantCurrent:   100,
			wantProjected: 101,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := EvaluatePeriod(PeriodKindDay, limit, 80, tt.balance, tt.additional)
			if err != nil {
				t.Fatalf("EvaluatePeriod() error = %v", err)
			}
			if got.State != tt.wantState || got.CurrentExposureMicroUSD != tt.wantCurrent || got.ProjectedExposureMicroUSD != tt.wantProjected {
				t.Fatalf("EvaluatePeriod() = %#v, want state=%s current=%d projected=%d", got, tt.wantState, tt.wantCurrent, tt.wantProjected)
			}
			if got.WarningAtMicroUSD != 81 {
				t.Fatalf("warningAt = %d, want 81", got.WarningAtMicroUSD)
			}
		})
	}
}

func TestEvaluatePeriodDistinguishesDisabledAndPendingLedger(t *testing.T) {
	disabled, err := EvaluatePeriod(
		PeriodKindDay,
		Limit{Enabled: false},
		80,
		PeriodBalance{ConfirmedCostMicroUSD: 20},
		5,
	)
	if err != nil || disabled.State != PeriodStateNotConfigured || disabled.ProjectedExposureMicroUSD != 25 {
		t.Fatalf("disabled evaluation = %#v, %v", disabled, err)
	}

	pending, err := EvaluatePeriod(
		PeriodKindWeek,
		Limit{Enabled: true, LimitMicroUSD: 100},
		80,
		PeriodBalance{Authoritative: false, ConfirmedCostMicroUSD: 20},
		5,
	)
	if err != nil || pending.State != PeriodStatePendingLedger || pending.ProjectedExposureMicroUSD != 25 {
		t.Fatalf("pending evaluation = %#v, %v", pending, err)
	}
}

func TestEvaluateReservationMonitorNeverRestrictsHighCost(t *testing.T) {
	input := validReservationInput()
	input.Policy.EnforcementMode = EnforcementModeMonitor
	input.CandidateCostClass = CandidateCostClassHigh
	input.AdditionalCostMicroUSD = 30
	input.DailyBalance = authoritativeBalance(80, 0, 0)

	decision, err := EvaluateReservation(input)
	if err != nil {
		t.Fatalf("EvaluateReservation() error = %v", err)
	}
	if decision.Outcome != ReservationDecisionReserved || !decision.ShouldReserve || decision.RestrictHighCost || decision.EffectiveState != PeriodStateExceeded {
		t.Fatalf("monitor decision = %#v", decision)
	}
}

func TestEvaluateReservationRestrictsHighCostBeforeWritingReservation(t *testing.T) {
	input := validReservationInput()
	input.CandidateCostClass = CandidateCostClassHigh
	input.AdditionalCostMicroUSD = 30
	input.DailyBalance = authoritativeBalance(80, 0, 0)

	decision, err := EvaluateReservation(input)
	if err != nil {
		t.Fatalf("EvaluateReservation() error = %v", err)
	}
	if decision.Outcome != ReservationDecisionHighCostRestricted || decision.ShouldReserve || !decision.RestrictHighCost || decision.GuardUnavailable {
		t.Fatalf("restrict decision = %#v", decision)
	}
}

func TestEvaluateReservationAllowsLowerCostWhenExposureIsExceeded(t *testing.T) {
	input := validReservationInput()
	input.CandidateCostClass = CandidateCostClassLower
	input.AdditionalCostMicroUSD = 30
	input.DailyBalance = authoritativeBalance(80, 0, 0)

	decision, err := EvaluateReservation(input)
	if err != nil {
		t.Fatalf("EvaluateReservation() error = %v", err)
	}
	if decision.Outcome != ReservationDecisionReserved || !decision.ShouldReserve || decision.RestrictHighCost || decision.EffectiveState != PeriodStateExceeded {
		t.Fatalf("lower-cost decision = %#v", decision)
	}
}

func TestEvaluateReservationUsesMoreRestrictivePeriod(t *testing.T) {
	input := validReservationInput()
	input.Policy.Weekly = Limit{Enabled: true, LimitMicroUSD: 1_000}
	input.CandidateCostClass = CandidateCostClassHigh
	input.AdditionalCostMicroUSD = 10
	input.DailyBalance = authoritativeBalance(10, 0, 0)
	input.WeeklyBalance = authoritativeBalance(990, 0, 0)

	decision, err := EvaluateReservation(input)
	if err != nil {
		t.Fatalf("EvaluateReservation() error = %v", err)
	}
	if decision.Daily.State != PeriodStateNormal || decision.Weekly.State != PeriodStateExceeded || decision.EffectiveState != PeriodStateExceeded || !decision.RestrictHighCost {
		t.Fatalf("combined period decision = %#v", decision)
	}
}

func TestEvaluateReservationShadowRecordsButDoesNotRestrict(t *testing.T) {
	input := validReservationInput()
	input.Rollout = Rollout{Mode: RolloutModeShadow}
	input.CandidateCostClass = CandidateCostClassUnknown
	input.AdditionalCostMicroUSD = 30
	input.DailyBalance = authoritativeBalance(80, 0, 0)

	decision, err := EvaluateReservation(input)
	if err != nil {
		t.Fatalf("EvaluateReservation() error = %v", err)
	}
	if decision.Outcome != ReservationDecisionObserved || !decision.ShouldReserve || decision.RestrictHighCost || decision.GuardUnavailable || !decision.CoverageInvalid {
		t.Fatalf("shadow decision = %#v", decision)
	}
}

func TestEvaluateReservationEnforceFailsClosedForUnavailableGuard(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*ReservationDecisionInput)
	}{
		{
			name: "pending authoritative ledger",
			mutate: func(input *ReservationDecisionInput) {
				input.DailyBalance.Authoritative = false
			},
		},
		{
			name: "unknown high cost classification",
			mutate: func(input *ReservationDecisionInput) {
				input.CandidateCostClass = CandidateCostClassUnknown
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := validReservationInput()
			tt.mutate(&input)
			decision, err := EvaluateReservation(input)
			if err != nil {
				t.Fatalf("EvaluateReservation() error = %v", err)
			}
			if decision.Outcome != ReservationDecisionGuardUnavailable || decision.ShouldReserve || !decision.GuardUnavailable || decision.RestrictHighCost {
				t.Fatalf("unavailable decision = %#v", decision)
			}
		})
	}
}

func TestEvaluateReservationOffAndDisabledPoliciesDoNotRestrict(t *testing.T) {
	off := validReservationInput()
	off.Rollout = Rollout{Mode: RolloutModeOff}
	off.CandidateCostClass = CandidateCostClassHigh
	off.AdditionalCostMicroUSD = 200
	decision, err := EvaluateReservation(off)
	if err != nil || decision.Outcome != ReservationDecisionRolloutOff || decision.ShouldReserve || decision.RestrictHighCost {
		t.Fatalf("off decision = %#v, %v", decision, err)
	}

	disabled := validReservationInput()
	disabled.Policy.Daily = Limit{}
	disabled.Policy.Weekly = Limit{}
	disabled.CandidateCostClass = CandidateCostClassHigh
	decision, err = EvaluateReservation(disabled)
	if err != nil || decision.Outcome != ReservationDecisionReserved || !decision.ShouldReserve || decision.EffectiveState != PeriodStateNotConfigured {
		t.Fatalf("disabled decision = %#v, %v", decision, err)
	}

	disabled.CandidateCostClass = CandidateCostClassUnknown
	decision, err = EvaluateReservation(disabled)
	if err != nil || decision.Outcome != ReservationDecisionReserved || !decision.ShouldReserve || !decision.CoverageInvalid || decision.GuardUnavailable {
		t.Fatalf("disabled unknown-tier decision = %#v, %v", decision, err)
	}
}

func TestEvaluateReservationTreatsFutureEnforcementBoundaryAsShadow(t *testing.T) {
	input := validReservationInput()
	future := input.Now.Add(time.Minute)
	input.Rollout.ActivationBoundaryAt = &future
	input.CandidateCostClass = CandidateCostClassHigh
	input.AdditionalCostMicroUSD = 200

	decision, err := EvaluateReservation(input)
	if err != nil || decision.Outcome != ReservationDecisionObserved || !decision.ShouldReserve || decision.RestrictHighCost {
		t.Fatalf("future-boundary decision = %#v, %v", decision, err)
	}
}

func TestVirtualPolicyMustBeMonitorOnlyWithDisabledLimits(t *testing.T) {
	input := validReservationInput()
	input.Policy.Configured = false
	input.Policy.Version = 0
	input.Policy.Daily = Limit{}
	input.Policy.Weekly = Limit{}
	input.Policy.EnforcementMode = EnforcementModeRestrictHighCost
	if _, err := EvaluateReservation(input); !errors.Is(err, ErrInvalidPolicy) {
		t.Fatalf("virtual policy error = %v, want ErrInvalidPolicy", err)
	}
}

func TestEvaluateReservationRejectsOverflow(t *testing.T) {
	input := validReservationInput()
	input.DailyBalance.ConfirmedCostMicroUSD = int64(^uint64(0) >> 1)
	input.AdditionalCostMicroUSD = 1
	if _, err := EvaluateReservation(input); !errors.Is(err, ErrArithmeticOverflow) {
		t.Fatalf("EvaluateReservation() error = %v, want ErrArithmeticOverflow", err)
	}
}

func validReservationInput() ReservationDecisionInput {
	now := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	activationBoundary := now.Add(-time.Minute)
	return ReservationDecisionInput{
		Rollout: Rollout{
			Mode:                 RolloutModeEnforce,
			ActivationBoundaryAt: &activationBoundary,
		},
		Now: now,
		Policy: Policy{
			Configured:              true,
			Version:                 1,
			Currency:                CurrencyUSD,
			PeriodTimezone:          DefaultPeriodTimezone,
			Daily:                   Limit{Enabled: true, LimitMicroUSD: 100},
			Weekly:                  Limit{},
			WarningThresholdPercent: 80,
			EnforcementMode:         EnforcementModeRestrictHighCost,
		},
		DailyBalance:       authoritativeBalance(0, 0, 0),
		WeeklyBalance:      authoritativeBalance(0, 0, 0),
		CandidateCostClass: CandidateCostClassLower,
	}
}

func authoritativeBalance(confirmed, reserved, unconfirmed int64) PeriodBalance {
	return PeriodBalance{
		Authoritative:           true,
		ConfirmedCostMicroUSD:   confirmed,
		ReservedCostMicroUSD:    reserved,
		UnconfirmedCostMicroUSD: unconfirmed,
	}
}
