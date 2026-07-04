package cache

import (
	"strings"
)

const (
	SemanticCacheEmbeddingInputNormalizationVersionV1 = "semantic_embedding_input_normalization_v1"

	SemanticCacheEmbeddingInputSourceRoleUser = "user"

	SemanticCacheEmbeddingInputWindowingNone         = "none"
	SemanticCacheEmbeddingInputWindowingTruncateTail = "truncate_tail"

	SemanticCacheEmbeddingInputLongInputBypass       = "bypass"
	SemanticCacheEmbeddingInputLongInputTruncateTail = "truncate_tail"
)

type SemanticCacheEmbeddingInputNormalizationConfig struct {
	MaxChars          int
	LongInputStrategy string
	UnicodeForm       string
}

type SemanticCacheEmbeddingInputMessage struct {
	Role    string
	Content string
}

type NormalizedEmbeddingInput struct {
	Text                  string
	NormalizationVersion  string
	SourceRole            string
	SourceMessageIndex    int
	Truncated             bool
	WindowingStrategy     string
	BypassReason          string
	ContainsCodeBlockLike bool
}

type SemanticCacheEmbeddingInputNormalizer struct {
	config SemanticCacheEmbeddingInputNormalizationConfig
}

func NewSemanticCacheEmbeddingInputNormalizer(config SemanticCacheEmbeddingInputNormalizationConfig) SemanticCacheEmbeddingInputNormalizer {
	return SemanticCacheEmbeddingInputNormalizer{config: config.normalize()}
}

func (n SemanticCacheEmbeddingInputNormalizer) NormalizeMessages(messages []SemanticCacheEmbeddingInputMessage) (NormalizedEmbeddingInput, bool) {
	for index := len(messages) - 1; index >= 0; index-- {
		role := strings.TrimSpace(strings.ToLower(messages[index].Role))
		if role != SemanticCacheEmbeddingInputSourceRoleUser {
			continue
		}
		return n.normalizeText(messages[index].Content, SemanticCacheEmbeddingInputSourceRoleUser, index)
	}
	return n.emptyInput("", -1, SemanticCacheReasonEmbeddingInputUnavailable), false
}

func (n SemanticCacheEmbeddingInputNormalizer) NormalizeText(text string) (NormalizedEmbeddingInput, bool) {
	return n.normalizeText(text, "", -1)
}

func (n SemanticCacheEmbeddingInputNormalizer) normalizeText(text string, sourceRole string, sourceIndex int) (NormalizedEmbeddingInput, bool) {
	input := n.emptyInput(sourceRole, sourceIndex, "")
	text = strings.TrimSpace(text)
	if text == "" {
		input.BypassReason = SemanticCacheReasonEmbeddingInputUnavailable
		return input, false
	}
	if looksLikeCodeBlock(text) {
		input.ContainsCodeBlockLike = true
		input.BypassReason = SemanticCacheReasonEmbeddingInputCodeLike
		return input, false
	}

	normalized := normalizeSemanticText(text)
	if normalized == "" {
		input.BypassReason = SemanticCacheReasonEmbeddingInputUnavailable
		return input, false
	}
	if containsForbiddenSemanticCachePayload([]byte(normalized)) {
		input.BypassReason = SemanticCacheReasonEmbeddingInputUnsafe
		return input, false
	}

	config := n.normalizedConfig()
	if config.MaxChars > 0 && runeLen(normalized) > config.MaxChars {
		switch config.LongInputStrategy {
		case SemanticCacheEmbeddingInputLongInputTruncateTail:
			normalized = rightRunes(normalized, config.MaxChars)
			normalized = normalizeSemanticText(normalized)
			input.Truncated = true
			input.WindowingStrategy = SemanticCacheEmbeddingInputWindowingTruncateTail
		default:
			input.BypassReason = SemanticCacheReasonEmbeddingInputTooLong
			return input, false
		}
	}
	if normalized == "" {
		input.BypassReason = SemanticCacheReasonEmbeddingInputUnavailable
		return input, false
	}
	if containsForbiddenSemanticCachePayload([]byte(normalized)) {
		input.BypassReason = SemanticCacheReasonEmbeddingInputUnsafe
		return input, false
	}

	input.Text = normalized
	return input, true
}

func (n SemanticCacheEmbeddingInputNormalizer) emptyInput(sourceRole string, sourceIndex int, reason string) NormalizedEmbeddingInput {
	return NormalizedEmbeddingInput{
		NormalizationVersion: SemanticCacheEmbeddingInputNormalizationVersionV1,
		SourceRole:           strings.TrimSpace(strings.ToLower(sourceRole)),
		SourceMessageIndex:   sourceIndex,
		WindowingStrategy:    SemanticCacheEmbeddingInputWindowingNone,
		BypassReason:         strings.TrimSpace(reason),
	}
}

func (n SemanticCacheEmbeddingInputNormalizer) normalizedConfig() SemanticCacheEmbeddingInputNormalizationConfig {
	return n.config.normalize()
}

func (c SemanticCacheEmbeddingInputNormalizationConfig) normalize() SemanticCacheEmbeddingInputNormalizationConfig {
	c.LongInputStrategy = strings.TrimSpace(strings.ToLower(c.LongInputStrategy))
	switch c.LongInputStrategy {
	case "", SemanticCacheEmbeddingInputLongInputBypass, SemanticCacheEmbeddingInputLongInputTruncateTail:
	default:
		c.LongInputStrategy = SemanticCacheEmbeddingInputLongInputBypass
	}
	c.UnicodeForm = strings.TrimSpace(strings.ToUpper(c.UnicodeForm))
	if c.UnicodeForm == "" {
		c.UnicodeForm = "NFC"
	}
	return c
}

func looksLikeCodeBlock(text string) bool {
	return strings.Contains(text, "```") || strings.Contains(text, "~~~")
}

func runeLen(text string) int {
	return len([]rune(text))
}

func rightRunes(text string, max int) string {
	if max <= 0 {
		return ""
	}
	runes := []rune(text)
	if len(runes) <= max {
		return text
	}
	return string(runes[len(runes)-max:])
}
