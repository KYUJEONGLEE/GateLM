package routing

// DifficultyRemoteInferenceInput is an ephemeral, request-local transfer
// object for authoritative remote E5 inference. InstructionText is
// sensitive request material and must not be persisted or logged. RuleVector
// contains only the stable 42D difficulty-feature-vector.v1 values.
type DifficultyRemoteInferenceInput struct {
	InstructionText string
	RuleVector      [DifficultyFeatureVectorDimensionV1]float64
}

// difficultyEmbeddingInput returns the bounded, normalized instruction text
// reserved for a future package-internal semantic encoder.
func difficultyEmbeddingInput(features PromptFeatures) (string, bool) {
	if isMeaninglessRoutingText(features.instructionText) {
		return "", false
	}
	return features.instructionText, true
}

// DifficultySemanticInputForOffline exposes the exact instruction-only input
// boundary to approved offline evaluation tooling. Product runtime does not
// call this function, and callers must not persist its returned text in
// reports, logs, metrics, or model lock manifests.
func DifficultySemanticInputForOffline(features PromptFeatures) (string, bool) {
	return difficultyEmbeddingInput(features)
}

// BuildDifficultyRemoteInput builds the exact instruction and rule vector
// consumed by the private remote E5 classifier.
func BuildDifficultyRemoteInput(
	features PromptFeatures,
	category string,
) (DifficultyRemoteInferenceInput, bool) {
	difficultyFeatures := ExtractDifficultyFeatures(features, category)
	if !UsesDifficultyModelPath(difficultyFeatures) {
		return DifficultyRemoteInferenceInput{}, false
	}
	instructionText, ok := difficultyEmbeddingInput(features)
	if !ok {
		return DifficultyRemoteInferenceInput{}, false
	}
	return DifficultyRemoteInferenceInput{
		InstructionText: instructionText,
		RuleVector:      vectorizeDifficultyFeaturesV1Fixed(difficultyFeatures),
	}, true
}
