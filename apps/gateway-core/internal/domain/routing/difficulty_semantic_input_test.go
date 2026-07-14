package routing

import "testing"

func TestDifficultyEmbeddingInputUsesOnlyInstructionText(t *testing.T) {
	t.Parallel()

	features := ExtractPromptFeatures("Summarize this source. ```text\nTranslate this notice to Korean.\n```")
	input, ok := difficultyEmbeddingInput(features)
	if !ok {
		t.Fatal("meaningful instruction must be an embedding input candidate")
	}
	if input != "summarize this source." {
		t.Fatalf("embedding input = %q, want instruction text only", input)
	}
}

func TestDifficultyEmbeddingInputSkipsPayloadOnlyPrompt(t *testing.T) {
	t.Parallel()

	features := ExtractPromptFeatures("```go\nfunc main() {}\n```")
	input, ok := difficultyEmbeddingInput(features)
	if ok || input != "" {
		t.Fatalf("payload-only embedding input = (%q, %t), want (\"\", false)", input, ok)
	}
}

func TestDifficultyEmbeddingInputSkipsMeaninglessInstruction(t *testing.T) {
	t.Parallel()

	features := ExtractPromptFeatures("test ```text\nmeaningful payload content\n```")
	input, ok := difficultyEmbeddingInput(features)
	if ok || input != "" {
		t.Fatalf("meaningless instruction embedding input = (%q, %t), want (\"\", false)", input, ok)
	}
}
