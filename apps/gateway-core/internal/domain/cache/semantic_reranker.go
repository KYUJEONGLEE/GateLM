package cache

import "context"

const (
	SemanticCacheReasonRerankerDisabled        = "reranker_disabled"
	SemanticCacheReasonRerankerPass            = "reranker_pass"
	SemanticCacheReasonRerankerScoreMiss       = "reranker_score_miss"
	SemanticCacheReasonRerankerProviderFailure = "reranker_provider_failure"
	SemanticCacheReasonRerankerTimeout         = "reranker_timeout"
	SemanticCacheReasonRerankerInputUnsafe     = "reranker_input_unsafe"
)

type SemanticCacheReranker interface {
	Rerank(ctx context.Context, request SemanticCacheRerankRequest) (SemanticCacheRerankResult, error)
}

type SemanticCacheRerankRequest struct {
	Category                   string
	RequestIntentMaterial      SemanticCacheIntentMaterial
	CandidateIntentMaterial    SemanticCacheIntentMaterial
	SemanticSimilarity         float64
	Threshold                  float64
	SemanticCachePolicyVersion string
	NormalizationVersion       string
	EmbeddingProvider          string
	CandidateRank              int
}

type SemanticCacheRerankResult struct {
	Applied               bool
	Passed                bool
	Score                 float64
	Threshold             float64
	DecisionReason        string
	ProviderBypassAllowed bool
}

type NoopSemanticCacheReranker struct{}

func (NoopSemanticCacheReranker) Rerank(ctx context.Context, request SemanticCacheRerankRequest) (SemanticCacheRerankResult, error) {
	if err := ctx.Err(); err != nil {
		return SemanticCacheRerankResult{}, err
	}
	return SemanticCacheRerankResult{
		Applied:               false,
		Passed:                true,
		Score:                 request.SemanticSimilarity,
		Threshold:             request.Threshold,
		DecisionReason:        SemanticCacheReasonRerankerDisabled,
		ProviderBypassAllowed: true,
	}, nil
}
