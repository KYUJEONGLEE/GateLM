package cache

import (
	"context"
	"errors"
	"testing"
)

func TestCacheabilityClassifierResultContract(t *testing.T) {
	valid := []CacheabilityClassifierResult{
		{Label: CacheabilityLabelCacheableStatic, Confidence: 0.90, ReasonCode: "static", ModelVersion: "test-v1"},
		{Label: CacheabilityLabelCacheablePolicy, Confidence: 0.91, ReasonCode: "policy", ModelVersion: "test-v1"},
		{Label: CacheabilityLabelDynamicUserState, Confidence: 1.00, ReasonCode: "dynamic", ModelVersion: "test-v1"},
		{Label: CacheabilityLabelUnsafeOrUnknown, Confidence: 0.00, ReasonCode: "unknown", ModelVersion: "test-v1"},
	}

	for _, result := range valid {
		if err := result.Validate(); err != nil {
			t.Fatalf("valid classifier result failed validation: %+v err=%v", result, err)
		}
	}

	if !valid[0].Passes(0.90) {
		t.Fatalf("cacheable static result at threshold should pass")
	}
	if !valid[1].Passes(0.90) {
		t.Fatalf("cacheable policy result above threshold should pass")
	}
	if valid[2].Passes(0.90) {
		t.Fatalf("dynamic user state result must not pass cacheability gate")
	}
	if valid[3].Passes(0.90) {
		t.Fatalf("unsafe or unknown result must not pass cacheability gate")
	}

	invalid := []CacheabilityClassifierResult{
		{},
		{Label: "intent_refund", Confidence: 0.95, ReasonCode: "bad_label", ModelVersion: "test-v1"},
		{Label: CacheabilityLabelCacheableStatic, Confidence: -0.01, ReasonCode: "low", ModelVersion: "test-v1"},
		{Label: CacheabilityLabelCacheableStatic, Confidence: 1.01, ReasonCode: "high", ModelVersion: "test-v1"},
		{Label: CacheabilityLabelCacheableStatic, Confidence: 0.95, ModelVersion: "test-v1"},
		{Label: CacheabilityLabelCacheableStatic, Confidence: 0.95, ReasonCode: "missing_model"},
	}
	for _, result := range invalid {
		if err := result.Validate(); !errors.Is(err, ErrCacheabilityClassifierInvalidResult) {
			t.Fatalf("invalid classifier result should return contract error: %+v err=%v", result, err)
		}
	}
}

func TestNewCacheabilityClassifierDisabledReturnsNoop(t *testing.T) {
	classifier, err := NewCacheabilityClassifier(CacheabilityClassifierConfig{
		Enabled: true,
		Type:    CacheabilityClassifierTypeNoop,
	})
	if err != nil {
		t.Fatalf("noop classifier should construct without error: %v", err)
	}

	result, err := classifier.Classify(context.Background(), CacheabilityClassificationRequest{
		NormalizedText: "how to reset password",
	})
	if err != nil {
		t.Fatalf("noop classifier should not fail request classification: %v", err)
	}
	if result.Label != CacheabilityLabelUnsafeOrUnknown || result.Confidence != 0 || result.ReasonCode != CacheabilityReasonClassifierDisabled {
		t.Fatalf("noop classifier must fail closed: %+v", result)
	}
	if result.Passes(0.90) {
		t.Fatalf("noop classifier result must not pass cacheability gate")
	}

	disabled, err := NewCacheabilityClassifier(CacheabilityClassifierConfig{
		Enabled: false,
		Type:    CacheabilityClassifierTypeStub,
	})
	if err != nil {
		t.Fatalf("disabled stub config should return no-op without error: %v", err)
	}
	disabledResult, err := disabled.Classify(context.Background(), CacheabilityClassificationRequest{
		NormalizedText: "how to reset password",
	})
	if err != nil {
		t.Fatalf("disabled classifier should not fail request classification: %v", err)
	}
	if disabledResult.ReasonCode != CacheabilityReasonClassifierDisabled {
		t.Fatalf("disabled classifier should behave as no-op: %+v", disabledResult)
	}
}

func TestNewCacheabilityClassifierRejectsUnknownEnabledType(t *testing.T) {
	_, err := NewCacheabilityClassifier(CacheabilityClassifierConfig{
		Enabled: true,
		Type:    "remote_llm",
	})
	if !errors.Is(err, ErrCacheabilityClassifierUnsupportedType) {
		t.Fatalf("unknown enabled classifier type should return explicit error: %v", err)
	}
}

func TestDeterministicStubCacheabilityClassifier(t *testing.T) {
	classifier, err := NewCacheabilityClassifier(CacheabilityClassifierConfig{
		Enabled: true,
		Type:    CacheabilityClassifierTypeStub,
	})
	if err != nil {
		t.Fatalf("stub classifier should construct without error: %v", err)
	}

	cases := []struct {
		name      string
		text      string
		wantLabel CacheabilityLabel
		wantPass  bool
	}{
		{
			name:      "static how-to",
			text:      "how to reset password",
			wantLabel: CacheabilityLabelCacheableStatic,
			wantPass:  true,
		},
		{
			name:      "versioned policy",
			text:      "explain the versioned refund policy",
			wantLabel: CacheabilityLabelCacheablePolicy,
			wantPass:  true,
		},
		{
			name:      "dynamic user state",
			text:      "show my usage today",
			wantLabel: CacheabilityLabelDynamicUserState,
		},
		{
			name:      "unknown",
			text:      "compose a custom reply",
			wantLabel: CacheabilityLabelUnsafeOrUnknown,
		},
		{
			name:      "empty",
			text:      "   ",
			wantLabel: CacheabilityLabelUnsafeOrUnknown,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			first, err := classifier.Classify(context.Background(), CacheabilityClassificationRequest{
				NormalizedText: tc.text,
			})
			if err != nil {
				t.Fatalf("stub classification failed: %v", err)
			}
			second, err := classifier.Classify(context.Background(), CacheabilityClassificationRequest{
				NormalizedText: tc.text,
			})
			if err != nil {
				t.Fatalf("stub classification retry failed: %v", err)
			}
			if first != second {
				t.Fatalf("stub classifier must be deterministic: first=%+v second=%+v", first, second)
			}
			if err := first.Validate(); err != nil {
				t.Fatalf("stub result should satisfy classifier contract: %+v err=%v", first, err)
			}
			if first.Label != tc.wantLabel {
				t.Fatalf("stub label mismatch: got=%q want=%q result=%+v", first.Label, tc.wantLabel, first)
			}
			if first.Passes(0.90) != tc.wantPass {
				t.Fatalf("stub pass mismatch: got=%v want=%v result=%+v", first.Passes(0.90), tc.wantPass, first)
			}
		})
	}
}

func TestCacheabilityClassifierHonorsContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	classifier := DeterministicStubCacheabilityClassifier{}
	_, err := classifier.Classify(ctx, CacheabilityClassificationRequest{
		NormalizedText: "how to reset password",
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("classifier should return context cancellation: %v", err)
	}
}
