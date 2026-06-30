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

func TestP0EngineBlocksExpandedSecretAndIdentityDetectors(t *testing.T) {
	tests := []struct {
		name         string
		prompt       string
		rawValue     string
		detectorType string
		placeholder  string
	}{
		{
			name:         "provider api key",
			prompt:       "Provider key sk-redactedDemoProviderKey1234567890 was pasted.",
			rawValue:     "sk-redactedDemoProviderKey1234567890",
			detectorType: string(DetectorProviderAPIKey),
			placeholder:  PlaceholderProviderAPIKey,
		},
		{
			name:         "cloud access key",
			prompt:       "Cloud key AKIAREDACTEDDEMO1234 was pasted.",
			rawValue:     "AKIAREDACTEDDEMO1234",
			detectorType: string(DetectorCloudAccessKey),
			placeholder:  PlaceholderCloudAccessKey,
		},
		{
			name:         "github token",
			prompt:       "GitHub token ghp_redactedDemoToken1234567890 was pasted.",
			rawValue:     "ghp_redactedDemoToken1234567890",
			detectorType: string(DetectorGitHubToken),
			placeholder:  PlaceholderGitHubToken,
		},
		{
			name:         "slack token",
			prompt:       "Slack token xoxb-redacted-demo-token-1234567890 was pasted.",
			rawValue:     "xoxb-redacted-demo-token-1234567890",
			detectorType: string(DetectorSlackToken),
			placeholder:  PlaceholderSlackToken,
		},
		{
			name:         "database url",
			prompt:       "DATABASE_URL=postgres://demo_user:demoPass123456@db.local/app",
			rawValue:     "postgres://demo_user:demoPass123456@db.local/app",
			detectorType: string(DetectorDatabaseURL),
			placeholder:  PlaceholderDatabaseURL,
		},
		{
			name:         "webhook url",
			prompt:       "Webhook https://hooks.slack.com/services/T00000000/B00000000/redactedWebhookToken1234567890",
			rawValue:     "https://hooks.slack.com/services/T00000000/B00000000/redactedWebhookToken1234567890",
			detectorType: string(DetectorWebhookURL),
			placeholder:  PlaceholderWebhookURL,
		},
		{
			name:         "password assignment",
			prompt:       "password=demoPassword123456!",
			rawValue:     "demoPassword123456!",
			detectorType: string(DetectorPasswordAssignment),
			placeholder:  PlaceholderPassword,
		},
		{
			name:         "session cookie",
			prompt:       "Cookie: session=demoSessionToken1234567890abcdef",
			rawValue:     "demoSessionToken1234567890abcdef",
			detectorType: string(DetectorSessionCookie),
			placeholder:  PlaceholderSessionCookie,
		},
		{
			name:         "credit card",
			prompt:       "card_number=4111 1111 1111 1111",
			rawValue:     "4111 1111 1111 1111",
			detectorType: string(DetectorCreditCard),
			placeholder:  PlaceholderCreditCard,
		},
		{
			name:         "bank account",
			prompt:       "bank_account_number=110-123-456789",
			rawValue:     "110-123-456789",
			detectorType: string(DetectorBankAccount),
			placeholder:  PlaceholderBankAccount,
		},
		{
			name:         "passport number",
			prompt:       "passport_no=M12345678",
			rawValue:     "M12345678",
			detectorType: string(DetectorPassportNumber),
			placeholder:  PlaceholderPassportNumber,
		},
		{
			name:         "driver license",
			prompt:       "driver_license=12-34-567890-12",
			rawValue:     "12-34-567890-12",
			detectorType: string(DetectorDriverLicense),
			placeholder:  PlaceholderDriverLicense,
		},
	}

	engine := NewP0Engine()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: tt.prompt})
			if err != nil {
				t.Fatalf("Apply returned error: %v", err)
			}
			assertSingleDetection(t, result, ActionBlocked, tt.detectorType)
			if !strings.Contains(result.RedactedPrompt, tt.placeholder) {
				t.Fatalf("expected placeholder %s in redacted prompt, got %q", tt.placeholder, result.RedactedPrompt)
			}
			if strings.Contains(result.RedactedPrompt, tt.rawValue) {
				t.Fatalf("redacted prompt must not include raw blocked value: %q", result.RedactedPrompt)
			}
		})
	}
}

func TestP0EngineIgnoresLowConfidenceSecretValues(t *testing.T) {
	tests := []string{
		"secret=internal note",
		"token budget is 3000",
		"token=short_demo",
		"eyJ.a.b",
		"header.payload.signature",
		"sketch-123",
		"hf model name",
		"cloud_access_key=short_demo",
		"github token required",
		"ghp_short",
		"xoxb-short",
		"postgres://localhost/app",
		"postgres://demo_user@localhost/app",
		"https://discord.com/api/webhooks/123/short",
		"password is required",
		"password=short",
		"password=internal note",
		"card number is required",
		"card_number=4111 1111 1111 1112",
		"passport renewal guide",
		"M12345678",
		"driver license is required",
		"123456789012",
	}

	engine := NewP0Engine()
	for _, prompt := range tests {
		t.Run(prompt, func(t *testing.T) {
			result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: prompt})
			if err != nil {
				t.Fatalf("Apply returned error: %v", err)
			}
			if result.Action != ActionNone || result.DetectedCount != 0 || len(result.DetectedTypes) != 0 {
				t.Fatalf("expected no detection for %q, got %+v", prompt, result)
			}
		})
	}
}

func TestP0EngineRedactsExpandedPIIDetectors(t *testing.T) {
	tests := []struct {
		name         string
		prompt       string
		rawValue     string
		detectorType string
		placeholder  string
	}{
		{
			name:         "postal address",
			prompt:       "address: 123 Main Street 45",
			rawValue:     "123 Main Street 45",
			detectorType: string(DetectorPostalAddress),
			placeholder:  PlaceholderAddress,
		},
		{
			name:         "date of birth",
			prompt:       "date_of_birth: 1998-03-12",
			rawValue:     "1998-03-12",
			detectorType: string(DetectorDateOfBirth),
			placeholder:  PlaceholderDateOfBirth,
		},
		{
			name:         "person name",
			prompt:       "customer_name=Alex Kim",
			rawValue:     "Alex Kim",
			detectorType: string(DetectorPersonName),
			placeholder:  PlaceholderPersonName,
		},
		{
			name:         "customer id",
			prompt:       "customer_id=cus_1234567890",
			rawValue:     "cus_1234567890",
			detectorType: string(DetectorCustomerID),
			placeholder:  PlaceholderCustomerID,
		},
		{
			name:         "employee id",
			prompt:       "employee_id=E123456",
			rawValue:     "E123456",
			detectorType: string(DetectorEmployeeID),
			placeholder:  PlaceholderEmployeeID,
		},
		{
			name:         "account id",
			prompt:       "account_id=acct_1234567890",
			rawValue:     "acct_1234567890",
			detectorType: string(DetectorAccountID),
			placeholder:  PlaceholderAccountID,
		},
		{
			name:         "public ipv4",
			prompt:       "source ip 8.8.8.8",
			rawValue:     "8.8.8.8",
			detectorType: string(DetectorIPAddress),
			placeholder:  PlaceholderIPAddress,
		},
		{
			name:         "public ipv6",
			prompt:       "source ip 2606:4700:4700::1111",
			rawValue:     "2606:4700:4700::1111",
			detectorType: string(DetectorIPAddress),
			placeholder:  PlaceholderIPAddress,
		},
	}

	engine := NewP0Engine()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: tt.prompt})
			if err != nil {
				t.Fatalf("Apply returned error: %v", err)
			}
			assertSingleDetection(t, result, ActionRedacted, tt.detectorType)
			if !strings.Contains(result.RedactedPrompt, tt.placeholder) {
				t.Fatalf("expected placeholder %s in redacted prompt, got %q", tt.placeholder, result.RedactedPrompt)
			}
			if strings.Contains(result.RedactedPrompt, tt.rawValue) {
				t.Fatalf("redacted prompt must not include raw PII value: %q", result.RedactedPrompt)
			}
		})
	}
}

func TestP0EngineIgnoresLowConfidencePIIValues(t *testing.T) {
	tests := []string{
		"address is required",
		"123 Main Street appears in a fictional example",
		"meeting date 1998-03-12",
		"Alex Kim is a sample name",
		"customer id is required",
		"employee id is required",
		"account id field is missing",
		"127.0.0.1",
		"localhost",
		"10.0.0.8",
		"192.168.0.2",
		"172.16.0.2",
		"2001:db8::1",
	}

	engine := NewP0Engine()
	for _, prompt := range tests {
		t.Run(prompt, func(t *testing.T) {
			result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: prompt})
			if err != nil {
				t.Fatalf("Apply returned error: %v", err)
			}
			if result.Action != ActionNone || result.DetectedCount != 0 || len(result.DetectedTypes) != 0 {
				t.Fatalf("expected no detection for %q, got %+v", prompt, result)
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

func assertSingleDetection(t *testing.T, result Result, expectedAction Action, expectedType string) {
	t.Helper()

	if result.Action != expectedAction {
		t.Fatalf("expected action %s, got %s", expectedAction, result.Action)
	}
	if !reflect.DeepEqual(result.DetectedTypes, []string{expectedType}) {
		t.Fatalf("unexpected detected types: %#v", result.DetectedTypes)
	}
	if result.DetectedCount != 1 {
		t.Fatalf("expected detected count 1, got %d", result.DetectedCount)
	}
}
