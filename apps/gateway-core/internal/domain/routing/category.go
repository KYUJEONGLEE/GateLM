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
)

type RuleBasedCategoryClassifier struct{}

func NewRuleBasedCategoryClassifier() RuleBasedCategoryClassifier {
	return RuleBasedCategoryClassifier{}
}

func (RuleBasedCategoryClassifier) Classify(prompt string) string {
	normalized := normalizeCategoryText(prompt)
	if normalized == "" {
		return CategoryUnknown
	}

	if containsCodeSignal(normalized) {
		return CategoryCode
	}

	if containsAny(normalized, translationCategoryKeywords) {
		return CategoryTranslation
	}

	if containsAny(normalized, supportRefundCategoryKeywords) {
		return CategorySupportRefund
	}

	return CategoryGeneral
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

func capabilityForCategory(category string) string {
	switch canonicalCategory(category) {
	case CategoryCode:
		return CapabilityCode
	case CategoryTranslation:
		return CapabilityTranslation
	default:
		return CapabilityChat
	}
}
