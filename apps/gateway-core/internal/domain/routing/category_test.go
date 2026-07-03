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
		{name: "general", prompt: "Explain how this feature works.", expected: CategoryGeneral},
		{name: "code", prompt: "Fix this TypeScript error in my function.", expected: CategoryCode},
		{name: "translation", prompt: "이 문장을 영어로 번역해줘.", expected: CategoryTranslation},
		{name: "summarization", prompt: "Summarize the meeting notes into three bullets.", expected: CategorySummarization},
		{name: "extraction json", prompt: "Extract the order id and status as JSON.", expected: CategoryExtractionJSON},
		{name: "extraction json schema underscore", prompt: "Return the response with json_schema fields.", expected: CategoryExtractionJSON},
		{name: "extraction json korean format", prompt: "결과를 json 포맷으로 변환해줘.", expected: CategoryExtractionJSON},
		{name: "plain extraction stays general", prompt: "이메일 주소만 추출해줘.", expected: CategoryGeneral},
		{name: "plain structure stays general", prompt: "문장 구조화 방법을 알려줘.", expected: CategoryGeneral},
		{name: "plain cleanup stays general", prompt: "생각 정리 방법을 알려줘.", expected: CategoryGeneral},
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

func TestDefaultCategoryPolicyIsLoadedFromDataFile(t *testing.T) {
	policy := DefaultCategoryPolicy()

	if policy.SchemaVersion != "gatelm.routing-category-policy.v1" {
		t.Fatalf("unexpected schema version: %q", policy.SchemaVersion)
	}
	if policy.PolicyVersion != "route_category_policy_v1" {
		t.Fatalf("unexpected policy version: %q", policy.PolicyVersion)
	}
	if len(policy.CategoryPriority) == 0 {
		t.Fatalf("expected category priority from policy file")
	}
	if len(policy.Rules[CategoryCode].Contains) == 0 {
		t.Fatalf("expected code category keywords from policy file")
	}
}

func TestRuleBasedCategoryClassifierUsesPolicyPriority(t *testing.T) {
	policy := DefaultCategoryPolicy()
	policy.CategoryPriority = []string{CategorySupportRefund, CategoryTranslation}

	classifier := NewRuleBasedCategoryClassifierWithPolicy(policy)
	actual := classifier.Classify("refund policy to english")

	if actual != CategorySupportRefund {
		t.Fatalf("expected policy priority to choose support_refund, got %s", actual)
	}
}

func TestRuleBasedCategoryClassifierClonesExternalPolicy(t *testing.T) {
	policy := CategoryPolicy{
		MaxScanBytes:     maxCategoryScanBytes,
		CategoryPriority: []string{CategorySupportRefund},
		Rules: map[string]CategoryRule{
			CategorySupportRefund: {Contains: []string{"refund"}},
		},
	}

	classifier := NewRuleBasedCategoryClassifierWithPolicy(policy)
	policy.CategoryPriority[0] = CategoryCode
	policy.Rules[CategorySupportRefund] = CategoryRule{}

	if actual := classifier.Classify("refund request"); actual != CategorySupportRefund {
		t.Fatalf("expected classifier to keep cloned policy, got %s", actual)
	}
}

func TestCategoryRuleSupportsRequiresAnyTokenWithoutRequiresToken(t *testing.T) {
	policy := CategoryPolicy{
		MaxScanBytes:     maxCategoryScanBytes,
		CategoryPriority: []string{CategoryReasoning},
		Rules: map[string]CategoryRule{
			CategoryReasoning: {RequiresAnyToken: []string{"compare", "tradeoff"}},
		},
	}
	classifier := NewRuleBasedCategoryClassifierWithPolicy(policy)

	if actual := classifier.Classify("compare these options"); actual != CategoryReasoning {
		t.Fatalf("expected requiresAnyToken-only rule to classify reasoning, got %s", actual)
	}
	if actual := classifier.Classify("plain message"); actual != CategoryGeneral {
		t.Fatalf("expected empty or unmet rule to stay general, got %s", actual)
	}
}

func TestDefaultCategoryPolicyReturnsClone(t *testing.T) {
	policy := DefaultCategoryPolicy()
	policy.CategoryPriority[0] = CategorySupportRefund
	policy.Rules[CategoryCode] = CategoryRule{}

	fresh := DefaultCategoryPolicy()
	if fresh.CategoryPriority[0] != CategoryCode {
		t.Fatalf("expected fresh default priority to remain code, got %s", fresh.CategoryPriority[0])
	}
	if len(fresh.Rules[CategoryCode].Contains) == 0 {
		t.Fatalf("expected fresh default code keywords to remain intact")
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
