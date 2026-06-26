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
