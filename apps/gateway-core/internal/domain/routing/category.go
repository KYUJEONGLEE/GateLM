package routing

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

const maxCategoryScanBytes = 2048

var (
	translationCategoryKeywords = []string{
		"translate", "translation", "in english", "into korean", "into english", "to english",
		"번역", "영어로", "한국어로", "일본어로", "중국어로",
	}
	codeCategoryKeywords = []string{
		"code", "coding", "function", "stack trace", "exception", "refactor", "typescript", "javascript",
		"python", "golang", "compile", "컴파일", "코드", "에러", "오류", "버그", "리팩토링", "함수",
	}
	supportRefundCategoryKeywords = []string{
		"refund", "payment", "billing", "chargeback", "cancel order", "return item",
		"return", "cancel", "cancellation", "exchange", "환불", "결제", "취소", "반품", "교환", "고객문의",
	}
	summarizationCategoryKeywords = []string{
		"summarize", "summary", "tldr", "tl;dr", "key points", "meeting notes", "bullet points",
		"요약", "회의록", "핵심", "정리",
	}
	extractionJSONCategoryKeywords = []string{
		"as json", "to json", "return json", "json object", "json schema", "structured output",
		"json으로", "json 형태", "구조화", "추출",
	}
	reasoningCategoryKeywords = []string{
		"compare", "tradeoff", "trade-off", "pros and cons", "best option", "recommend the safest sequence",
		"decision matrix", "analyze the options", "비교", "장단점", "트레이드오프", "의사결정",
	}
	safetySensitiveCategoryKeywords = []string{
		"credential", "secret", "api_key", "authorization:", "bearer ", "[secret_redacted]", "[credential_redacted]",
		"시크릿", "비밀키", "인증 헤더",
	}
)

type RuleBasedCategoryClassifier struct{}

type RoutingSignals struct {
	PromptLength           int
	HasCodeSignal          bool
	WantsTranslation       bool
	WantsSummarization     bool
	WantsStructuredOutput  bool
	NeedsReasoning         bool
	HasSupportRefundSignal bool
	HasSafetySignal        bool
	Category               string
}

func NewRuleBasedCategoryClassifier() RuleBasedCategoryClassifier {
	return RuleBasedCategoryClassifier{}
}

func (RuleBasedCategoryClassifier) Classify(prompt string) string {
	return ExtractRoutingSignals(prompt).Category
}

func ExtractRoutingSignals(prompt string) RoutingSignals {
	normalized := normalizeCategoryText(prompt)
	signals := RoutingSignals{
		PromptLength: utf8.RuneCountInString(prompt),
		Category:     CategoryUnknown,
	}
	if normalized == "" {
		return signals
	}

	tokens := categoryTokens(normalized)
	signals.HasCodeSignal = containsCodeSignal(normalized)
	signals.WantsTranslation = containsAny(normalized, translationCategoryKeywords)
	signals.WantsSummarization = containsAny(normalized, summarizationCategoryKeywords)
	signals.WantsStructuredOutput = containsStructuredOutputSignal(normalized, tokens)
	signals.NeedsReasoning = containsAny(normalized, reasoningCategoryKeywords)
	signals.HasSupportRefundSignal = containsAny(normalized, supportRefundCategoryKeywords)
	signals.HasSafetySignal = containsAny(normalized, safetySensitiveCategoryKeywords)

	if signals.HasCodeSignal {
		signals.Category = CategoryCode
		return signals
	}

	if signals.HasSafetySignal {
		signals.Category = CategorySafetySensitive
		return signals
	}

	if signals.WantsTranslation {
		signals.Category = CategoryTranslation
		return signals
	}

	if signals.WantsStructuredOutput {
		signals.Category = CategoryExtractionJSON
		return signals
	}

	if signals.WantsSummarization {
		signals.Category = CategorySummarization
		return signals
	}

	if signals.NeedsReasoning {
		signals.Category = CategoryReasoning
		return signals
	}

	if signals.HasSupportRefundSignal {
		signals.Category = CategorySupportRefund
		return signals
	}

	signals.Category = CategoryGeneral
	return signals
}

func normalizeCategoryText(prompt string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(categoryScanPrefix(prompt)))), " ")
}

func categoryScanPrefix(prompt string) string {
	if len(prompt) <= maxCategoryScanBytes {
		return prompt
	}

	limit := maxCategoryScanBytes
	for limit > 0 && !utf8.RuneStart(prompt[limit]) {
		limit--
	}
	if limit <= 0 {
		return ""
	}
	return prompt[:limit]
}

func containsCodeSignal(text string) bool {
	if strings.Contains(text, "```") {
		return true
	}
	if containsAny(text, codeCategoryKeywords) {
		return true
	}
	tokens := categoryTokens(text)
	for _, token := range tokens {
		switch token {
		case "function", "class", "const", "func", "sql":
			return true
		}
	}
	return containsSQLCodePattern(text, tokens)
}

func containsStructuredOutputSignal(text string, tokens []string) bool {
	if containsAny(text, extractionJSONCategoryKeywords) {
		return true
	}
	if !hasToken(tokens, "json") {
		return false
	}
	return hasAnyToken(tokens, []string{"extract", "convert", "format", "parse", "fields", "schema", "return"})
}

func containsAny(value string, needles []string) bool {
	for _, needle := range needles {
		if strings.Contains(value, needle) {
			return true
		}
	}
	return false
}

func categoryTokens(text string) []string {
	return strings.FieldsFunc(text, func(r rune) bool {
		return !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_')
	})
}

func containsSQLCodePattern(text string, tokens []string) bool {
	if strings.Contains(text, "select *") {
		return true
	}
	for i, token := range tokens {
		switch token {
		case "insert":
			if nextToken(tokens, i) == "into" {
				return true
			}
		case "update":
			if hasToken(tokens[i+1:], "set") {
				return true
			}
		case "delete":
			if nextToken(tokens, i) == "from" {
				return true
			}
		}
	}
	return false
}

func nextToken(tokens []string, index int) string {
	next := index + 1
	if next >= len(tokens) {
		return ""
	}
	return tokens[next]
}

func hasToken(tokens []string, target string) bool {
	for _, token := range tokens {
		if token == target {
			return true
		}
	}
	return false
}

func hasAnyToken(tokens []string, targets []string) bool {
	for _, target := range targets {
		if hasToken(tokens, target) {
			return true
		}
	}
	return false
}

func capabilityForCategory(category string) string {
	switch canonicalCategory(category) {
	case CategoryCode:
		return CapabilityCode
	case CategoryTranslation:
		return CapabilityTranslation
	case CategorySummarization:
		return CapabilitySummarization
	case CategoryExtractionJSON:
		return CapabilityJSON
	case CategoryReasoning:
		return CapabilityReasoning
	case CategorySafetySensitive:
		return CapabilitySafety
	default:
		return CapabilityChat
	}
}
