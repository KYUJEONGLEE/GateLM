package safety

import (
	"context"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

func TestEvaluatorRedactsAndBlocksUsingExistingP0Engine(t *testing.T) {
	evaluator := NewEvaluator()
	snapshot := tenantruntime.Snapshot{Policies: tenantruntime.Policies{Safety: tenantruntime.SafetyPolicy{
		Enabled: true, PolicyDigest: "sha256:synthetic",
		DetectorSet: []tenantruntime.SafetyDetector{
			{DetectorType: "email", Action: "redact"},
			{DetectorType: "api_key", Action: "block"},
		},
	}}}
	result, err := evaluator.Evaluate(context.Background(), snapshot, tenantchat.CompletionInput{
		Messages: []tenantchat.EphemeralMessage{{Role: "user", Content: "Reply to synthetic.user@example.com"}}, Stream: true,
	})
	if err != nil || result.Blocked || strings.Contains(result.Input.Messages[0].Content, "synthetic.user@example.com") {
		t.Fatalf("redact safety input: result=%+v err=%v", result, err)
	}
	blocked, err := evaluator.Evaluate(context.Background(), snapshot, tenantchat.CompletionInput{
		Messages: []tenantchat.EphemeralMessage{{Role: "user", Content: "Authorization: Bearer synthetic-secret-value"}}, Stream: true,
	})
	if err != nil || !blocked.Blocked {
		t.Fatalf("block mandatory secret: result=%+v err=%v", blocked, err)
	}
}

func TestEvaluatorMasksBlockedPriorContextWithoutBlockingCurrentMessage(t *testing.T) {
	evaluator := NewEvaluator()
	snapshot := tenantruntime.Snapshot{Policies: tenantruntime.Policies{Safety: tenantruntime.SafetyPolicy{
		Enabled: true, PolicyDigest: "sha256:synthetic",
		DetectorSet: []tenantruntime.SafetyDetector{
			{DetectorType: "email", Action: "block"},
			{DetectorType: "phone_number", Action: "block"},
			{DetectorType: "api_key", Action: "block"},
		},
	}}}
	result, err := evaluator.Evaluate(context.Background(), snapshot, tenantchat.CompletionInput{
		Messages: []tenantchat.EphemeralMessage{
			{Role: "user", Content: "Previous contact was synthetic.previous@example.test"},
			{Role: "assistant", Content: "Previous phone was 010-1234-5678 and api_key=synthetic_history_token_1234567890"},
			{Role: "user", Content: "Summarize the previous discussion without personal data."},
		},
		Stream: true,
	})
	if err != nil || result.Blocked {
		t.Fatalf("prior blocked context must be masked instead of blocking: result=%+v err=%v", result, err)
	}
	if len(result.Input.Messages) != 3 {
		t.Fatalf("masked message count = %d, want 3", len(result.Input.Messages))
	}
	if strings.Contains(result.Input.Messages[0].Content, "synthetic.previous@example.test") ||
		!strings.Contains(result.Input.Messages[0].Content, "[EMAIL_REDACTED]") {
		t.Fatalf("prior email was not masked: %q", result.Input.Messages[0].Content)
	}
	if strings.Contains(result.Input.Messages[1].Content, "010-1234-5678") ||
		strings.Contains(result.Input.Messages[1].Content, "synthetic_history_token_1234567890") ||
		!strings.Contains(result.Input.Messages[1].Content, "[PHONE_NUMBER_REDACTED]") ||
		!strings.Contains(result.Input.Messages[1].Content, "[API_KEY_REDACTED]") {
		t.Fatalf("prior phone or secret was not masked: %q", result.Input.Messages[1].Content)
	}
	if result.Input.Messages[2].Content != "Summarize the previous discussion without personal data." {
		t.Fatalf("current safe message changed: %q", result.Input.Messages[2].Content)
	}
}

func TestEvaluatorStillBlocksCurrentUserMessage(t *testing.T) {
	evaluator := NewEvaluator()
	for _, test := range []struct {
		name         string
		detectorType string
		content      string
	}{
		{name: "email", detectorType: "email", content: "Contact synthetic.current@example.test"},
		{name: "phone", detectorType: "phone_number", content: "Call 010-9876-5432"},
	} {
		t.Run(test.name, func(t *testing.T) {
			snapshot := tenantruntime.Snapshot{Policies: tenantruntime.Policies{Safety: tenantruntime.SafetyPolicy{
				Enabled: true, PolicyDigest: "sha256:synthetic",
				DetectorSet: []tenantruntime.SafetyDetector{{DetectorType: test.detectorType, Action: "block"}},
			}}}
			result, err := evaluator.Evaluate(context.Background(), snapshot, tenantchat.CompletionInput{
				Messages: []tenantchat.EphemeralMessage{
					{Role: "user", Content: "Safe prior message"},
					{Role: "assistant", Content: "Safe prior response"},
					{Role: "user", Content: test.content},
				},
				Stream: true,
			})
			if err != nil || !result.Blocked {
				t.Fatalf("current %s must remain blocked: result=%+v err=%v", test.detectorType, result, err)
			}
		})
	}
}
