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
		{name: "general", prompt: "Tell me a quick summary of this feature.", expected: CategoryGeneral},
		{name: "code", prompt: "Fix this TypeScript error in my function.", expected: CategoryCode},
		{name: "translation", prompt: "이 문장을 영어로 번역해줘.", expected: CategoryTranslation},
		{name: "support refund", prompt: "Write a short refund response for a customer.", expected: CategorySupportRefund},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if actual := classifier.Classify(tt.prompt); actual != tt.expected {
				t.Fatalf("expected %s, got %s", tt.expected, actual)
			}
		})
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
