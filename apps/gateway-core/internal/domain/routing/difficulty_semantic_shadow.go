package routing

import "context"

type DifficultySemanticPooled = [difficultySemanticPooledDimension]float32

type DifficultySemanticPooledEncoder interface {
	EncodePooled(context.Context, string) (DifficultySemanticPooled, error)
	Close() error
}

const (
	DifficultySemanticShadowReady            = "ready"
	DifficultySemanticShadowNotApplicable    = "not_applicable"
	DifficultySemanticShadowUnavailable      = "unavailable"
	DifficultySemanticShadowBusy             = "busy"
	DifficultySemanticShadowTimeout          = "timeout"
	DifficultySemanticShadowInvalidEmbedding = "invalid_embedding"
	DifficultySemanticShadowInferenceFailed  = "inference_failed"
)

type DifficultySemanticShadowResult struct {
	Status     string
	Difficulty DifficultyResult
}

type DifficultySemanticShadowEvaluator struct {
	encoder DifficultySemanticPooledEncoder
	gate    chan struct{}
}

func NewDifficultySemanticShadowEvaluator(encoder DifficultySemanticPooledEncoder) *DifficultySemanticShadowEvaluator {
	return &DifficultySemanticShadowEvaluator{
		encoder: encoder,
		gate:    make(chan struct{}, 1),
	}
}

func (evaluator *DifficultySemanticShadowEvaluator) Evaluate(
	ctx context.Context,
	features PromptFeatures,
	category string,
) DifficultySemanticShadowResult {
	if evaluator == nil || evaluator.encoder == nil {
		return DifficultySemanticShadowResult{Status: DifficultySemanticShadowUnavailable}
	}
	difficultyFeatures := ExtractDifficultyFeatures(features, category)
	if !UsesDifficultyModelPath(difficultyFeatures) {
		return DifficultySemanticShadowResult{Status: DifficultySemanticShadowNotApplicable}
	}
	instructionText, ok := difficultyEmbeddingInput(features)
	if !ok {
		return DifficultySemanticShadowResult{Status: DifficultySemanticShadowNotApplicable}
	}
	select {
	case evaluator.gate <- struct{}{}:
		defer func() { <-evaluator.gate }()
	default:
		return DifficultySemanticShadowResult{Status: DifficultySemanticShadowBusy}
	}
	pooled, err := evaluator.encoder.EncodePooled(ctx, instructionText)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return DifficultySemanticShadowResult{Status: DifficultySemanticShadowTimeout}
		}
		return DifficultySemanticShadowResult{Status: DifficultySemanticShadowInferenceFailed}
	}
	if ctx.Err() == context.DeadlineExceeded {
		return DifficultySemanticShadowResult{Status: DifficultySemanticShadowTimeout}
	}
	result, err := generatedDifficultySemanticModel118D.inferModelPath(difficultyFeatures, pooled)
	if err != nil {
		return DifficultySemanticShadowResult{Status: DifficultySemanticShadowInvalidEmbedding}
	}
	return DifficultySemanticShadowResult{
		Status:     DifficultySemanticShadowReady,
		Difficulty: result,
	}
}

func (evaluator *DifficultySemanticShadowEvaluator) Close() error {
	if evaluator == nil || evaluator.encoder == nil {
		return nil
	}
	return evaluator.encoder.Close()
}
