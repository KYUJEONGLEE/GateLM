package routing

import (
	"strings"
	"unicode"
)

const maxCategoryClassifierChars = 2000

func ClassifyCategory(promptText string) string {
	normalized := normalizeCategoryClassifierText(promptText)
	if normalized == "" {
		return CategoryUnknown
	}
	if containsCodeSignal(normalized) {
		return CategoryCode
	}
	if containsTranslationSignal(normalized) {
		return CategoryTranslation
	}
	if containsSupportRefundSignal(normalized) {
		return CategorySupportRefund
	}
	if looksLikeGeneralPrompt(normalized) {
		return CategoryGeneral
	}
	return CategoryUnknown
}

func normalizeCategoryClassifierText(promptText string) string {
	trimmed := strings.TrimSpace(promptText)
	if trimmed == "" {
		return ""
	}
	trimmed = truncateCategoryClassifierText(trimmed, maxCategoryClassifierChars)
	return strings.Join(strings.Fields(strings.ToLower(trimmed)), " ")
}

func containsCodeSignal(text string) bool {
	if strings.Contains(text, "```") {
		return true
	}
	for _, keyword := range []string{
		"코드", "함수", "에러", "오류", "버그", "컴파일",
		"stack trace", "exception", "typescript", "javascript", "python", "golang", "compile",
	} {
		if strings.Contains(text, keyword) {
			return true
		}
	}
	for _, token := range categoryTokens(text) {
		switch token {
		case "function", "class", "const", "func", "sql":
			return true
		}
	}
	if containsSQLCodePattern(text, categoryTokens(text)) {
		return true
	}
	return false
}

func containsTranslationSignal(text string) bool {
	for _, keyword := range []string{
		"번역", "영어로", "한국어로", "일본어로", "중국어로",
		"translate", "translation", "in english", "into korean", "into english", "to english",
	} {
		if strings.Contains(text, keyword) {
			return true
		}
	}
	return false
}

func containsSupportRefundSignal(text string) bool {
	for _, keyword := range []string{
		"환불", "반품", "취소", "교환",
		"refund", "return", "cancel", "cancellation", "exchange",
	} {
		if strings.Contains(text, keyword) {
			return true
		}
	}
	return false
}

func looksLikeGeneralPrompt(text string) bool {
	if text == "" {
		return false
	}
	hasLetter := false
	hasHangul := false
	for _, r := range text {
		if unicode.IsLetter(r) {
			hasLetter = true
		}
		if r >= '가' && r <= '힣' {
			hasHangul = true
		}
	}
	if hasHangul {
		return true
	}
	if !hasLetter {
		return false
	}
	return len(strings.Fields(text)) >= 2
}

func categoryTokens(text string) []string {
	return strings.FieldsFunc(text, func(r rune) bool {
		return !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_')
	})
}

func truncateCategoryClassifierText(text string, maxChars int) string {
	if maxChars <= 0 {
		return ""
	}
	count := 0
	for index := range text {
		if count == maxChars {
			return text[:index]
		}
		count++
	}
	return text
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
