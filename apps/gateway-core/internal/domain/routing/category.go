package routing

import (
	"strings"
	"unicode/utf8"
)

const maxCategoryScanBytes = 2048

var (
	translationCategoryKeywords = []string{
		"translate", "translation", "번역", "영어로", "한국어로", "일본어로", "중국어로",
	}
	codeCategoryKeywords = []string{
		"code", "coding", "function", "stack trace", "exception", "refactor", "typescript", "javascript",
		"python", "golang", "컴파일", "코드", "에러", "버그", "리팩토링", "함수",
	}
	supportRefundCategoryKeywords = []string{
		"refund", "payment", "billing", "chargeback", "cancel order", "return item",
		"환불", "결제", "취소", "반품", "교환", "고객문의",
	}
)

type RuleBasedCategoryClassifier struct{}

func NewRuleBasedCategoryClassifier() RuleBasedCategoryClassifier {
	return RuleBasedCategoryClassifier{}
}

func (RuleBasedCategoryClassifier) Classify(prompt string) string {
	normalized := strings.ToLower(strings.TrimSpace(categoryScanPrefix(prompt)))
	if normalized == "" {
		return CategoryUnknown
	}

	if containsAny(normalized, translationCategoryKeywords) {
		return CategoryTranslation
	}

	if containsAny(normalized, codeCategoryKeywords) {
		return CategoryCode
	}

	if containsAny(normalized, supportRefundCategoryKeywords) {
		return CategorySupportRefund
	}

	return CategoryGeneral
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

func containsAny(value string, needles []string) bool {
	for _, needle := range needles {
		if strings.Contains(value, needle) {
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
