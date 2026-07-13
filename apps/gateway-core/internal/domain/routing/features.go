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
	normalizedText  string
	instructionText string
	payloadText     string
	tokens          map[string]struct{}

	promptRuneLength int
	wordCount        int
	clauseCount      int
	taskCount        int
	constraintCount  int
	scopeCount       int
	dependencyDepth  int
	languageBucket   string
	hasCodeFence     bool
	isMeaningless    bool
}

// ModelCapabilityFeatures is intentionally separate from category and
// difficulty classification. It may be consumed by a future capability
// matcher without changing the routing classification pipeline.
type ModelCapabilityFeatures struct {
	inputTokenEstimate int
	toolIntent         bool
}

// ExtractPromptFeatures performs the common bounded preprocessing once. It
// deliberately contains no category or difficulty result fields.
func ExtractPromptFeatures(prompt string) PromptFeatures {
	normalized := normalizeRoutingText(prompt, maxCategoryScanBytes)
	instruction, payload := splitRoutingInstructionPayload(normalized)
	meaningless := isMeaninglessRoutingText(normalized)
	return PromptFeatures{
		normalizedText:   normalized,
		instructionText:  instruction,
		payloadText:      payload,
		tokens:           routingTokenSet(normalized),
		promptRuneLength: utf8.RuneCountInString(prompt),
		wordCount:        len(strings.Fields(normalized)),
		clauseCount:      countRoutingClauses(instruction, meaningless),
		taskCount:        countRoutingTasks(instruction, meaningless),
		constraintCount:  countRoutingConstraints(instruction),
		scopeCount:       countRoutingScope(normalized, meaningless),
		dependencyDepth:  countRoutingDependencyDepth(instruction),
		languageBucket:   routingLanguageBucket(normalized),
		hasCodeFence:     strings.Contains(normalized, "```"),
		isMeaningless:    meaningless,
	}
}

// ExtractModelCapabilityFeatures derives low-cardinality capability hints
// without adding them to PromptFeatures or the category/difficulty pipeline.
func ExtractModelCapabilityFeatures(features PromptFeatures) ModelCapabilityFeatures {
	return ModelCapabilityFeatures{
		inputTokenEstimate: estimateRoutingInputTokens(features.normalizedText),
		toolIntent: hasAnyPhrase(features.instructionText, []string{
			"use a tool", "call the tool", "browse", "search the web", "run the command",
			"도구를 사용", "도구 호출", "웹 검색", "검색해줘", "명령을 실행",
		}),
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

func splitRoutingInstructionPayload(text string) (string, string) {
	start := strings.Index(text, "```")
	if start < 0 {
		return text, ""
	}

	payloadStart := start + len("```")
	remainder := text[payloadStart:]
	endOffset := strings.Index(remainder, "```")
	if endOffset < 0 {
		return strings.TrimSpace(text[:start]), strings.TrimSpace(remainder)
	}

	payload := strings.TrimSpace(remainder[:endOffset])
	instruction := strings.TrimSpace(text[:start] + " " + remainder[endOffset+len("```"):])
	return instruction, payload
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

func countRoutingClauses(text string, meaningless bool) int {
	if meaningless || text == "" {
		return 0
	}

	segments := strings.FieldsFunc(text, func(r rune) bool {
		switch r {
		case ',', ';', '.', '?', '!':
			return true
		default:
			return false
		}
	})
	count := len(segments)
	for _, separator := range []string{" and ", " then ", " 그리고 ", " 그다음 ", " 이후 ", "하고 ", "한 뒤 ", "하며 ", "하면서 "} {
		count += strings.Count(text, separator)
	}
	if count == 0 {
		count = 1
	}
	return minInt(count, 8)
}

func countRoutingTasks(text string, meaningless bool) int {
	if meaningless || text == "" {
		return 0
	}

	count := countDistinctPhrases(text, []string{
		"explain", "show", "find", "fix", "debug", "refactor", "design", "implement",
		"translate", "localize", "summarize", "compare", "recommend", "evaluate", "analyze",
		"extract", "create", "write", "propose", "investigate", "decide",
		"설명", "알려", "보여", "찾아", "수정", "고쳐", "디버깅", "리팩터링", "리팩토링",
		"설계", "구현", "번역", "영문화", "현지화", "요약", "압축", "비교", "추천",
		"평가", "분석", "추출", "작성", "제안", "조사", "판단", "결정",
	})
	if count == 0 {
		return 1
	}
	return minInt(count, 6)
}

func countRoutingConstraints(text string) int {
	return minInt(countDistinctPhrases(text, []string{
		"constraint", "preserve", "preserving", "must", "without", "while", "under",
		"format", "tone", "terminology", "compatibility", "security", "performance", "test boundary",
		"제약", "조건", "유지", "보존", "반드시", "없이", "하면서", "형식", "포맷", "톤",
		"말투", "용어", "호환", "보안", "성능", "테스트 경계", "이내",
	}), 6)
}

func countRoutingScope(text string, meaningless bool) int {
	if meaningless || text == "" {
		return 0
	}

	count := 1
	for _, candidate := range []struct {
		phrases []string
		count   int
	}{
		{phrases: []string{"two files", "two documents", "two options", "두 파일", "두 문서", "두 대안", "두 방식"}, count: 2},
		{phrases: []string{"multiple files", "multiple documents", "multiple options", "several files", "several documents", "여러 파일", "여러 문서", "여러 대안", "여러 언어", "여러 시스템"}, count: 2},
		{phrases: []string{"three files", "three documents", "three options", "세 파일", "세 문서", "세 대안", "세 가지"}, count: 3},
		{phrases: []string{"four files", "four documents", "four options", "네 파일", "네 문서", "네 대안", "네 가지"}, count: 4},
	} {
		if hasAnyPhrase(text, candidate.phrases) && candidate.count > count {
			count = candidate.count
		}
	}
	return count
}

func countRoutingDependencyDepth(text string) int {
	return minInt(countDistinctPhrasesIncludingBoundaries(text, []string{
		" then ", " after ", " before ", " if ", " otherwise", "fallback", "step", "stage",
		"그다음", "이후", "먼저", "실패 시", "경우", "단계", "순서", "복구 경로", "대체 경로",
	}), 5)
}

func routingLanguageBucket(text string) string {
	hasKorean := false
	hasLatin := false
	for _, r := range text {
		switch {
		case unicode.In(r, unicode.Hangul):
			hasKorean = true
		case unicode.Is(unicode.Latin, r):
			hasLatin = true
		}
	}
	switch {
	case hasKorean && hasLatin:
		return "mixed"
	case hasKorean:
		return "ko"
	case hasLatin:
		return "en"
	default:
		return "unknown"
	}
}

func estimateRoutingInputTokens(text string) int {
	if text == "" {
		return 0
	}
	latinRunes := 0
	otherRunes := 0
	for _, r := range text {
		if unicode.IsSpace(r) {
			continue
		}
		if unicode.Is(unicode.Latin, r) || unicode.IsDigit(r) {
			latinRunes++
		} else {
			otherRunes++
		}
	}
	return (latinRunes+3)/4 + (otherRunes+1)/2
}

func countDistinctPhrases(text string, phrases []string) int {
	count := 0
	for _, phrase := range phrases {
		if phrase != "" && strings.Contains(text, phrase) {
			count++
		}
	}
	return count
}

func countDistinctPhrasesIncludingBoundaries(text string, phrases []string) int {
	return countDistinctPhrases(" "+text+" ", phrases)
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}
