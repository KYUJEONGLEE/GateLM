package routing

const DifficultyFeatureVectorVersionV1 = "difficulty-feature-vector.v1"

const (
	difficultyFeatureIndexPayloadEmpty = iota
	difficultyFeatureIndexPayloadSmall
	difficultyFeatureIndexPayloadMedium
	difficultyFeatureIndexPayloadLarge
	difficultyFeatureIndexTaskCount
	difficultyFeatureIndexConstraintCount
	difficultyFeatureIndexScopeCount
	difficultyFeatureIndexDependencyDepth
	difficultyFeatureIndexCategoryGeneral
	difficultyFeatureIndexCategoryCode
	difficultyFeatureIndexCategoryTranslation
	difficultyFeatureIndexCategorySummarization
	difficultyFeatureIndexCategoryReasoning
	difficultyFeatureIndexGeneralWorkflowDepth
	difficultyFeatureIndexGeneralBranchOrExceptionCount
	difficultyFeatureIndexGeneralExtractionBreadth
	difficultyFeatureIndexGeneralHasCrossSourceSynthesis
	difficultyFeatureIndexCodeOperationUnknown
	difficultyFeatureIndexCodeOperationSyntax
	difficultyFeatureIndexCodeOperationExample
	difficultyFeatureIndexCodeOperationSmallEdit
	difficultyFeatureIndexCodeOperationDebug
	difficultyFeatureIndexCodeOperationRefactor
	difficultyFeatureIndexCodeOperationDesign
	difficultyFeatureIndexCodeOperationMigration
	difficultyFeatureIndexCodeOperationConcurrency
	difficultyFeatureIndexCodeOperationPerformance
	difficultyFeatureIndexCodeScopeBreadth
	difficultyFeatureIndexCodeCausalComplexity
	difficultyFeatureIndexCodeEngineeringConstraintCount
	difficultyFeatureIndexTranslationScopeCount
	difficultyFeatureIndexTranslationPreservationConstraintCount
	difficultyFeatureIndexTranslationDomainTerminologyLevel
	difficultyFeatureIndexTranslationLocalizationDegree
	difficultyFeatureIndexSummarizationSourceBreadth
	difficultyFeatureIndexSummarizationSynthesisLevel
	difficultyFeatureIndexSummarizationFacetCount
	difficultyFeatureIndexSummarizationHasTraceabilityConstraints
	difficultyFeatureIndexReasoningAlternativeCount
	difficultyFeatureIndexReasoningCriteriaAndConstraintCount
	difficultyFeatureIndexReasoningDepth
	difficultyFeatureIndexReasoningUncertaintyScenarioCount
	difficultyFeatureVectorComputedDimensionV1
)

const DifficultyFeatureVectorDimensionV1 = difficultyFeatureVectorComputedDimensionV1

var difficultyFeatureNamesV1 = [DifficultyFeatureVectorDimensionV1]string{
	"payloadEmpty",
	"payloadSmall",
	"payloadMedium",
	"payloadLarge",
	"taskCount",
	"constraintCount",
	"scopeCount",
	"dependencyDepth",
	"categoryGeneral",
	"categoryCode",
	"categoryTranslation",
	"categorySummarization",
	"categoryReasoning",
	"generalWorkflowDepth",
	"generalBranchOrExceptionCount",
	"generalExtractionBreadth",
	"generalHasCrossSourceSynthesis",
	"codeOperationUnknown",
	"codeOperationSyntax",
	"codeOperationExample",
	"codeOperationSmallEdit",
	"codeOperationDebug",
	"codeOperationRefactor",
	"codeOperationDesign",
	"codeOperationMigration",
	"codeOperationConcurrency",
	"codeOperationPerformance",
	"codeScopeBreadth",
	"codeCausalComplexity",
	"codeEngineeringConstraintCount",
	"translationScopeCount",
	"translationPreservationConstraintCount",
	"translationDomainTerminologyLevel",
	"translationLocalizationDegree",
	"summarizationSourceBreadth",
	"summarizationSynthesisLevel",
	"summarizationFacetCount",
	"summarizationHasTraceabilityConstraints",
	"reasoningAlternativeCount",
	"reasoningCriteriaAndConstraintCount",
	"reasoningDepth",
	"reasoningUncertaintyScenarioCount",
}

// DifficultyFeatureNamesV1 returns a copy of the immutable v1 feature contract.
func DifficultyFeatureNamesV1() []string {
	names := make([]string, DifficultyFeatureVectorDimensionV1)
	copy(names, difficultyFeatureNamesV1[:])
	return names
}

// VectorizeDifficultyFeaturesV1 converts difficulty features into the stable
// difficulty-feature-vector.v1 Logistic Regression input. The model intercept
// is stored separately and is not part of this vector.
func VectorizeDifficultyFeaturesV1(features DifficultyFeatures) []float64 {
	fixed := vectorizeDifficultyFeaturesV1Fixed(features)
	vector := make([]float64, DifficultyFeatureVectorDimensionV1)
	copy(vector, fixed[:])
	return vector
}

func vectorizeDifficultyFeaturesV1Fixed(features DifficultyFeatures) [DifficultyFeatureVectorDimensionV1]float64 {
	var vector [DifficultyFeatureVectorDimensionV1]float64
	values := vector[:]

	encodePayloadSizeBucketV1(values, features.common.payloadSizeBucket)
	values[difficultyFeatureIndexTaskCount] = scaleDifficultyFeatureV1(features.common.taskCount, 5)
	values[difficultyFeatureIndexConstraintCount] = scaleDifficultyFeatureV1(features.common.constraintCount, 6)
	values[difficultyFeatureIndexScopeCount] = scaleDifficultyFeatureV1(features.common.scopeCount, 4)
	values[difficultyFeatureIndexDependencyDepth] = scaleDifficultyFeatureV1(features.common.dependencyDepth, 5)

	category := canonicalCategory(features.category)
	switch category {
	case CategoryCode:
		values[difficultyFeatureIndexCategoryCode] = 1
		encodeCodeDifficultyFeaturesV1(values, features.code)
	case CategoryTranslation:
		values[difficultyFeatureIndexCategoryTranslation] = 1
		encodeTranslationDifficultyFeaturesV1(values, features.translation)
	case CategorySummarization:
		values[difficultyFeatureIndexCategorySummarization] = 1
		encodeSummarizationDifficultyFeaturesV1(values, features.summarization)
	case CategoryReasoning:
		values[difficultyFeatureIndexCategoryReasoning] = 1
		encodeReasoningDifficultyFeaturesV1(values, features.reasoning)
	default:
		values[difficultyFeatureIndexCategoryGeneral] = 1
		encodeGeneralDifficultyFeaturesV1(values, features.general)
	}

	return vector
}

func encodePayloadSizeBucketV1(vector []float64, bucket string) {
	switch bucket {
	case "empty":
		vector[difficultyFeatureIndexPayloadEmpty] = 1
	case "small":
		vector[difficultyFeatureIndexPayloadSmall] = 1
	case "medium":
		vector[difficultyFeatureIndexPayloadMedium] = 1
	case "large":
		vector[difficultyFeatureIndexPayloadLarge] = 1
	}
}

func encodeGeneralDifficultyFeaturesV1(vector []float64, features *GeneralDifficultyFeatures) {
	if features == nil {
		return
	}
	vector[difficultyFeatureIndexGeneralWorkflowDepth] = scaleDifficultyFeatureV1(features.workflowDepth, 5)
	vector[difficultyFeatureIndexGeneralBranchOrExceptionCount] = scaleDifficultyFeatureV1(features.branchOrExceptionCount, 5)
	vector[difficultyFeatureIndexGeneralExtractionBreadth] = scaleDifficultyFeatureV1(features.extractionBreadth, 6)
	vector[difficultyFeatureIndexGeneralHasCrossSourceSynthesis] = boolDifficultyFeatureV1(features.hasCrossSourceSynthesis)
}

func encodeCodeDifficultyFeaturesV1(vector []float64, features *CodeDifficultyFeatures) {
	if features == nil {
		return
	}
	encodeCodeOperationKindV1(vector, features.codeOperationKind)
	vector[difficultyFeatureIndexCodeScopeBreadth] = scaleDifficultyFeatureV1(features.codeScopeBreadth, 4)
	vector[difficultyFeatureIndexCodeCausalComplexity] = scaleDifficultyFeatureV1(features.causalComplexity, 4)
	vector[difficultyFeatureIndexCodeEngineeringConstraintCount] = scaleDifficultyFeatureV1(features.engineeringConstraintCount, 6)
}

func encodeCodeOperationKindV1(vector []float64, operation string) {
	index := difficultyFeatureIndexCodeOperationUnknown
	switch operation {
	case "syntax":
		index = difficultyFeatureIndexCodeOperationSyntax
	case "example":
		index = difficultyFeatureIndexCodeOperationExample
	case "small_edit":
		index = difficultyFeatureIndexCodeOperationSmallEdit
	case "debug":
		index = difficultyFeatureIndexCodeOperationDebug
	case "refactor":
		index = difficultyFeatureIndexCodeOperationRefactor
	case "design":
		index = difficultyFeatureIndexCodeOperationDesign
	case "migration":
		index = difficultyFeatureIndexCodeOperationMigration
	case "concurrency":
		index = difficultyFeatureIndexCodeOperationConcurrency
	case "performance":
		index = difficultyFeatureIndexCodeOperationPerformance
	}
	vector[index] = 1
}

func encodeTranslationDifficultyFeaturesV1(vector []float64, features *TranslationDifficultyFeatures) {
	if features == nil {
		return
	}
	vector[difficultyFeatureIndexTranslationScopeCount] = scaleDifficultyFeatureV1(features.translationScopeCount, 4)
	vector[difficultyFeatureIndexTranslationPreservationConstraintCount] = scaleDifficultyFeatureV1(features.preservationConstraintCount, 7)
	vector[difficultyFeatureIndexTranslationDomainTerminologyLevel] = scaleDifficultyFeatureV1(features.domainTerminologyLevel, 2)
	vector[difficultyFeatureIndexTranslationLocalizationDegree] = scaleDifficultyFeatureV1(features.localizationDegree, 2)
}

func encodeSummarizationDifficultyFeaturesV1(vector []float64, features *SummarizationDifficultyFeatures) {
	if features == nil {
		return
	}
	vector[difficultyFeatureIndexSummarizationSourceBreadth] = scaleDifficultyFeatureV1(features.sourceBreadth, 4)
	vector[difficultyFeatureIndexSummarizationSynthesisLevel] = scaleDifficultyFeatureV1(features.synthesisLevel, 2)
	vector[difficultyFeatureIndexSummarizationFacetCount] = scaleDifficultyFeatureV1(features.facetCount, 7)
	vector[difficultyFeatureIndexSummarizationHasTraceabilityConstraints] = boolDifficultyFeatureV1(features.hasTraceabilityConstraints)
}

func encodeReasoningDifficultyFeaturesV1(vector []float64, features *ReasoningDifficultyFeatures) {
	if features == nil {
		return
	}
	vector[difficultyFeatureIndexReasoningAlternativeCount] = scaleDifficultyFeatureV1(features.alternativeCount, 4)
	vector[difficultyFeatureIndexReasoningCriteriaAndConstraintCount] = scaleDifficultyFeatureV1(features.criteriaAndConstraintCount, 8)
	vector[difficultyFeatureIndexReasoningDepth] = scaleDifficultyFeatureV1(features.reasoningDepth, 5)
	vector[difficultyFeatureIndexReasoningUncertaintyScenarioCount] = scaleDifficultyFeatureV1(features.uncertaintyScenarioCount, 6)
}

func scaleDifficultyFeatureV1(value int, maximum int) float64 {
	if value <= 0 {
		return 0
	}
	if value >= maximum {
		return 1
	}
	return float64(value) / float64(maximum)
}

func boolDifficultyFeatureV1(value bool) float64 {
	if value {
		return 1
	}
	return 0
}
