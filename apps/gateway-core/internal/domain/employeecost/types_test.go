package employeecost

import "testing"

func TestBoundedValues(t *testing.T) {
	tests := []struct {
		name    string
		valid   bool
		invalid bool
	}{
		{name: "surface", valid: SurfaceTenantChat.Valid() && SurfaceProjectApplication.Valid(), invalid: Surface("browser").Valid()},
		{name: "rollout", valid: RolloutModeOff.Valid() && RolloutModeShadow.Valid() && RolloutModeEnforce.Valid(), invalid: RolloutMode("on").Valid()},
		{name: "period kind", valid: PeriodKindDay.Valid() && PeriodKindWeek.Valid(), invalid: PeriodKind("month").Valid()},
		{name: "period state", valid: PeriodStateNormal.Valid() && PeriodStateWarning.Valid() && PeriodStateExceeded.Valid() && PeriodStatePendingLedger.Valid() && PeriodStateNotConfigured.Valid(), invalid: PeriodState("unknown").Valid()},
		{name: "enforcement", valid: EnforcementModeMonitor.Valid() && EnforcementModeRestrictHighCost.Valid(), invalid: EnforcementMode("block").Valid()},
		{name: "candidate class", valid: CandidateCostClassLower.Valid() && CandidateCostClassHigh.Valid() && CandidateCostClassUnknown.Valid(), invalid: CandidateCostClass("premium_model_name").Valid()},
		{name: "attempt kind", valid: AttemptKindPrimary.Valid() && AttemptKindFallback.Valid(), invalid: AttemptKind("retry").Valid()},
		{name: "dispatch state", valid: DispatchStateNotStarted.Valid() && DispatchStateStarted.Valid(), invalid: DispatchState("maybe").Valid()},
		{name: "usage quality", valid: UsageQualityNotAvailable.Valid() && UsageQualityConfirmed.Valid() && UsageQualityPendingUnconfirmed.Valid(), invalid: UsageQuality("estimated").Valid()},
		{name: "attempt outcome", valid: AttemptOutcomeSucceeded.Valid() && AttemptOutcomeFailedPreDelta.Valid() && AttemptOutcomeFailedPostDelta.Valid() && AttemptOutcomeCancelled.Valid() && AttemptOutcomeTimedOut.Valid(), invalid: AttemptOutcome("pending").Valid()},
		{name: "reservation state", valid: ReservationStateReserved.Valid() && ReservationStateSettled.Valid() && ReservationStateReleased.Valid() && ReservationStateUnconfirmed.Valid(), invalid: ReservationState("complete").Valid()},
		{name: "ledger kind", valid: LedgerEntryKindReserve.Valid() && LedgerEntryKindTopUp.Valid() && LedgerEntryKindSettle.Valid() && LedgerEntryKindRelease.Valid() && LedgerEntryKindUnconfirmed.Valid() && LedgerEntryKindLateCorrection.Valid(), invalid: LedgerEntryKind("delete").Valid()},
		{name: "decision outcome", valid: ReservationDecisionRolloutOff.Valid() && ReservationDecisionReserved.Valid() && ReservationDecisionObserved.Valid() && ReservationDecisionGuardUnavailable.Valid() && ReservationDecisionHighCostRestricted.Valid(), invalid: ReservationDecisionOutcome("allowed").Valid()},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !tt.valid {
				t.Fatal("canonical bounded value was rejected")
			}
			if tt.invalid {
				t.Fatal("unknown bounded value was accepted")
			}
		})
	}
}

func TestClassifyCandidateUsesOnlyExactSurfaceContract(t *testing.T) {
	tests := []struct {
		name    string
		surface Surface
		tier    string
		want    CandidateCostClass
	}{
		{name: "project low", surface: SurfaceProjectApplication, tier: ProjectCostTierLow, want: CandidateCostClassLower},
		{name: "project balanced", surface: SurfaceProjectApplication, tier: ProjectCostTierBalanced, want: CandidateCostClassLower},
		{name: "project premium", surface: SurfaceProjectApplication, tier: ProjectCostTierPremium, want: CandidateCostClassHigh},
		{name: "tenant economy", surface: SurfaceTenantChat, tier: TenantChatRouteTierEconomy, want: CandidateCostClassLower},
		{name: "tenant standard", surface: SurfaceTenantChat, tier: TenantChatRouteTierStandard, want: CandidateCostClassLower},
		{name: "tenant high quality", surface: SurfaceTenantChat, tier: TenantChatRouteTierHighQuality, want: CandidateCostClassHigh},
		{name: "does not cross-map public premium into tenant chat", surface: SurfaceTenantChat, tier: ProjectCostTierPremium, want: CandidateCostClassUnknown},
		{name: "does not trim or infer", surface: SurfaceProjectApplication, tier: " premium ", want: CandidateCostClassUnknown},
		{name: "invalid surface", surface: Surface("browser"), tier: ProjectCostTierPremium, want: CandidateCostClassUnknown},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClassifyCandidate(tt.surface, tt.tier); got != tt.want {
				t.Fatalf("ClassifyCandidate(%q, %q) = %q, want %q", tt.surface, tt.tier, got, tt.want)
			}
		})
	}
}
