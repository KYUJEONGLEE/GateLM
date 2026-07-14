package routing

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
