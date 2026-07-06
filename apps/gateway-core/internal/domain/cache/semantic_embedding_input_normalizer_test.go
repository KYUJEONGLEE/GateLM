package cache

import "testing"

func TestSemanticCacheEmbeddingInputNormalizerWhitespaceAndUnicode(t *testing.T) {
	normalizer := NewSemanticCacheEmbeddingInputNormalizer(SemanticCacheEmbeddingInputNormalizationConfig{})

	input, ok := normalizer.NormalizeText("  카페\t사용량   \n 확인  ")

	if !ok {
		t.Fatalf("일반 한국어 입력은 embedding input 후보여야 함: %+v", input)
	}
	if input.Text != "카페 사용량 확인" {
		t.Fatalf("whitespace와 Unicode NFC만 일반 정규화해야 함: %q", input.Text)
	}
	if input.NormalizationVersion != SemanticCacheEmbeddingInputNormalizationVersionV1 {
		t.Fatalf("normalizationVersion 불일치: %+v", input)
	}
}

func TestSemanticCacheEmbeddingInputNormalizerUsesLastUserMessageOnly(t *testing.T) {
	normalizer := NewSemanticCacheEmbeddingInputNormalizer(SemanticCacheEmbeddingInputNormalizationConfig{})

	input, ok := normalizer.NormalizeMessages([]SemanticCacheEmbeddingInputMessage{
		{Role: "system", Content: "system 지시는 embedding input에 섞이면 안 됨"},
		{Role: "user", Content: "첫 번째 질문"},
		{Role: "assistant", Content: "assistant 응답도 제외"},
		{Role: "developer", Content: "developer 지시도 제외"},
		{Role: "user", Content: "패스워드 초기화는 어떻게 해?"},
	})

	if !ok {
		t.Fatalf("마지막 user message는 embedding input 후보여야 함: %+v", input)
	}
	if input.Text != "패스워드 초기화는 어떻게 해?" {
		t.Fatalf("마지막 user message만 사용해야 함: %q", input.Text)
	}
	if input.SourceRole != SemanticCacheEmbeddingInputSourceRoleUser || input.SourceMessageIndex != 4 {
		t.Fatalf("source metadata 불일치: %+v", input)
	}
}

func TestSemanticCacheEmbeddingInputNormalizerBypassesCodeBlockLikeInput(t *testing.T) {
	normalizer := NewSemanticCacheEmbeddingInputNormalizer(SemanticCacheEmbeddingInputNormalizationConfig{})

	input, ok := normalizer.NormalizeText("이 코드 설명해줘\n```go\nfmt.Println(1)\n```")

	if ok {
		t.Fatalf("code block 포함 입력은 semantic embedding input에서 제외해야 함: %+v", input)
	}
	if input.BypassReason != SemanticCacheReasonEmbeddingInputCodeLike || !input.ContainsCodeBlockLike {
		t.Fatalf("code block bypass reason 불일치: %+v", input)
	}
}

func TestSemanticCacheEmbeddingInputNormalizerLongPromptPolicy(t *testing.T) {
	t.Run("default bypasses when max chars is configured", func(t *testing.T) {
		normalizer := NewSemanticCacheEmbeddingInputNormalizer(SemanticCacheEmbeddingInputNormalizationConfig{MaxChars: 5})

		input, ok := normalizer.NormalizeText("가나다라마바사아자")

		if ok {
			t.Fatalf("긴 입력은 기본 전략에서 bypass되어야 함: %+v", input)
		}
		if input.BypassReason != SemanticCacheReasonEmbeddingInputTooLong {
			t.Fatalf("긴 입력 bypass reason 불일치: %+v", input)
		}
	})

	t.Run("truncate tail keeps configured window", func(t *testing.T) {
		normalizer := NewSemanticCacheEmbeddingInputNormalizer(SemanticCacheEmbeddingInputNormalizationConfig{
			MaxChars:          5,
			LongInputStrategy: SemanticCacheEmbeddingInputLongInputTruncateTail,
		})

		input, ok := normalizer.NormalizeText("가나다라마바사아자")

		if !ok {
			t.Fatalf("truncate_tail 전략에서는 긴 입력을 tail window로 줄여야 함: %+v", input)
		}
		if input.Text != "마바사아자" || !input.Truncated || input.WindowingStrategy != SemanticCacheEmbeddingInputWindowingTruncateTail {
			t.Fatalf("truncate_tail 결과 불일치: %+v", input)
		}
	})
}

func TestSemanticCacheEmbeddingInputNormalizerRejectsForbiddenMaterial(t *testing.T) {
	normalizer := NewSemanticCacheEmbeddingInputNormalizer(SemanticCacheEmbeddingInputNormalizationConfig{})

	input, ok := normalizer.NormalizeText("Authorization: Bearer token")

	if ok {
		t.Fatalf("Authorization header 형태는 embedding input 후보가 되면 안 됨: %+v", input)
	}
	if input.BypassReason != SemanticCacheReasonEmbeddingInputUnsafe {
		t.Fatalf("forbidden material reason 불일치: %+v", input)
	}
}

func TestSemanticCacheEmbeddingInputNormalizerDoesNotRewriteKoreanMeaning(t *testing.T) {
	normalizer := NewSemanticCacheEmbeddingInputNormalizer(SemanticCacheEmbeddingInputNormalizationConfig{})

	input, ok := normalizer.NormalizeText("  패스워드   초기화는 어떻게 해?  ")

	if !ok {
		t.Fatalf("일반 한국어 prompt는 embedding input 후보여야 함: %+v", input)
	}
	if input.Text != "패스워드 초기화는 어떻게 해?" {
		t.Fatalf("일반 전처리는 synonym/template 치환을 하면 안 됨: %q", input.Text)
	}
}
