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
