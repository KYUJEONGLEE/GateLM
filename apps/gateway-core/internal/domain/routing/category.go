package routing

import "strings"

type RuleBasedCategoryClassifier struct{}

func NewRuleBasedCategoryClassifier() RuleBasedCategoryClassifier {
	return RuleBasedCategoryClassifier{}
}

func (RuleBasedCategoryClassifier) Classify(prompt string) string {
	normalized := strings.ToLower(strings.TrimSpace(prompt))
	if normalized == "" {
		return CategoryUnknown
	}

	if containsAny(normalized, []string{
		"translate", "translation", "번역", "영어로", "한국어로", "일본어로", "중국어로",
	}) {
		return CategoryTranslation
	}

	if containsAny(normalized, []string{
		"code", "coding", "function", "stack trace", "exception", "refactor", "typescript", "javascript",
		"python", "golang", "컴파일", "코드", "에러", "버그", "리팩토링", "함수",
	}) {
		return CategoryCode
	}

	if containsAny(normalized, []string{
		"refund", "payment", "billing", "chargeback", "cancel order", "return item",
		"환불", "결제", "취소", "반품", "교환", "고객문의",
	}) {
		return CategorySupportRefund
	}

	return CategoryGeneral
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
