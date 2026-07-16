package postgres

import (
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/employeecost"
)

func TestValidReserveInputAllowsUnknownCandidateTier(t *testing.T) {
	input := validReserveInputFixture()
	input.CandidateTier = ""

	if !validReserveInput(input) {
		t.Fatal("validReserveInput() rejected an omitted candidate tier")
	}
}

func TestValidReserveInputStillRejectsMissingRequiredFields(t *testing.T) {
	input := validReserveInputFixture()
	input.RequestID = ""

	if validReserveInput(input) {
		t.Fatal("validReserveInput() accepted a missing request ID")
	}
}

func TestValidTopUpAttemptInputAllowsUnknownCandidateTier(t *testing.T) {
	input := validTopUpAttemptInputFixture()
	input.CandidateTier = ""

	if !validTopUpAttemptInput(input) {
		t.Fatal("validTopUpAttemptInput() rejected an omitted candidate tier")
	}
}

func TestValidTopUpAttemptInputStillRejectsInvalidFallback(t *testing.T) {
	input := validTopUpAttemptInputFixture()
	input.Attempt.Kind = employeecost.AttemptKindPrimary

	if validTopUpAttemptInput(input) {
		t.Fatal("validTopUpAttemptInput() accepted a non-fallback attempt")
	}
}

func validReserveInputFixture() ReserveInput {
	now := time.Date(2026, time.July, 16, 0, 0, 0, 0, time.UTC)
	pricing := validAdapterPricingPin()
	return ReserveInput{
		TenantID:      "tenant-id",
		EmployeeID:    "employee-id",
		Surface:       employeecost.SurfaceTenantChat,
		RequestID:     "request-id",
		ReservationID: "reservation-id",
		CandidateTier: employeecost.TenantChatRouteTierStandard,
		Pricing:       pricing,
		PrimaryAttempt: &AttemptInput{
			AttemptNo:  1,
			Kind:       employeecost.AttemptKindPrimary,
			ProviderID: "provider-id",
			ModelKey:   "model-key",
			Pricing:    pricing,
		},
		DispatchIntentExpiresAt: now.Add(time.Minute),
		Now:                     now,
	}
}

func validTopUpAttemptInputFixture() TopUpAttemptInput {
	now := time.Date(2026, time.July, 16, 0, 0, 0, 0, time.UTC)
	return TopUpAttemptInput{
		TenantID:      "tenant-id",
		EmployeeID:    "employee-id",
		Surface:       employeecost.SurfaceTenantChat,
		RequestID:     "request-id",
		ReservationID: "reservation-id",
		CandidateTier: employeecost.TenantChatRouteTierStandard,
		Attempt: AttemptInput{
			AttemptNo:  2,
			Kind:       employeecost.AttemptKindFallback,
			ProviderID: "provider-id",
			ModelKey:   "model-key",
			Pricing:    validAdapterPricingPin(),
		},
		DispatchIntentExpiresAt: now.Add(time.Minute),
		Now:                     now,
	}
}

func validAdapterPricingPin() employeecost.PricingPin {
	return employeecost.PricingPin{
		RuleID:                   "rule-id",
		Version:                  "version-id",
		Currency:                 employeecost.CurrencyUSD,
		InputMicroUSDPerMillion:  1_000,
		OutputMicroUSDPerMillion: 2_000,
		EstimateVersion:          "estimate-v1",
		EstimatedInputTokens:     100,
		MaxOutputTokens:          200,
	}
}
