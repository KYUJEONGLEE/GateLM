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
}

func TestExtractDifficultyFeaturesUsesOnlySelectedCategoryRules(t *testing.T) {
	t.Parallel()

	features := ExtractPromptFeatures("Translate this while preserving formal tone and legal terminology.")
	translation := ExtractDifficultyFeatures(features, CategoryTranslation)
	code := ExtractDifficultyFeatures(features, CategoryCode)

	if !translation.hasCategoryComplexSignal {
		t.Fatal("translation-specific complex signal was not extracted")
	}
	if code.hasCategoryComplexSignal {
		t.Fatal("translation-specific signals leaked into code difficulty features")
	}
	if translation.category != CategoryTranslation || code.category != CategoryCode {
		t.Fatalf("selected category was not preserved: translation=%q code=%q", translation.category, code.category)
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
