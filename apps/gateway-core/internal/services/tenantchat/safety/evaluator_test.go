package safety

import (
	"context"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/masking"
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

func TestEvaluatorUsesInjectedMaskingEngineForEveryMessage(t *testing.T) {
	engine := &recordingMaskingEngine{}
	evaluator := NewEvaluatorWithEngine(engine)
	snapshot := tenantruntime.Snapshot{Policies: tenantruntime.Policies{Safety: tenantruntime.SafetyPolicy{
		Enabled: true, PolicyDigest: "sha256:synthetic",
		DetectorSet: []tenantruntime.SafetyDetector{{DetectorType: "email", Action: "redact"}},
	}}}

	result, err := evaluator.Evaluate(context.Background(), snapshot, tenantchat.CompletionInput{
		Messages: []tenantchat.EphemeralMessage{
			{Role: "system", Content: "synthetic system message"},
			{Role: "user", Content: "synthetic user message"},
		},
	})
	if err != nil {
		t.Fatalf("evaluate with injected engine: %v", err)
	}
	if len(engine.prompts) != 2 {
		t.Fatalf("expected one engine call per message, got %d", len(engine.prompts))
	}
	for _, message := range result.Input.Messages {
		if message.Content != "[MODEL_REDACTED]" {
			t.Fatalf("expected injected engine output, got %q", message.Content)
		}
	}
}

func TestEvaluatorUsesOptionalBatchEngineOnceAndKeepsSharedEntityScope(t *testing.T) {
	engine := &recordingBatchMaskingEngine{}
	evaluator := NewEvaluatorWithEngine(engine)
	snapshot := tenantruntime.Snapshot{Policies: tenantruntime.Policies{Safety: tenantruntime.SafetyPolicy{
		Enabled: true, PolicyDigest: "sha256:synthetic",
		DetectorSet: []tenantruntime.SafetyDetector{{DetectorType: "email", Action: "redact"}},
	}}}
	result, err := evaluator.Evaluate(context.Background(), snapshot, tenantchat.CompletionInput{
		Messages: []tenantchat.EphemeralMessage{
			{Role: "system", Content: "synthetic system message"},
			{Role: "user", Content: "synthetic user message"},
		},
	})
	if err != nil {
		t.Fatalf("evaluate with batch engine: %v", err)
	}
	if engine.batchCalls != 1 || engine.applyCalls != 0 || len(engine.requests) != 2 {
		t.Fatalf("expected one batch and zero single calls: %+v", engine)
	}
	if engine.requests[0].EntityScope == nil || engine.requests[0].EntityScope != engine.requests[1].EntityScope {
		t.Fatal("batch requests must share the request-scoped entity scope")
	}
	for _, message := range result.Input.Messages {
		if message.Content != "[BATCH_REDACTED]" {
			t.Fatalf("expected batch output, got %q", message.Content)
		}
	}
}

type recordingMaskingEngine struct {
	prompts []string
}

type recordingBatchMaskingEngine struct {
	applyCalls int
	batchCalls int
	requests   []masking.ApplyRequest
}

func (e *recordingBatchMaskingEngine) Apply(_ context.Context, _ masking.ApplyRequest) (masking.Result, error) {
	e.applyCalls++
	return masking.Result{}, nil
}

func (e *recordingBatchMaskingEngine) ApplyBatch(
	_ context.Context,
	requests []masking.ApplyRequest,
) ([]masking.Result, error) {
	e.batchCalls++
	e.requests = append([]masking.ApplyRequest(nil), requests...)
	results := make([]masking.Result, len(requests))
	for index, request := range requests {
		results[index] = masking.Result{
			Action: masking.ActionRedacted, RedactedPrompt: "[BATCH_REDACTED]",
			LogSafePrompt: "[BATCH_REDACTED]", SecurityPolicyVersionID: request.SecurityPolicyVersionID,
		}
	}
	return results, nil
}

func (e *recordingMaskingEngine) Apply(_ context.Context, req masking.ApplyRequest) (masking.Result, error) {
	e.prompts = append(e.prompts, req.Prompt)
	return masking.Result{
		Action:                  masking.ActionRedacted,
		RedactedPrompt:          "[MODEL_REDACTED]",
		LogSafePrompt:           "[MODEL_REDACTED]",
		SecurityPolicyVersionID: req.SecurityPolicyVersionID,
	}, nil
}
