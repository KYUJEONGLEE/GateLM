package routing

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

const maxCategoryScanBytes = 4096

// PromptFeatures is the shared, request-local input to routing classifiers.
// Its fields stay private so normalized prompt material and tokens cannot be
// serialized into routing responses, diagnostics, logs, events, or metrics.
type PromptFeatures struct {
	normalizedText   string
	tokens           map[string]struct{}
	promptRuneLength int
	wordCount        int
	singleClause     bool
	meaningless      bool
}

// ExtractPromptFeatures performs the common bounded preprocessing once. It
// deliberately contains no category or difficulty result fields.
func ExtractPromptFeatures(prompt string) PromptFeatures {
	normalized := normalizeRoutingText(prompt, maxCategoryScanBytes)
	return PromptFeatures{
		normalizedText:   normalized,
		tokens:           routingTokenSet(normalized),
		promptRuneLength: utf8.RuneCountInString(prompt),
		wordCount:        len(strings.Fields(normalized)),
		singleClause:     isSingleClause(normalized),
		meaningless:      isMeaninglessRoutingText(normalized),
	}
}

func normalizeRoutingText(prompt string, maxBytes int) string {
	prompt = strings.TrimSpace(strings.ToLower(prompt))
	if maxBytes > 0 && len(prompt) > maxBytes {
		prompt = prompt[:maxBytes]
		for !utf8.ValidString(prompt) && len(prompt) > 0 {
			prompt = prompt[:len(prompt)-1]
		}
	}
	return strings.Join(strings.Fields(prompt), " ")
}

func routingTokenSet(text string) map[string]struct{} {
	tokens := strings.FieldsFunc(text, func(r rune) bool {
		return !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_')
	})
	result := make(map[string]struct{}, len(tokens))
	for _, token := range tokens {
		result[token] = struct{}{}
	}
	return result
}

func containsRoutingToken(tokens map[string]struct{}, target string) bool {
	if target == "" {
		return false
	}
	_, exists := tokens[target]
	return exists
}

func isMeaninglessRoutingText(text string) bool {
	if text == "" {
		return true
	}
	meaningful := 0
	for _, r := range text {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			meaningful++
		}
	}
	if meaningful == 0 {
		return true
	}
	switch text {
	case "test", "n/a", "na", "[redacted]", "[masked]":
		return true
	default:
		return false
	}
}

func isSingleClause(text string) bool {
	return strings.Count(text, ",") == 0 &&
		strings.Count(text, ";") == 0 &&
		!strings.Contains(text, " and ") &&
		!strings.Contains(text, " then ")
}
