package routing

import (
	"encoding/json"
	"os"
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

func TestCategoryEvalCasesFromFixture(t *testing.T) {
	payload, err := os.ReadFile("testdata/category_eval_cases.json")
	if err != nil {
		t.Fatalf("category 평가셋 fixture를 읽어야 함: %v", err)
	}

	var cases []struct {
		ID               string  `json:"id"`
		Prompt           *string `json:"prompt"`
		ExpectedCategory string  `json:"expectedCategory"`
	}
	if err := json.Unmarshal(payload, &cases); err != nil {
		t.Fatalf("category 평가셋 fixture JSON decode 실패: %v", err)
	}
	if len(cases) == 0 {
		t.Fatalf("category 평가셋 fixture는 비어 있으면 안 됨")
	}

	classifier := NewRuleBasedCategoryClassifier()
	for _, tc := range cases {
		t.Run(tc.ID, func(t *testing.T) {
			prompt := ""
			if tc.Prompt != nil {
				prompt = *tc.Prompt
			}
			if got := classifier.Classify(prompt); got != tc.ExpectedCategory {
				t.Fatalf("category 평가셋 불일치: got=%q want=%q", got, tc.ExpectedCategory)
			}
		})
	}
}
