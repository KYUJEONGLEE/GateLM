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

func TestRuleBasedCategoryClassifierFallsBackFromInvalidTranslationFrame(t *testing.T) {
	policy := DefaultCategoryPolicy()
	policy.CategoryPriority = []string{CategoryTranslation, CategorySupportRefund}
	policy.Rules[CategoryTranslation] = CategoryRule{Contains: []string{"translation"}, Threshold: 3}
	policy.Rules[CategorySupportRefund] = CategoryRule{Contains: []string{"refund"}, Threshold: 3}

	classifier := NewRuleBasedCategoryClassifierWithPolicy(policy)
	prompt := "refund request mentions translation menu but does not ask to translate"

	if actual := classifier.Classify(prompt); actual != CategorySupportRefund {
		t.Fatalf("expected invalid translation frame to fall back to support_refund, got %s", actual)
	}

	diagnostics := classifier.Diagnose(prompt)
	if diagnostics.TopCategory != CategorySupportRefund {
		t.Fatalf("expected diagnostics top category to use fallback candidate, got %#v", diagnostics)
	}
	if len(diagnostics.ScoreVector) < 2 || diagnostics.ScoreVector[0].Category != CategoryTranslation || diagnostics.ScoreVector[0].Matched {
		t.Fatalf("expected translation score to remain visible but unmatched, got %#v", diagnostics.ScoreVector)
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

func TestRuleBasedCategoryClassifierScansBoundedHeadAndTail(t *testing.T) {
	classifier := NewRuleBasedCategoryClassifier()

	if actual := classifier.Classify("refund " + strings.Repeat("a", maxCategoryScanBytes)); actual != CategorySupportRefund {
		t.Fatalf("expected head keyword to classify support refund, got %s", actual)
	}

	if actual := classifier.Classify(strings.Repeat("a", maxCategoryScanBytes+100) + " refund request"); actual != CategorySupportRefund {
		t.Fatalf("expected tail keyword to classify support refund, got %s", actual)
	}

	middleOnly := strings.Repeat("a", maxCategoryScanBytes/2+200) + " refund request " + strings.Repeat("b", maxCategoryScanBytes/2+200)
	if actual := classifier.Classify(middleOnly); actual != CategoryGeneral {
		t.Fatalf("expected middle-only keyword outside head/tail scan to be ignored, got %s", actual)
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

func TestRuleBasedCategoryClassifierBoostsExplicitRequestIntent(t *testing.T) {
	classifier := NewRuleBasedCategoryClassifier()

	tests := []struct {
		name     string
		prompt   string
		expected string
	}{
		{
			name:     "translation beats noisy technical context",
			prompt:   strings.Repeat("Go handler SQL request log code background. ", 40) + "마지막 요청: translate this notice into English.",
			expected: CategoryTranslation,
		},
		{
			name:     "summarization beats noisy implementation context",
			prompt:   strings.Repeat("TypeScript function JSON refund policy code. ", 40) + "최종 요청: summarize the meeting notes into three bullets.",
			expected: CategorySummarization,
		},
		{
			name:     "extraction beats noisy translation context",
			prompt:   strings.Repeat("English copy refund wording translation background. ", 40) + "결론적으로 return as JSON with invoice amount and status.",
			expected: CategoryExtractionJSON,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if actual := classifier.Classify(tt.prompt); actual != tt.expected {
				t.Fatalf("expected %s, got %s", tt.expected, actual)
			}
		})
	}
}

func TestCategoryExplicitRequestTextUsesLastMarker(t *testing.T) {
	prompt := normalizeCategoryText("Background mentions code and refund. 마지막 요청: translate this notice into English.")

	actual := categoryExplicitRequestText(prompt)
	if !strings.Contains(actual, "translate this notice into english") {
		t.Fatalf("expected explicit request window to include final request, got %q", actual)
	}
}

func TestRuleBasedCategoryClassifierUsesExplicitRequestBeforeBackground(t *testing.T) {
	classifier := NewRuleBasedCategoryClassifier()

	tests := []struct {
		name     string
		prompt   string
		expected string
	}{
		{
			name:     "general explanation is not hijacked by background code words",
			prompt:   strings.Repeat("Go handler SQL API request log code background. ", 30) + "Final request: explain what GateLM Gateway does for a non-developer.",
			expected: CategoryGeneral,
		},
		{
			name:     "explicit code repair still routes to code",
			prompt:   strings.Repeat("refund translation JSON meeting background. ", 30) + "Final request: find the bug in this Go Gateway handler code.",
			expected: CategoryCode,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if actual := classifier.Classify(tt.prompt); actual != tt.expected {
				t.Fatalf("expected %s, got %s", tt.expected, actual)
			}
		})
	}
}

func TestCategoryPhraseMatcherBuildsFailureLinksFromSourceState(t *testing.T) {
	matcher := newCategoryPhraseMatcher()
	seen := map[string]struct{}{}
	matcher.Add(CategoryCode, categoryPhraseStrong, "abcd", seen)
	matcher.Add(CategoryTranslation, categoryPhraseStrong, "bcd", seen)
	matcher.Build()

	matches := matcher.Match("abcd")
	if got := matches.Category(CategoryCode).Strong; got != 1 {
		t.Fatalf("expected code phrase to match once, got %d", got)
	}
	if got := matches.Category(CategoryTranslation).Strong; got != 1 {
		t.Fatalf("expected suffix phrase through failure link to match once, got %d", got)
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
