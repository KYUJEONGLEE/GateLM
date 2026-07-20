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
	b1Model *difficultyLogisticModel
	gate    chan struct{}
}

func NewDifficultySemanticShadowEvaluator(encoder DifficultySemanticPooledEncoder) *DifficultySemanticShadowEvaluator {
	return &DifficultySemanticShadowEvaluator{
		encoder: encoder,
		gate:    make(chan struct{}, 1),
	}
}

// NewDifficultyB1ShadowEvaluator uses only the canonical 42D rule vector.
// It deliberately does not construct an E5 encoder or consume embeddings.
func NewDifficultyB1ShadowEvaluator() *DifficultySemanticShadowEvaluator {
	return &DifficultySemanticShadowEvaluator{
		b1Model: &generatedDifficultyLogisticModelV1,
		gate:    make(chan struct{}, 1),
	}
}

func (evaluator *DifficultySemanticShadowEvaluator) Evaluate(
	ctx context.Context,
	features PromptFeatures,
	category string,
) DifficultySemanticShadowResult {
	if evaluator == nil || (evaluator.encoder == nil && evaluator.b1Model == nil) {
		return DifficultySemanticShadowResult{Status: DifficultySemanticShadowUnavailable}
	}
	difficultyFeatures := ExtractDifficultyFeatures(features, category)
	if !UsesDifficultyModelPath(difficultyFeatures) {
		return DifficultySemanticShadowResult{Status: DifficultySemanticShadowNotApplicable}
	}
	if evaluator.b1Model != nil {
		vector := vectorizeDifficultyFeaturesV1Fixed(difficultyFeatures)
		inference, err := evaluator.b1Model.infer(vector[:])
		if err != nil || !finiteDifficultyFloat(inference.calibratedScore) ||
			inference.calibratedScore < 0 || inference.calibratedScore > 1 {
			return DifficultySemanticShadowResult{Status: DifficultySemanticShadowInferenceFailed}
		}
		return DifficultySemanticShadowResult{
			Status: DifficultySemanticShadowReady,
			Difficulty: DifficultyResult{
				ComplexityScore: inference.calibratedScore,
				Difficulty:      inference.difficulty,
			},
		}
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
	result, err := generatedDifficultySemanticModel106D.inferModelPath(difficultyFeatures, pooled)
	if err != nil {
		return DifficultySemanticShadowResult{Status: DifficultySemanticShadowInvalidEmbedding}
	}
	return DifficultySemanticShadowResult{
		Status:     DifficultySemanticShadowReady,
		Difficulty: result,
	}
}

const (
	DifficultyB1ShadowArtifactVersion = "difficulty-logistic.semantic-b1.model-path-5000.2026-07-19.v1"
	DifficultyB1ShadowContentHash     = "sha256:6fdd46325175cb36189f33c2e590841165be13f081c44b982400da13f17d38a9"
)

// DifficultyB1ShadowModelCompatible pins the exact 42D+Isotonic B1 inference
// material used by the experiment baseline.
func DifficultyB1ShadowModelCompatible() bool {
	return generatedDifficultyLogisticModelV1.artifactVersion == DifficultyB1ShadowArtifactVersion &&
		generatedDifficultyLogisticModelV1.contentHash == DifficultyB1ShadowContentHash &&
		generatedDifficultyLogisticModelV1.calibrator.kind == difficultyCalibratorIsotonic &&
		generatedDifficultyLogisticModelV1.threshold == 0.5
}

func (evaluator *DifficultySemanticShadowEvaluator) Close() error {
	if evaluator == nil || evaluator.encoder == nil {
		return nil
	}
	return evaluator.encoder.Close()
}
