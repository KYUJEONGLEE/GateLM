package safety

import (
	"context"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/masking"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

const validPolicyDigest = "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

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

func TestEvaluatorInspectsOnlyMessagesWithoutTrustedSafetyProvenance(t *testing.T) {
	engine := &recordingBatchMaskingEngine{}
	evaluator := NewEvaluatorWithEngine(engine)
	snapshot := tenantruntime.Snapshot{Policies: tenantruntime.Policies{Safety: tenantruntime.SafetyPolicy{
		Enabled: true, PolicyDigest: validPolicyDigest,
		DetectorSet: []tenantruntime.SafetyDetector{{DetectorType: "email", Action: "redact"}},
	}}}
	input := tenantchat.CompletionInput{Stream: true, Messages: []tenantchat.EphemeralMessage{
		{
			Role: "user", Content: "stored [EMAIL_1]",
			Safety: &tenantchat.SafetyProvenance{Status: "sanitized", PolicyDigest: validPolicyDigest},
		},
		{
			Role: "assistant", Content: "stored provider response",
			Safety: &tenantchat.SafetyProvenance{Status: "provider_generated"},
		},
		{Role: "user", Content: "new untrusted message"},
	}}

	result, err := evaluator.Evaluate(context.Background(), snapshot, input)
	if err != nil {
		t.Fatalf("evaluate provenance-aware input: %v", err)
	}
	if engine.batchCalls != 1 || len(engine.requests) != 1 || engine.requests[0].Prompt != "new untrusted message" {
		t.Fatalf("only untrusted message must be inspected: %+v", engine)
	}
	if result.Input.Messages[0].Content != input.Messages[0].Content ||
		result.Input.Messages[1].Content != input.Messages[1].Content ||
		result.Input.Messages[2].Content != "[BATCH_REDACTED]" {
		t.Fatalf("trusted history must remain byte-for-byte: %+v", result.Input.Messages)
	}
}

func TestEvaluatorSkipsEngineWhenEveryMessageHasTrustedSafetyProvenance(t *testing.T) {
	engine := &recordingBatchMaskingEngine{}
	evaluator := NewEvaluatorWithEngine(engine)
	snapshot := tenantruntime.Snapshot{Policies: tenantruntime.Policies{Safety: tenantruntime.SafetyPolicy{
		Enabled: true, PolicyDigest: validPolicyDigest,
		DetectorSet: []tenantruntime.SafetyDetector{{DetectorType: "email", Action: "redact"}},
	}}}
	historicalPolicyDigest := "sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
	input := tenantchat.CompletionInput{Stream: true, Messages: []tenantchat.EphemeralMessage{
		{
			Role: "user", Content: "stored [EMAIL_1]",
			Safety: &tenantchat.SafetyProvenance{Status: "sanitized", PolicyDigest: historicalPolicyDigest},
		},
		{
			Role: "assistant", Content: "stored provider response",
			Safety: &tenantchat.SafetyProvenance{Status: "provider_generated"},
		},
	}}

	result, err := evaluator.Evaluate(context.Background(), snapshot, input)
	if err != nil {
		t.Fatalf("evaluate fully trusted input: %v", err)
	}
	if engine.batchCalls != 0 || engine.applyCalls != 0 || len(engine.requests) != 0 {
		t.Fatalf("fully trusted input must make zero masking calls: %+v", engine)
	}
	for index := range input.Messages {
		if result.Input.Messages[index].Content != input.Messages[index].Content {
			t.Fatalf("trusted message %d changed: got %q want %q", index,
				result.Input.Messages[index].Content, input.Messages[index].Content)
		}
	}
}

func TestEvaluatorTreatsInvalidSafetyProvenanceAsLegacyUntrustedInput(t *testing.T) {
	engine := &recordingBatchMaskingEngine{}
	evaluator := NewEvaluatorWithEngine(engine)
	snapshot := tenantruntime.Snapshot{Policies: tenantruntime.Policies{Safety: tenantruntime.SafetyPolicy{
		Enabled: true, PolicyDigest: validPolicyDigest,
		DetectorSet: []tenantruntime.SafetyDetector{{DetectorType: "email", Action: "redact"}},
	}}}
	input := tenantchat.CompletionInput{Stream: true, Messages: []tenantchat.EphemeralMessage{
		{
			Role: "user", Content: "missing digest",
			Safety: &tenantchat.SafetyProvenance{Status: "sanitized"},
		},
		{
			Role: "assistant", Content: "forbidden digest",
			Safety: &tenantchat.SafetyProvenance{Status: "provider_generated", PolicyDigest: validPolicyDigest},
		},
		{
			Role: "system", Content: "wrong role",
			Safety: &tenantchat.SafetyProvenance{Status: "sanitized", PolicyDigest: validPolicyDigest},
		},
	}}

	result, err := evaluator.Evaluate(context.Background(), snapshot, input)
	if err != nil {
		t.Fatalf("evaluate invalid provenance: %v", err)
	}
	if len(engine.requests) != len(input.Messages) {
		t.Fatalf("invalid provenance must use legacy inspection, got %d requests", len(engine.requests))
	}
	for _, message := range result.Input.Messages {
		if message.Content != "[BATCH_REDACTED]" {
			t.Fatalf("invalid provenance message bypassed inspection: %+v", result.Input.Messages)
		}
	}
}

func TestEvaluatorSeedsPlaceholderCountersFromTrustedHistory(t *testing.T) {
	evaluator := NewEvaluator()
	snapshot := tenantruntime.Snapshot{Policies: tenantruntime.Policies{Safety: tenantruntime.SafetyPolicy{
		Enabled: true, PolicyDigest: validPolicyDigest,
		DetectorSet: []tenantruntime.SafetyDetector{{DetectorType: "email", Action: "redact"}},
	}}}
	input := tenantchat.CompletionInput{Stream: true, Messages: []tenantchat.EphemeralMessage{
		{
			Role: "assistant", Content: "Prior [EMAIL_4]",
			Safety: &tenantchat.SafetyProvenance{Status: "provider_generated"},
		},
		{Role: "user", Content: "Contact next@example.test"},
	}}

	result, err := evaluator.Evaluate(context.Background(), snapshot, input)
	if err != nil {
		t.Fatalf("evaluate seeded history: %v", err)
	}
	if !strings.Contains(result.Input.Messages[1].Content, "[EMAIL_5]") {
		t.Fatalf("new entity reused a trusted history placeholder: %q", result.Input.Messages[1].Content)
	}
}

func TestEvaluatorSanitizationReturnsLogSafeContent(t *testing.T) {
	evaluator := NewEvaluatorWithEngine(fixedMaskingEngine{result: masking.Result{
		Action: masking.ActionRedacted, RedactedPrompt: "provider-safe",
		LogSafePrompt: "storage-safe",
	}})
	snapshot := tenantruntime.Snapshot{Policies: tenantruntime.Policies{Safety: tenantruntime.SafetyPolicy{
		Enabled: true, PolicyDigest: validPolicyDigest,
		DetectorSet: []tenantruntime.SafetyDetector{{DetectorType: "email", Action: "redact"}},
	}}}

	result, err := evaluator.Sanitize(context.Background(), snapshot, tenantchat.SanitizationInput{
		Messages:            []tenantchat.EphemeralMessage{{Role: "user", Content: "raw input"}},
		PlaceholderCounters: map[string]int{"EMAIL": 4},
	})
	if err != nil {
		t.Fatalf("sanitize input: %v", err)
	}
	if result.Blocked || result.PolicyDigest != validPolicyDigest || len(result.Messages) != 1 ||
		result.Messages[0].ItemIndex != 0 || result.Messages[0].Content != "storage-safe" {
		t.Fatalf("sanitization must return only log-safe content: %+v", result)
	}
}

func TestEvaluatorSanitizationSafetyDisabledFailsClosed(t *testing.T) {
	engine := &recordingBatchMaskingEngine{}
	evaluator := NewEvaluatorWithEngine(engine)
	snapshot := tenantruntime.Snapshot{Policies: tenantruntime.Policies{Safety: tenantruntime.SafetyPolicy{
		Enabled: false, PolicyDigest: validPolicyDigest,
	}}}
	input := tenantchat.SanitizationInput{Messages: []tenantchat.EphemeralMessage{
		{Role: "user", Content: "raw input must be returned byte-for-byte"},
	}}

	result, err := evaluator.Sanitize(context.Background(), snapshot, input)
	if err != ErrUnavailable {
		t.Fatalf("disabled safety must fail closed before raw storage: result=%+v err=%v", result, err)
	}
	if engine.batchCalls != 0 || engine.applyCalls != 0 {
		t.Fatalf("disabled safety must not invoke the masking engine: engine=%+v", engine)
	}
}

type recordingMaskingEngine struct {
	prompts []string
}

type fixedMaskingEngine struct {
	result masking.Result
	err    error
}

func (e fixedMaskingEngine) Apply(_ context.Context, _ masking.ApplyRequest) (masking.Result, error) {
	return e.result, e.err
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
