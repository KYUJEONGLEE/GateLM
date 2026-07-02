package masking

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestP0EngineRedactsEmailAndPhone(t *testing.T) {
	engine := NewP0Engine()

	result, err := engine.Apply(context.Background(), ApplyRequest{
		Prompt: "Contact user@example.invalid or 010-0000-0000.",
	})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	if result.Action != ActionRedacted {
		t.Fatalf("expected redacted action, got %s", result.Action)
	}
	if !reflect.DeepEqual(result.DetectedTypes, []string{"email", "phone_number"}) {
		t.Fatalf("expected stable sorted detected types, got %#v", result.DetectedTypes)
	}
	if result.DetectedCount != 2 {
		t.Fatalf("expected detected count 2, got %d", result.DetectedCount)
	}
	if !strings.Contains(result.RedactedPrompt, PlaceholderEmail) || !strings.Contains(result.RedactedPrompt, PlaceholderPhoneNumber) {
		t.Fatalf("expected placeholders in redacted prompt, got %q", result.RedactedPrompt)
	}
	if strings.Contains(result.RedactedPrompt, "user@example.invalid") || strings.Contains(result.RedactedPrompt, "010-0000-0000") {
		t.Fatalf("redacted prompt must not contain raw sensitive values: %q", result.RedactedPrompt)
	}
}

func TestP0EngineBlocksCriticalDetectors(t *testing.T) {
	tests := []struct {
		name         string
		prompt       string
		detectorType string
	}{
		{
			name:         "api key",
			prompt:       "api_key=test_secret_token_redacted_for_demo_only_1234567890",
			detectorType: string(DetectorAPIKey),
		},
		{
			name:         "jwt",
			prompt:       "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.signature_for_test_only",
			detectorType: string(DetectorJWT),
		},
		{
			name:         "rrn",
			prompt:       "000101-3000000",
			detectorType: string(DetectorResidentRegistrationNumber),
		},
		{
			name:         "authorization header",
			prompt:       "Authorization: Bearer test_secret_token_redacted_for_demo_only_1234567890",
			detectorType: string(DetectorAuthorizationHeader),
		},
		{
			name:         "private key",
			prompt:       "-----BEGIN PRIVATE KEY-----\ntestsecretredactedfordemoonly\n-----END PRIVATE KEY-----",
			detectorType: string(DetectorPrivateKey),
		},
	}

	engine := NewP0Engine()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: tt.prompt})
			if err != nil {
				t.Fatalf("Apply returned error: %v", err)
			}
			if result.Action != ActionBlocked {
				t.Fatalf("expected blocked action, got %s", result.Action)
			}
			if !reflect.DeepEqual(result.DetectedTypes, []string{tt.detectorType}) {
				t.Fatalf("unexpected detected types: %#v", result.DetectedTypes)
			}
			if result.DetectedCount != 1 {
				t.Fatalf("expected detected count 1, got %d", result.DetectedCount)
			}
			if strings.Contains(result.RedactedPrompt, tt.prompt) {
				t.Fatalf("redacted prompt must not include raw blocked value: %q", result.RedactedPrompt)
			}
		})
	}
}

func TestP0EngineLeavesSafePromptUnchanged(t *testing.T) {
	engine := NewP0Engine()
	prompt := "Write a short safe refund response."

	result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: prompt})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}
	if result.Action != ActionNone {
		t.Fatalf("expected none action, got %s", result.Action)
	}
	if result.DetectedCount != 0 || len(result.DetectedTypes) != 0 {
		t.Fatalf("expected no detections, got count=%d types=%#v", result.DetectedCount, result.DetectedTypes)
	}
	if result.RedactedPrompt != prompt {
		t.Fatalf("expected safe prompt unchanged, got %q", result.RedactedPrompt)
	}
}

func TestP0EngineAppliesDetectorPolicyAllowWithLogSafePrompt(t *testing.T) {
	engine := NewP0Engine()
	prompt := "Contact user@example.invalid or 010-0000-0000."

	result, err := engine.Apply(context.Background(), ApplyRequest{
		Prompt: prompt,
		DetectorPolicies: []DetectorPolicy{
			{DetectorType: string(DetectorPhoneNumber), Action: PolicyActionAllow},
		},
	})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}
	if result.Action != ActionRedacted {
		t.Fatalf("expected redacted action from email, got %s", result.Action)
	}
	if !reflect.DeepEqual(result.DetectedTypes, []string{"email"}) {
		t.Fatalf("expected only email as protected detection, got %#v", result.DetectedTypes)
	}
	if !reflect.DeepEqual(result.PolicyAllowedTypes, []string{"phone_number"}) {
		t.Fatalf("expected phone as policy allowed type, got %#v", result.PolicyAllowedTypes)
	}
	if !strings.Contains(result.RedactedPrompt, "010-0000-0000") {
		t.Fatalf("provider prompt should keep allowed phone value, got %q", result.RedactedPrompt)
	}
	if strings.Contains(result.LogSafePrompt, "010-0000-0000") || strings.Contains(result.RedactedPromptPreview, "010-0000-0000") {
		t.Fatalf("log-safe prompt and preview must not include allowed raw phone: prompt=%q preview=%q", result.LogSafePrompt, result.RedactedPromptPreview)
	}
	if !strings.Contains(result.LogSafePrompt, PlaceholderPhoneNumber) {
		t.Fatalf("expected log-safe prompt to mask allowed phone, got %q", result.LogSafePrompt)
	}
}

func TestP0EngineKeepsMandatoryDetectorProtectedWhenAllowRequested(t *testing.T) {
	engine := NewP0Engine()
	rawSecret := "test_secret_token_redacted_for_demo_only_1234567890"

	result, err := engine.Apply(context.Background(), ApplyRequest{
		Prompt: "api_key=" + rawSecret,
		DetectorPolicies: []DetectorPolicy{
			{DetectorType: string(DetectorAPIKey), Action: PolicyActionAllow},
		},
	})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}
	if result.Action != ActionBlocked {
		t.Fatalf("mandatory api key must remain blocked, got %s", result.Action)
	}
	if !reflect.DeepEqual(result.MandatoryProtectedTypes, []string{"api_key"}) {
		t.Fatalf("expected mandatory protected api_key, got %#v", result.MandatoryProtectedTypes)
	}
	if strings.Contains(result.RedactedPrompt, rawSecret) || strings.Contains(result.LogSafePrompt, rawSecret) {
		t.Fatalf("mandatory raw secret must not remain in protected prompts")
	}
}

func TestP0EngineBoundsRedactedPromptPreview(t *testing.T) {
	engine := NewP0Engine()
	prompt := strings.Repeat("safe ", 40)

	result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: prompt})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}
	if result.RedactedPrompt != prompt {
		t.Fatalf("expected full redacted prompt to remain available in memory, got %q", result.RedactedPrompt)
	}
	if len([]rune(result.RedactedPromptPreview)) > RedactedPromptPreviewMaxRunes+3 {
		t.Fatalf("expected preview to be bounded, got length=%d preview=%q", len([]rune(result.RedactedPromptPreview)), result.RedactedPromptPreview)
	}
	if strings.Contains(result.RedactedPromptPreview, "  ") || strings.Contains(result.RedactedPromptPreview, "\n") {
		t.Fatalf("expected normalized preview, got %q", result.RedactedPromptPreview)
	}
	if !strings.HasSuffix(result.RedactedPromptPreview, "...") {
		t.Fatalf("expected truncated preview suffix, got %q", result.RedactedPromptPreview)
	}
}

func TestP0EngineBlockWinsOverRedact(t *testing.T) {
	engine := NewP0Engine()

	result, err := engine.Apply(context.Background(), ApplyRequest{
		Prompt: "Contact user@example.invalid with api_key=test_secret_token_redacted_for_demo_only_1234567890",
	})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	if result.Action != ActionBlocked {
		t.Fatalf("expected block to win over redact, got %s", result.Action)
	}
	if !reflect.DeepEqual(result.DetectedTypes, []string{"api_key", "email"}) {
		t.Fatalf("expected stable sorted detected types, got %#v", result.DetectedTypes)
	}
	if result.DetectedCount != 2 {
		t.Fatalf("expected detected count 2, got %d", result.DetectedCount)
	}
}

func TestEffectiveDetectionsPrefersBlockingOverlap(t *testing.T) {
	selected := effectiveDetections([]Detection{
		{
			Type:        string(DetectorEmail),
			Start:       0,
			End:         20,
			Action:      ActionRedacted,
			Placeholder: PlaceholderEmail,
			Priority:    50,
		},
		{
			Type:        string(DetectorAPIKey),
			Start:       0,
			End:         12,
			Action:      ActionBlocked,
			Placeholder: PlaceholderAPIKey,
			Priority:    10,
		},
	})

	if len(selected) != 1 {
		t.Fatalf("expected one effective detection, got %#v", selected)
	}
	if selected[0].Type != string(DetectorAPIKey) {
		t.Fatalf("expected blocking api_key overlap to win, got %#v", selected[0])
	}
}
