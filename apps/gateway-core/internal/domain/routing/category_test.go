package routing

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestRuleBasedCategoryClassifierUsesLowCardinalityCategories(t *testing.T) {
	classifier := NewRuleBasedCategoryClassifier()

	tests := []struct {
		name     string
		prompt   string
		expected string
	}{
		{name: "empty", prompt: "   ", expected: CategoryUnknown},
		{name: "general", prompt: "Explain how this feature works.", expected: CategoryGeneral},
		{name: "code", prompt: "Fix this TypeScript error in my function.", expected: CategoryCode},
		{name: "translation", prompt: "이 문장을 영어로 번역해줘.", expected: CategoryTranslation},
		{name: "summarization", prompt: "Summarize the meeting notes into three bullets.", expected: CategorySummarization},
		{name: "extraction json", prompt: "Extract the order id and status as JSON.", expected: CategoryExtractionJSON},
		{name: "extraction json schema underscore", prompt: "Return the response with json_schema fields.", expected: CategoryExtractionJSON},
		{name: "extraction json korean format", prompt: "결과를 json 포맷으로 변환해줘.", expected: CategoryExtractionJSON},
		{name: "support refund", prompt: "Write a short refund response for a customer.", expected: CategorySupportRefund},
		{name: "reasoning", prompt: "Compare these rollout options and explain the tradeoff.", expected: CategoryReasoning},
		{name: "routing does not own api key safety", prompt: "Check whether this api key handling guide is safe.", expected: CategoryGeneral},
		{name: "routing does not own authorization safety", prompt: "Review the authorization header handling policy.", expected: CategoryGeneral},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if actual := classifier.Classify(tt.prompt); actual != tt.expected {
				t.Fatalf("expected %s, got %s", tt.expected, actual)
			}
		})
	}
}

func TestExtractRoutingSignalsUsesBoundedCheapSignals(t *testing.T) {
	signals := ExtractRoutingSignals("Extract the invoice id as JSON.")

	if signals.Category != CategoryExtractionJSON {
		t.Fatalf("expected extraction_json, got %s", signals.Category)
	}
	if !signals.WantsStructuredOutput || signals.HasCodeSignal || signals.NeedsReasoning {
		t.Fatalf("unexpected routing signals: %+v", signals)
	}
	if signals.PromptLength == 0 {
		t.Fatalf("expected prompt length to be recorded")
	}
}

func TestRuleBasedCategoryClassifierScansBoundedPromptPrefix(t *testing.T) {
	classifier := NewRuleBasedCategoryClassifier()

	if actual := classifier.Classify("환불 " + strings.Repeat("가", maxCategoryScanBytes)); actual != CategorySupportRefund {
		t.Fatalf("expected prefix keyword to classify support refund, got %s", actual)
	}

	if actual := classifier.Classify(strings.Repeat("a", maxCategoryScanBytes+100) + " refund"); actual != CategoryGeneral {
		t.Fatalf("expected keyword beyond scan prefix to be ignored, got %s", actual)
	}
}

func TestCategoryScanPrefixKeepsUTF8Boundary(t *testing.T) {
	prefix := categoryScanPrefix(strings.Repeat("가", maxCategoryScanBytes))

	if len(prefix) > maxCategoryScanBytes {
		t.Fatalf("expected prefix length <= %d, got %d", maxCategoryScanBytes, len(prefix))
	}
	if !utf8.ValidString(prefix) {
		t.Fatalf("expected UTF-8 safe prefix, got %q", prefix)
	}
}
