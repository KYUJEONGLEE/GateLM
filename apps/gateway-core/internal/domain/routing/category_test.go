package routing

import "testing"

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
