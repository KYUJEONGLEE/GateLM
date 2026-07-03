package cache

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"math"
	"strings"
)

type EmbeddingInput struct {
	NormalizedText string
}

type EmbeddingResult struct {
	Vector []float64
	Model  string
}

type EmbeddingProvider interface {
	Embed(ctx context.Context, input EmbeddingInput) (EmbeddingResult, error)
	ProviderName() string
	ModelName() string
}

// FakeEmbeddingProvider is a deterministic test double. It is not intended to
// resemble OpenAI embedding output; it only makes semantic cache tests stable.
type FakeEmbeddingProvider struct {
	modelName string
}

func NewFakeEmbeddingProvider(modelName string) FakeEmbeddingProvider {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		modelName = "fake-semantic-cache-embedding"
	}
	return FakeEmbeddingProvider{modelName: modelName}
}

func (p FakeEmbeddingProvider) ProviderName() string {
	return "fake"
}

func (p FakeEmbeddingProvider) ModelName() string {
	return p.modelName
}

func (p FakeEmbeddingProvider) Embed(ctx context.Context, input EmbeddingInput) (EmbeddingResult, error) {
	if err := ctx.Err(); err != nil {
		return EmbeddingResult{}, err
	}
	text := normalizeSemanticText(input.NormalizedText)
	if text == "" {
		return EmbeddingResult{Vector: []float64{}, Model: p.modelName}, nil
	}
	return EmbeddingResult{
		Vector: deterministicFakeVector(text),
		Model:  p.modelName,
	}, nil
}

func deterministicFakeVector(text string) []float64 {
	switch fakeSemanticCluster(text) {
	case "password_reset":
		return []float64{1, 0.03, 0, 0, 0, 0}
	case "support_refund":
		return []float64{0.03, 0, 1, 0.03, 0, 0}
	case "usage_stats":
		return []float64{0, 1, 0.03, 0, 0, 0}
	default:
		return hashVector(text, 6)
	}
}

func fakeSemanticCluster(text string) string {
	if containsAny(text, "비밀번호", "패스워드", "초기화", "재설정", "password", "reset") {
		return "password_reset"
	}
	if containsAny(text, "배송비", "환불", "반품", "돌려받", "주문 취소", "결제 취소", "교환", "refund", "return", "cancel", "exchange") {
		return "support_refund"
	}
	if containsAny(text, "사용량", "통계", "usage", "stats") {
		return "usage_stats"
	}
	return ""
}

func hashVector(text string, dimensions int) []float64 {
	if dimensions <= 0 {
		dimensions = 6
	}
	sum := sha256.Sum256([]byte(text))
	vector := make([]float64, dimensions)
	for i := 0; i < dimensions; i++ {
		offset := (i * 4) % len(sum)
		raw := binary.BigEndian.Uint32(sum[offset : offset+4])
		vector[i] = float64(int(raw%2000)-1000) / 1000.0
	}
	normalizeVectorInPlace(vector)
	return vector
}

func normalizeSemanticText(text string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(strings.ToLower(text))), " ")
}

func containsAny(text string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(text, strings.ToLower(needle)) {
			return true
		}
	}
	return false
}

func normalizeVectorInPlace(vector []float64) {
	var sumSquares float64
	for _, value := range vector {
		sumSquares += value * value
	}
	if sumSquares == 0 {
		return
	}
	norm := math.Sqrt(sumSquares)
	for i := range vector {
		vector[i] = vector[i] / norm
	}
}
