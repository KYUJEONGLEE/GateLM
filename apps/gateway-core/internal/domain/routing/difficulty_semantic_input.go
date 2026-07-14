package routing

// difficultyEmbeddingInput returns the bounded, normalized instruction text
// reserved for a future package-internal semantic encoder.
func difficultyEmbeddingInput(features PromptFeatures) (string, bool) {
	if isMeaninglessRoutingText(features.instructionText) {
		return "", false
	}
	return features.instructionText, true
}
