package routing

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestPromptClassificationPipelineMatchesCompatibilityWrappers(t *testing.T) {
	t.Parallel()

	pipeline := NewRuleBasedPromptClassifier()
	categoryClassifier := NewRuleBasedCategoryClassifier()
	difficultyClassifier := NewRuleBasedDifficultyClassifier()
	tests := []string{
		"",
		"Explain OAuth briefly.",
		"Fix the syntax error in this one function.",
		"Debug a race condition across multiple files, refactor the architecture, and preserve performance.",
		"Translate this sentence to Korean.",
		"Summarize this report into key points.",
		"Compare these options and recommend one with tradeoffs.",
	}

	for _, prompt := range tests {
		prompt := prompt
		t.Run(prompt, func(t *testing.T) {
			result := pipeline.Classify(prompt)
			legacyCategory := categoryClassifier.Classify(prompt)
			legacyDifficulty := difficultyClassifier.Classify(prompt, legacyCategory)

			if result.Category.Category != legacyCategory {
				t.Fatalf("category mismatch: pipeline=%q compatibility=%q", result.Category.Category, legacyCategory)
			}
			if result.Difficulty.Difficulty != legacyDifficulty {
				t.Fatalf("difficulty mismatch: pipeline=%q compatibility=%q", result.Difficulty.Difficulty, legacyDifficulty)
			}
			legacySignals := categoryClassifier.ExtractRoutingSignals(prompt)
			if !reflect.DeepEqual(result.Category.Diagnostics, legacySignals.CategoryDiagnostics) {
				t.Fatalf("diagnostics mismatch: pipeline=%#v compatibility=%#v", result.Category.Diagnostics, legacySignals.CategoryDiagnostics)
			}
		})
	}
}

func TestPromptFeaturesDoNotExposePromptMaterialOrClassificationResults(t *testing.T) {
	t.Parallel()

	features := ExtractPromptFeatures("secret-like synthetic prompt: translate this")
	payload, err := json.Marshal(features)
	if err != nil {
		t.Fatalf("json.Marshal(PromptFeatures) error = %v", err)
	}
	if string(payload) != "{}" {
		t.Fatalf("PromptFeatures must remain opaque to JSON, got %s", payload)
	}

	typeOfFeatures := reflect.TypeOf(features)
	for index := 0; index < typeOfFeatures.NumField(); index++ {
		fieldName := strings.ToLower(typeOfFeatures.Field(index).Name)
		for _, forbidden := range []string{"category", "diagnostic", "difficulty", "complexity", "score"} {
			if strings.Contains(fieldName, forbidden) {
				t.Fatalf("PromptFeatures must not contain classification result field %q", typeOfFeatures.Field(index).Name)
			}
		}
	}

	difficultyPayload, err := json.Marshal(ExtractDifficultyFeatures(features, CategoryTranslation))
	if err != nil {
		t.Fatalf("json.Marshal(DifficultyFeatures) error = %v", err)
	}
	if string(difficultyPayload) != "{}" {
		t.Fatalf("DifficultyFeatures must remain opaque to JSON, got %s", difficultyPayload)
	}

	categoryPayload, err := json.Marshal(extractCategoryFeatures(features))
	if err != nil {
		t.Fatalf("json.Marshal(CategoryFeatures) error = %v", err)
	}
	if string(categoryPayload) != "{}" {
		t.Fatalf("CategoryFeatures must remain opaque to JSON, got %s", categoryPayload)
	}

	capabilityPayload, err := json.Marshal(ExtractModelCapabilityFeatures(features))
	if err != nil {
		t.Fatalf("json.Marshal(ModelCapabilityFeatures) error = %v", err)
	}
	if string(capabilityPayload) != "{}" {
		t.Fatalf("ModelCapabilityFeatures must remain opaque to JSON, got %s", capabilityPayload)
	}
}

func TestExtractPromptFeaturesDerivesExpandedCommonSignals(t *testing.T) {
	t.Parallel()

	prompt := "먼저 두 문서를 비교하고 보안 조건과 표 형식을 유지한 뒤 단계별 요약을 제안해줘."
	features := ExtractPromptFeatures(prompt)

	if features.promptRuneLength == 0 || features.wordCount == 0 || features.clauseCount < 2 {
		t.Fatalf("length and clause features were not derived: %#v", features)
	}
	if features.taskCount < 3 || features.constraintCount < 2 || features.scopeCount != 2 || features.dependencyDepth < 2 {
		t.Fatalf("workload features were not derived: %#v", features)
	}
	if features.languageBucket != "ko" || features.hasCodeFence || features.isMeaningless {
		t.Fatalf("language/shape features were not derived: %#v", features)
	}
}

func TestExtractPromptFeaturesCountsLeadingDependencyKeywords(t *testing.T) {
	t.Parallel()

	for _, prompt := range []string{
		"if ready",
		"then continue",
		"after review",
		"before release",
		"otherwise stop",
	} {
		prompt := prompt
		t.Run(prompt, func(t *testing.T) {
			t.Parallel()
			if actual := ExtractPromptFeatures(prompt).dependencyDepth; actual != 1 {
				t.Fatalf("dependencyDepth for %q = %d, want 1", prompt, actual)
			}
		})
	}
}

func TestGeneralDifficultyFeaturesCountLeadingIfOnce(t *testing.T) {
	t.Parallel()

	for _, prompt := range []string{
		"if ready",
		"if ready, reconsider if needed",
	} {
		prompt := prompt
		t.Run(prompt, func(t *testing.T) {
			t.Parallel()
			features := ExtractDifficultyFeatures(ExtractPromptFeatures(prompt), CategoryGeneral)
			if features.general == nil {
				t.Fatal("general difficulty features are nil")
			}
			if actual := features.general.branchOrExceptionCount; actual != 1 {
				t.Fatalf("branchOrExceptionCount for %q = %d, want 1", prompt, actual)
			}
		})
	}
}

func TestExtractPromptFeaturesSeparatesCodeFencePayload(t *testing.T) {
	t.Parallel()

	features := ExtractPromptFeatures("Fix and explain this code. ```go func main() {}``` Preserve the output format.")
	if !features.hasCodeFence || features.payloadText == "" {
		t.Fatalf("code payload was not separated: %#v", features)
	}
	if strings.Contains(features.instructionText, "func main") {
		t.Fatalf("instruction text retained code payload: %q", features.instructionText)
	}
}

func TestCategoryFeaturesRequireIntentAndSuppressNegativeContext(t *testing.T) {
	t.Parallel()

	codeFeatures := extractCategoryFeatures(ExtractPromptFeatures("Fix this TypeScript function error."))
	if codeFeatures.code.actionScore == 0 || codeFeatures.code.objectFitScore == 0 || codeFeatures.code.intentPairScore == 0 {
		t.Fatalf("code intent pair was not derived: %#v", codeFeatures.code)
	}

	menuFeatures := extractCategoryFeatures(ExtractPromptFeatures("API 키 목록이 안 보일 때 확인할 순서를 알려줘."))
	if menuFeatures.code.negativeContextScore == 0 {
		t.Fatalf("API key navigation context was not suppressed: %#v", menuFeatures.code)
	}
	if actual := NewRuleBasedCategoryClassifier().ClassifyFeatures(ExtractPromptFeatures("API 키 목록이 안 보일 때 확인할 순서를 알려줘.")).Category; actual != CategoryGeneral {
		t.Fatalf("API key navigation category = %q, want general", actual)
	}
}

func TestExtractDifficultyFeaturesUsesOnlySelectedCategoryRules(t *testing.T) {
	t.Parallel()

	features := ExtractPromptFeatures("Translate this while preserving formal tone and legal terminology.")
	translation := ExtractDifficultyFeatures(features, CategoryTranslation)
	code := ExtractDifficultyFeatures(features, CategoryCode)

	if translation.translation == nil || translation.translation.preservationConstraintCount < 2 {
		t.Fatalf("translation-specific features were not extracted: %#v", translation.translation)
	}
	if translation.code != nil || translation.general != nil || translation.summarization != nil || translation.reasoning != nil {
		t.Fatalf("non-selected category features were populated: %#v", translation)
	}
	if code.code == nil || code.translation != nil || code.general != nil || code.summarization != nil || code.reasoning != nil {
		t.Fatalf("selected code feature boundary was not preserved: %#v", code)
	}
	if translation.category != CategoryTranslation || code.category != CategoryCode {
		t.Fatalf("selected category was not preserved: translation=%q code=%q", translation.category, code.category)
	}
}

func TestCategorySpecificDifficultyFeaturesAreDerived(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		prompt   string
		category string
		check    func(DifficultyFeatures) bool
	}{
		{
			name: "general workflow", prompt: "여러 정책을 종합하고 실패 시 복구 절차를 단계별로 알려줘.", category: CategoryGeneral,
			check: func(features DifficultyFeatures) bool {
				return features.general != nil && features.general.workflowDepth >= 2 && features.general.hasCrossSourceSynthesis
			},
		},
		{
			name: "code concurrency", prompt: "여러 서비스의 경쟁 조건을 분석하고 성능 테스트 경계를 제시해줘.", category: CategoryCode,
			check: func(features DifficultyFeatures) bool {
				return features.code != nil && features.code.codeOperationKind == "concurrency" && features.code.causalComplexity > 0
			},
		},
		{
			name: "translation preservation", prompt: "법률 용어와 표 형식을 유지해 존댓말로 번역해줘.", category: CategoryTranslation,
			check: func(features DifficultyFeatures) bool {
				return features.translation != nil && features.translation.preservationConstraintCount >= 2 && features.translation.domainTerminologyLevel == 2
			},
		},
		{
			name: "summary synthesis", prompt: "세 문서의 충돌점과 결정 사항, 담당자를 근거와 함께 중복 없이 요약해줘.", category: CategorySummarization,
			check: func(features DifficultyFeatures) bool {
				return features.summarization != nil && features.summarization.sourceBreadth >= 3 && features.summarization.synthesisLevel == 2
			},
		},
		{
			name: "reasoning scenarios", prompt: "세 대안을 비용, 위험, 일정 기준으로 비교하고 실패 경로까지 단계별로 설명해줘.", category: CategoryReasoning,
			check: func(features DifficultyFeatures) bool {
				return features.reasoning != nil && features.reasoning.alternativeCount >= 3 && features.reasoning.criteriaAndConstraintCount >= 3
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			features := ExtractDifficultyFeatures(ExtractPromptFeatures(test.prompt), test.category)
			if !test.check(features) {
				t.Fatalf("category-specific difficulty features were not derived: %#v", features)
			}
		})
	}
}

func TestModelCapabilityFeaturesRemainOutsideClassification(t *testing.T) {
	t.Parallel()

	promptFeatures := ExtractPromptFeatures("Search the web and compare these two plans.")
	capabilityFeatures := ExtractModelCapabilityFeatures(promptFeatures)
	if capabilityFeatures.inputTokenEstimate <= 0 || !capabilityFeatures.toolIntent {
		t.Fatalf("capability features were not derived: %#v", capabilityFeatures)
	}

	typeOfPromptFeatures := reflect.TypeOf(promptFeatures)
	for _, forbidden := range []string{"inputTokenEstimate", "toolIntent"} {
		if _, exists := typeOfPromptFeatures.FieldByName(forbidden); exists {
			t.Fatalf("capability field leaked into PromptFeatures: %q", forbidden)
		}
	}
}

func BenchmarkRuleBasedPromptClassifier(b *testing.B) {
	classifier := NewRuleBasedPromptClassifier()
	prompt := "Compare these API implementation options and recommend one with tradeoffs."
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = classifier.Classify(prompt)
	}
}
