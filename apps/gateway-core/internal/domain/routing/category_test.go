package routing

import (
	"strings"
	"testing"
)

func TestCategoryClassifierIsDeterministicAndBounded(t *testing.T) {
	t.Parallel()
	classifier := NewRuleBasedCategoryClassifier()
	prompt := "Fix this TypeScript function error." + strings.Repeat("x", maxCategoryScanBytes*2)
	firstFeatures := ExtractPromptFeatures(prompt)
	secondFeatures := ExtractPromptFeatures(prompt)
	first := classifier.ClassifyFeatures(firstFeatures)
	second := classifier.ClassifyFeatures(secondFeatures)
	if first.Category != CategoryCode || second.Category != first.Category {
		t.Fatalf("unexpected deterministic classification: first=%q second=%q", first.Category, second.Category)
	}
	if firstFeatures.promptRuneLength <= maxCategoryScanBytes {
		t.Fatalf("promptRuneLength must describe the input, not the bounded scan: %d", firstFeatures.promptRuneLength)
	}
}

func TestCategoryDiagnosticsContainOnlyV2Categories(t *testing.T) {
	t.Parallel()
	features := ExtractPromptFeatures("Translate and summarize this note.")
	diagnostics := NewRuleBasedCategoryClassifier().ClassifyFeatures(features).Diagnostics
	allowed := map[string]bool{
		CategoryGeneral: true, CategoryCode: true, CategoryTranslation: true,
		CategorySummarization: true, CategoryReasoning: true,
	}
	if !allowed[diagnostics.TopCategory] || !allowed[diagnostics.SelectedCategory] {
		t.Fatalf("diagnostics escaped v2 categories: %#v", diagnostics)
	}
	for _, score := range diagnostics.ScoreVector {
		if !allowed[score.Category] {
			t.Fatalf("score vector escaped v2 categories: %#v", diagnostics.ScoreVector)
		}
	}
}

func BenchmarkRuleBasedCategoryClassifier(b *testing.B) {
	classifier := NewRuleBasedCategoryClassifier()
	prompt := "Compare these API implementation options and recommend one with tradeoffs."
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		features := ExtractPromptFeatures(prompt)
		_ = classifier.ClassifyFeatures(features)
	}
}
