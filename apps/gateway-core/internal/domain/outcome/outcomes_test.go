package outcome

import (
	"errors"
	"testing"
)

func TestSafetyBlockMapper(t *testing.T) {
	got := Build(BuildInput{
		TerminalStatus:   TerminalStatusBlocked,
		HTTPStatus:       403,
		ErrorCode:        "sensitive_data_blocked",
		ApplicationID:    "app_demo",
		SafetyChecked:    true,
		MaskingAction:    "blocked",
		DetectedTypes:    []string{"api_key"},
		DetectedCount:    1,
		CacheStatus:      "bypass",
		CacheType:        "none",
		StreamingOutcome: StreamingNotStreaming,
	})

	if got.TerminalStatus != TerminalStatusBlocked {
		t.Fatalf("expected blocked terminal status, got %s", got.TerminalStatus)
	}
	if got.DomainOutcomes.Safety.Outcome != SafetyBlocked ||
		got.DomainOutcomes.Cache.Outcome != CacheBypassed ||
		got.DomainOutcomes.Provider.Outcome != ProviderNotCalled ||
		got.DomainOutcomes.Streaming.Outcome != StreamingNotStreaming {
		t.Fatalf("unexpected safety block outcomes: %+v", got.DomainOutcomes)
	}
}

func TestStreamingRequestedBlockedMapsToNotStreaming(t *testing.T) {
	got := Build(BuildInput{
		TerminalStatus:     TerminalStatusBlocked,
		HTTPStatus:         403,
		ErrorCode:          "budget_blocked",
		ApplicationID:      "app_demo",
		StreamingRequested: true,
		CacheStatus:        "bypass",
		CacheType:          "none",
	})

	if got.DomainOutcomes.Streaming.Outcome != StreamingNotStreaming ||
		got.DomainOutcomes.Streaming.StreamingRequested != true ||
		got.DomainOutcomes.Provider.Outcome != ProviderNotCalled {
		t.Fatalf("expected blocked stream request to remain not_streaming with provider bypass, got %+v", got.DomainOutcomes)
	}
}

func TestSafetyRedactionMapper(t *testing.T) {
	got := Build(BuildInput{
		TerminalStatus:         TerminalStatusSuccess,
		HTTPStatus:             200,
		ApplicationID:          "app_demo",
		SafetyChecked:          true,
		MaskingAction:          "redacted",
		DetectedTypes:          []string{"phone_number", "email", "email"},
		DetectedCount:          2,
		RedactedPromptPreview:  "Contact [EMAIL_REDACTED].",
		CacheStatus:            "miss",
		CacheType:              "exact",
		SelectedProvider:       "mock",
		SelectedModel:          "mock-fast",
		RequestLogWritten:      true,
	})

	if got.DomainOutcomes.Safety.Outcome != SafetyRedacted ||
		got.DomainOutcomes.Safety.MaskingAction != "redacted" ||
		len(got.DomainOutcomes.Safety.DetectedTypes) != 2 {
		t.Fatalf("unexpected safety redaction outcome: %+v", got.DomainOutcomes.Safety)
	}
	if got.DomainOutcomes.Provider.Outcome != ProviderSuccess {
		t.Fatalf("expected provider success, got %+v", got.DomainOutcomes.Provider)
	}
}

func TestExactCacheHitMapsToSuccessWithProviderNotCalled(t *testing.T) {
	got := Build(BuildInput{
		TerminalStatus:   TerminalStatusSuccess,
		HTTPStatus:       200,
		ApplicationID:    "app_demo",
		SafetyChecked:    true,
		MaskingAction:    "none",
		CacheStatus:      "hit",
		CacheType:        "exact",
		RequestedModel:   "auto",
		RoutingReason:    "exact_cache_hit_provider_bypass",
	})

	if got.TerminalStatus != TerminalStatusSuccess ||
		got.DomainOutcomes.Cache.Outcome != CacheHit ||
		got.DomainOutcomes.Provider.Outcome != ProviderNotCalled {
		t.Fatalf("unexpected exact cache hit outcome: %+v", got)
	}
}

func TestProviderTimeoutFallbackSuccessMapsToTerminalSuccess(t *testing.T) {
	got := Build(BuildInput{
		TerminalStatus:   TerminalStatusSuccess,
		HTTPStatus:       200,
		ApplicationID:    "app_demo",
		ProviderOutcome:  ProviderTimeout,
		FallbackOutcome:  FallbackSuccess,
		SelectedProvider: "openai",
		SelectedModel:    "gpt-test",
	})

	if got.TerminalStatus != TerminalStatusSuccess ||
		got.DomainOutcomes.Provider.Outcome != ProviderTimeout ||
		got.DomainOutcomes.Fallback.Outcome != FallbackSuccess {
		t.Fatalf("unexpected timeout fallback outcome: %+v", got)
	}
}

func TestProviderErrorFallbackDisabledMapsToFailed(t *testing.T) {
	got := Build(BuildInput{
		TerminalStatus:   TerminalStatusFailed,
		HTTPStatus:       502,
		ErrorCode:        "provider_error",
		ApplicationID:    "app_demo",
		ProviderOutcome:  ProviderError,
		FallbackOutcome:  FallbackDisabled,
		SelectedProvider: "openai",
		SelectedModel:    "gpt-test",
	})

	if got.TerminalStatus != TerminalStatusFailed ||
		got.DomainOutcomes.Provider.Outcome != ProviderError ||
		got.DomainOutcomes.Fallback.Outcome != FallbackDisabled {
		t.Fatalf("unexpected provider error fallback disabled outcome: %+v", got)
	}
}

func TestAuthFailuresMapToBlocked(t *testing.T) {
	for _, tc := range []struct {
		name      string
		errorCode string
		httpCode  int
		auth      string
	}{
		{name: "api key", errorCode: "invalid_api_key", httpCode: 401, auth: AuthInvalidAPIKey},
		{name: "app token", errorCode: "invalid_app_token", httpCode: 403, auth: AuthInvalidAppToken},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := Build(BuildInput{
				HTTPStatus:    tc.httpCode,
				ErrorCode:     tc.errorCode,
				ApplicationID: "app_demo",
				CacheStatus:   "bypass",
				CacheType:     "none",
			})
			if got.TerminalStatus != TerminalStatusBlocked || got.DomainOutcomes.Auth.Outcome != tc.auth {
				t.Fatalf("unexpected auth failure outcome: %+v", got)
			}
		})
	}
}

func TestRateLimitedMapsToRateLimited(t *testing.T) {
	got := Build(BuildInput{
		HTTPStatus:       429,
		ErrorCode:        "rate_limited",
		ApplicationID:    "app_demo",
		RateLimitChecked: true,
		RateLimitAllowed: false,
		CacheStatus:      "bypass",
		CacheType:        "none",
	})

	if got.TerminalStatus != TerminalStatusRateLimited ||
		got.DomainOutcomes.RateLimit.Outcome != RateLimitRateLimited ||
		got.DomainOutcomes.Provider.Outcome != ProviderNotCalled {
		t.Fatalf("unexpected rate limited outcome: %+v", got)
	}
}

func TestForbiddenTerminalStatusGuardRejectsLegacyValues(t *testing.T) {
	for _, status := range []string{
		ForbiddenTerminalStatusCacheHit,
		ForbiddenTerminalStatusError,
		ForbiddenTerminalStatusPartialSuccess,
	} {
		if err := ValidateTerminalStatus(status); !errors.Is(err, ErrForbiddenTerminalStatus) {
			t.Fatalf("expected forbidden status %q to be rejected, got %v", status, err)
		}
	}
}
