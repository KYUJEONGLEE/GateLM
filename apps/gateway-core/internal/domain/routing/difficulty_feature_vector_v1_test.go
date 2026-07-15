package routing

import (
	"reflect"
	"testing"
)

func TestDifficultyFeatureVectorV1ContractMetadata(t *testing.T) {
	t.Parallel()

	if DifficultyFeatureVectorVersionV1 != "difficulty-feature-vector.v1" {
		t.Fatalf("DifficultyFeatureVectorVersionV1 = %q", DifficultyFeatureVectorVersionV1)
	}
	if DifficultyFeatureVectorDimensionV1 != 42 {
		t.Fatalf("DifficultyFeatureVectorDimensionV1 = %d, want 42", DifficultyFeatureVectorDimensionV1)
	}

	expected := []string{
		"payloadEmpty", "payloadSmall", "payloadMedium", "payloadLarge",
		"taskCount", "constraintCount", "scopeCount", "dependencyDepth",
		"categoryGeneral", "categoryCode", "categoryTranslation", "categorySummarization", "categoryReasoning",
		"generalWorkflowDepth", "generalBranchOrExceptionCount", "generalExtractionBreadth", "generalHasCrossSourceSynthesis",
		"codeOperationUnknown", "codeOperationSyntax", "codeOperationExample", "codeOperationSmallEdit", "codeOperationDebug",
		"codeOperationRefactor", "codeOperationDesign", "codeOperationMigration", "codeOperationConcurrency", "codeOperationPerformance",
		"codeScopeBreadth", "codeCausalComplexity", "codeEngineeringConstraintCount",
		"translationScopeCount", "translationPreservationConstraintCount", "translationDomainTerminologyLevel", "translationLocalizationDegree",
		"summarizationSourceBreadth", "summarizationSynthesisLevel", "summarizationFacetCount", "summarizationHasTraceabilityConstraints",
		"reasoningAlternativeCount", "reasoningCriteriaAndConstraintCount", "reasoningDepth", "reasoningUncertaintyScenarioCount",
	}
	names := DifficultyFeatureNamesV1()
	if !reflect.DeepEqual(names, expected) {
		t.Fatalf("DifficultyFeatureNamesV1() = %#v, want %#v", names, expected)
	}

	names[0] = "mutated"
	if actual := DifficultyFeatureNamesV1()[0]; actual != "payloadEmpty" {
		t.Fatalf("DifficultyFeatureNamesV1 exposed mutable contract storage: %q", actual)
	}
}

func TestFixedDifficultyFeatureVectorV1MatchesPublicContractWithoutAllocating(t *testing.T) {
	features := DifficultyFeatures{
		category: CategoryCode,
		common: CommonDifficultyFeatures{
			payloadSizeBucket: "medium",
			taskCount:         2,
			constraintCount:   3,
			scopeCount:        2,
			dependencyDepth:   1,
		},
		code: &CodeDifficultyFeatures{
			codeOperationKind:          "debug",
			codeScopeBreadth:           2,
			causalComplexity:           1,
			engineeringConstraintCount: 3,
		},
	}
	want := VectorizeDifficultyFeaturesV1(features)
	got := vectorizeDifficultyFeaturesV1Fixed(features)
	if !reflect.DeepEqual(got[:], want) {
		t.Fatalf("fixed vector = %#v, want %#v", got, want)
	}
	if allocations := testing.AllocsPerRun(1000, func() {
		vector := vectorizeDifficultyFeaturesV1Fixed(features)
		if vector[difficultyFeatureIndexCodeOperationDebug] != 1 {
			panic("unexpected fixed vector")
		}
	}); allocations != 0 {
		t.Fatalf("fixed vector allocations = %v, want 0", allocations)
	}
}

func TestVectorizeDifficultyFeaturesV1RepresentativeCategoryVectors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		features DifficultyFeatures
		expected map[int]float64
	}{
		{
			name: "general",
			features: DifficultyFeatures{
				category: CategoryGeneral,
				common:   CommonDifficultyFeatures{payloadSizeBucket: "medium", taskCount: 3, constraintCount: 3, scopeCount: 2, dependencyDepth: 4},
				general:  &GeneralDifficultyFeatures{workflowDepth: 2, branchOrExceptionCount: 3, extractionBreadth: 3, hasCrossSourceSynthesis: true},
			},
			expected: map[int]float64{2: 1, 4: 3.0 / 5.0, 5: 3.0 / 6.0, 6: 2.0 / 4.0, 7: 4.0 / 5.0, 8: 1, 13: 2.0 / 5.0, 14: 3.0 / 5.0, 15: 3.0 / 6.0, 16: 1},
		},
		{
			name: "code",
			features: DifficultyFeatures{
				category: CategoryCode,
				common:   CommonDifficultyFeatures{payloadSizeBucket: "small", taskCount: 1, scopeCount: 1},
				code:     &CodeDifficultyFeatures{codeOperationKind: "debug", codeScopeBreadth: 2, causalComplexity: 3, engineeringConstraintCount: 4},
			},
			expected: map[int]float64{1: 1, 4: 1.0 / 5.0, 6: 1.0 / 4.0, 9: 1, 21: 1, 27: 2.0 / 4.0, 28: 3.0 / 4.0, 29: 4.0 / 6.0},
		},
		{
			name: "translation",
			features: DifficultyFeatures{
				category:    CategoryTranslation,
				common:      CommonDifficultyFeatures{payloadSizeBucket: "large", constraintCount: 2},
				translation: &TranslationDifficultyFeatures{translationScopeCount: 3, preservationConstraintCount: 4, domainTerminologyLevel: 1, localizationDegree: 2},
			},
			expected: map[int]float64{3: 1, 5: 2.0 / 6.0, 10: 1, 30: 3.0 / 4.0, 31: 4.0 / 7.0, 32: 1.0 / 2.0, 33: 1},
		},
		{
			name: "summarization",
			features: DifficultyFeatures{
				category:      CategorySummarization,
				common:        CommonDifficultyFeatures{payloadSizeBucket: "small", dependencyDepth: 2},
				summarization: &SummarizationDifficultyFeatures{sourceBreadth: 3, synthesisLevel: 1, facetCount: 5, hasTraceabilityConstraints: true},
			},
			expected: map[int]float64{1: 1, 7: 2.0 / 5.0, 11: 1, 34: 3.0 / 4.0, 35: 1.0 / 2.0, 36: 5.0 / 7.0, 37: 1},
		},
		{
			name: "reasoning",
			features: DifficultyFeatures{
				category:  CategoryReasoning,
				common:    CommonDifficultyFeatures{payloadSizeBucket: "medium", scopeCount: 3},
				reasoning: &ReasoningDifficultyFeatures{alternativeCount: 2, criteriaAndConstraintCount: 6, reasoningDepth: 3, uncertaintyScenarioCount: 4},
			},
			expected: map[int]float64{2: 1, 6: 3.0 / 4.0, 12: 1, 38: 2.0 / 4.0, 39: 6.0 / 8.0, 40: 3.0 / 5.0, 41: 4.0 / 6.0},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			actual := VectorizeDifficultyFeaturesV1(test.features)
			expected := make([]float64, 42)
			for index, value := range test.expected {
				expected[index] = value
			}
			if !reflect.DeepEqual(actual, expected) {
				t.Fatalf("VectorizeDifficultyFeaturesV1() = %#v, want %#v", actual, expected)
			}
		})
	}
}

func TestVectorizeDifficultyFeaturesV1NumericClippingAndScaling(t *testing.T) {
	t.Parallel()

	type numericCase struct {
		name     string
		index    int
		maximum  int
		features func(value int) DifficultyFeatures
	}
	general := func() DifficultyFeatures {
		return DifficultyFeatures{category: CategoryGeneral, general: &GeneralDifficultyFeatures{}}
	}
	tests := []numericCase{
		{name: "taskCount", index: 4, maximum: 5, features: func(value int) DifficultyFeatures {
			features := general()
			features.common.taskCount = value
			return features
		}},
		{name: "constraintCount", index: 5, maximum: 6, features: func(value int) DifficultyFeatures {
			features := general()
			features.common.constraintCount = value
			return features
		}},
		{name: "scopeCount", index: 6, maximum: 4, features: func(value int) DifficultyFeatures {
			features := general()
			features.common.scopeCount = value
			return features
		}},
		{name: "dependencyDepth", index: 7, maximum: 5, features: func(value int) DifficultyFeatures {
			features := general()
			features.common.dependencyDepth = value
			return features
		}},
		{name: "generalWorkflowDepth", index: 13, maximum: 5, features: func(value int) DifficultyFeatures {
			features := general()
			features.general.workflowDepth = value
			return features
		}},
		{name: "generalBranchOrExceptionCount", index: 14, maximum: 5, features: func(value int) DifficultyFeatures {
			features := general()
			features.general.branchOrExceptionCount = value
			return features
		}},
		{name: "generalExtractionBreadth", index: 15, maximum: 6, features: func(value int) DifficultyFeatures {
			features := general()
			features.general.extractionBreadth = value
			return features
		}},
		{name: "codeScopeBreadth", index: 27, maximum: 4, features: func(value int) DifficultyFeatures {
			return DifficultyFeatures{category: CategoryCode, code: &CodeDifficultyFeatures{codeScopeBreadth: value}}
		}},
		{name: "codeCausalComplexity", index: 28, maximum: 4, features: func(value int) DifficultyFeatures {
			return DifficultyFeatures{category: CategoryCode, code: &CodeDifficultyFeatures{causalComplexity: value}}
		}},
		{name: "codeEngineeringConstraintCount", index: 29, maximum: 6, features: func(value int) DifficultyFeatures {
			return DifficultyFeatures{category: CategoryCode, code: &CodeDifficultyFeatures{engineeringConstraintCount: value}}
		}},
		{name: "translationScopeCount", index: 30, maximum: 4, features: func(value int) DifficultyFeatures {
			return DifficultyFeatures{category: CategoryTranslation, translation: &TranslationDifficultyFeatures{translationScopeCount: value}}
		}},
		{name: "translationPreservationConstraintCount", index: 31, maximum: 7, features: func(value int) DifficultyFeatures {
			return DifficultyFeatures{category: CategoryTranslation, translation: &TranslationDifficultyFeatures{preservationConstraintCount: value}}
		}},
		{name: "translationDomainTerminologyLevel", index: 32, maximum: 2, features: func(value int) DifficultyFeatures {
			return DifficultyFeatures{category: CategoryTranslation, translation: &TranslationDifficultyFeatures{domainTerminologyLevel: value}}
		}},
		{name: "translationLocalizationDegree", index: 33, maximum: 2, features: func(value int) DifficultyFeatures {
			return DifficultyFeatures{category: CategoryTranslation, translation: &TranslationDifficultyFeatures{localizationDegree: value}}
		}},
		{name: "summarizationSourceBreadth", index: 34, maximum: 4, features: func(value int) DifficultyFeatures {
			return DifficultyFeatures{category: CategorySummarization, summarization: &SummarizationDifficultyFeatures{sourceBreadth: value}}
		}},
		{name: "summarizationSynthesisLevel", index: 35, maximum: 2, features: func(value int) DifficultyFeatures {
			return DifficultyFeatures{category: CategorySummarization, summarization: &SummarizationDifficultyFeatures{synthesisLevel: value}}
		}},
		{name: "summarizationFacetCount", index: 36, maximum: 7, features: func(value int) DifficultyFeatures {
			return DifficultyFeatures{category: CategorySummarization, summarization: &SummarizationDifficultyFeatures{facetCount: value}}
		}},
		{name: "reasoningAlternativeCount", index: 38, maximum: 4, features: func(value int) DifficultyFeatures {
			return DifficultyFeatures{category: CategoryReasoning, reasoning: &ReasoningDifficultyFeatures{alternativeCount: value}}
		}},
		{name: "reasoningCriteriaAndConstraintCount", index: 39, maximum: 8, features: func(value int) DifficultyFeatures {
			return DifficultyFeatures{category: CategoryReasoning, reasoning: &ReasoningDifficultyFeatures{criteriaAndConstraintCount: value}}
		}},
		{name: "reasoningDepth", index: 40, maximum: 5, features: func(value int) DifficultyFeatures {
			return DifficultyFeatures{category: CategoryReasoning, reasoning: &ReasoningDifficultyFeatures{reasoningDepth: value}}
		}},
		{name: "reasoningUncertaintyScenarioCount", index: 41, maximum: 6, features: func(value int) DifficultyFeatures {
			return DifficultyFeatures{category: CategoryReasoning, reasoning: &ReasoningDifficultyFeatures{uncertaintyScenarioCount: value}}
		}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			values := []struct {
				value    int
				expected float64
			}{
				{value: -1, expected: 0},
				{value: 1, expected: 1.0 / float64(test.maximum)},
				{value: test.maximum, expected: 1},
				{value: test.maximum + 1, expected: 1},
			}
			for _, value := range values {
				actual := VectorizeDifficultyFeaturesV1(test.features(value.value))[test.index]
				if actual != value.expected {
					t.Fatalf("value %d encoded as %v, want %v", value.value, actual, value.expected)
				}
			}
		})
	}
}

func TestVectorizeDifficultyFeaturesV1PayloadAndCodeOperationEnums(t *testing.T) {
	t.Parallel()

	for bucket, expectedIndex := range map[string]int{"empty": 0, "small": 1, "medium": 2, "large": 3} {
		features := DifficultyFeatures{category: CategoryGeneral, common: CommonDifficultyFeatures{payloadSizeBucket: bucket}, general: &GeneralDifficultyFeatures{}}
		vector := VectorizeDifficultyFeaturesV1(features)
		assertOneHotRange(t, vector, 0, 4, expectedIndex)
	}
	for _, bucket := range []string{"", "unknown", "MEDIUM"} {
		features := DifficultyFeatures{category: CategoryGeneral, common: CommonDifficultyFeatures{payloadSizeBucket: bucket}, general: &GeneralDifficultyFeatures{}}
		vector := VectorizeDifficultyFeaturesV1(features)
		assertOneHotRange(t, vector, 0, 4, -1)
	}

	operations := []struct {
		value string
		index int
	}{
		{value: "unknown", index: 17},
		{value: "syntax", index: 18},
		{value: "example", index: 19},
		{value: "small_edit", index: 20},
		{value: "debug", index: 21},
		{value: "refactor", index: 22},
		{value: "design", index: 23},
		{value: "migration", index: 24},
		{value: "concurrency", index: 25},
		{value: "performance", index: 26},
		{value: "", index: 17},
		{value: "DEBUG", index: 17},
		{value: "contract-outside", index: 17},
	}
	for _, operation := range operations {
		t.Run("code_operation_"+operation.value, func(t *testing.T) {
			features := DifficultyFeatures{category: CategoryCode, code: &CodeDifficultyFeatures{codeOperationKind: operation.value}}
			vector := VectorizeDifficultyFeaturesV1(features)
			assertOneHotRange(t, vector, 17, 27, operation.index)
		})
	}
}

func TestVectorizeDifficultyFeaturesV1CategoryAuthorityAndZeroFill(t *testing.T) {
	t.Parallel()

	categories := []struct {
		value string
		index int
	}{
		{value: CategoryGeneral, index: 8},
		{value: CategoryCode, index: 9},
		{value: CategoryTranslation, index: 10},
		{value: CategorySummarization, index: 11},
		{value: CategoryReasoning, index: 12},
		{value: "unknown", index: 8},
		{value: " CODE ", index: 9},
	}
	for _, category := range categories {
		features := DifficultyFeatures{
			category:      category.value,
			general:       &GeneralDifficultyFeatures{workflowDepth: 5, branchOrExceptionCount: 5, extractionBreadth: 6, hasCrossSourceSynthesis: true},
			code:          &CodeDifficultyFeatures{codeOperationKind: "debug", codeScopeBreadth: 4, causalComplexity: 4, engineeringConstraintCount: 6},
			translation:   &TranslationDifficultyFeatures{translationScopeCount: 4, preservationConstraintCount: 7, domainTerminologyLevel: 2, localizationDegree: 2},
			summarization: &SummarizationDifficultyFeatures{sourceBreadth: 4, synthesisLevel: 2, facetCount: 7, hasTraceabilityConstraints: true},
			reasoning:     &ReasoningDifficultyFeatures{alternativeCount: 4, criteriaAndConstraintCount: 8, reasoningDepth: 5, uncertaintyScenarioCount: 6},
		}
		vector := VectorizeDifficultyFeaturesV1(features)
		assertOneHotRange(t, vector, 8, 13, category.index)
		expectedCategoryFeatures := map[int]bool{}
		switch category.index {
		case 8:
			for _, index := range []int{13, 14, 15, 16} {
				expectedCategoryFeatures[index] = true
			}
		case 9:
			for _, index := range []int{21, 27, 28, 29} {
				expectedCategoryFeatures[index] = true
			}
		case 10:
			for _, index := range []int{30, 31, 32, 33} {
				expectedCategoryFeatures[index] = true
			}
		case 11:
			for _, index := range []int{34, 35, 36, 37} {
				expectedCategoryFeatures[index] = true
			}
		case 12:
			for _, index := range []int{38, 39, 40, 41} {
				expectedCategoryFeatures[index] = true
			}
		}
		for index := 13; index < 42; index++ {
			selected := expectedCategoryFeatures[index]
			if selected && vector[index] != 1 {
				t.Fatalf("category %q selected index %d = %v, want 1", category.value, index, vector[index])
			}
			if !selected && vector[index] != 0 {
				t.Fatalf("category %q leaked non-selected index %d = %v", category.value, index, vector[index])
			}
		}
	}

	missingCode := VectorizeDifficultyFeaturesV1(DifficultyFeatures{
		category: CategoryCode,
		general:  &GeneralDifficultyFeatures{workflowDepth: 5},
	})
	assertOneHotRange(t, missingCode, 8, 13, 9)
	for index := 13; index < 42; index++ {
		if missingCode[index] != 0 {
			t.Fatalf("nil selected pointer encoded index %d = %v, want 0", index, missingCode[index])
		}
	}
}

func TestVectorizeDifficultyFeaturesV1EmptyInputAndIndependentResults(t *testing.T) {
	t.Parallel()

	features := ExtractDifficultyFeatures(ExtractPromptFeatures(""), CategoryGeneral)
	first := VectorizeDifficultyFeaturesV1(features)
	expected := make([]float64, 42)
	expected[0] = 1
	expected[8] = 1
	if !reflect.DeepEqual(first, expected) {
		t.Fatalf("empty input vector = %#v, want %#v", first, expected)
	}

	second := VectorizeDifficultyFeaturesV1(features)
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("same input was not deterministic: first=%#v second=%#v", first, second)
	}
	first[0] = 0
	if second[0] != 1 {
		t.Fatalf("vector calls shared mutable backing storage: second[0]=%v", second[0])
	}
}

func TestVectorizeDifficultyFeaturesV1Booleans(t *testing.T) {
	t.Parallel()

	generalFalse := VectorizeDifficultyFeaturesV1(DifficultyFeatures{category: CategoryGeneral, general: &GeneralDifficultyFeatures{}})
	generalTrue := VectorizeDifficultyFeaturesV1(DifficultyFeatures{category: CategoryGeneral, general: &GeneralDifficultyFeatures{hasCrossSourceSynthesis: true}})
	if generalFalse[16] != 0 || generalTrue[16] != 1 {
		t.Fatalf("general boolean encoding = %v/%v, want 0/1", generalFalse[16], generalTrue[16])
	}

	summaryFalse := VectorizeDifficultyFeaturesV1(DifficultyFeatures{category: CategorySummarization, summarization: &SummarizationDifficultyFeatures{}})
	summaryTrue := VectorizeDifficultyFeaturesV1(DifficultyFeatures{category: CategorySummarization, summarization: &SummarizationDifficultyFeatures{hasTraceabilityConstraints: true}})
	if summaryFalse[37] != 0 || summaryTrue[37] != 1 {
		t.Fatalf("summarization boolean encoding = %v/%v, want 0/1", summaryFalse[37], summaryTrue[37])
	}
}

func assertOneHotRange(t *testing.T, vector []float64, start int, end int, expectedIndex int) {
	t.Helper()
	for index := start; index < end; index++ {
		expected := 0.0
		if index == expectedIndex {
			expected = 1
		}
		if vector[index] != expected {
			t.Fatalf("one-hot index %d = %v, want %v", index, vector[index], expected)
		}
	}
}
