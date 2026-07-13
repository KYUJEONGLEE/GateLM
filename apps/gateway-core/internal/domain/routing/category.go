package routing

import (
	_ "embed"
	"encoding/json"
	"strings"
	"unicode"
	"unicode/utf8"
)

const maxCategoryScanBytes = 4096

//go:embed category_policy.json
var categoryPolicyJSON []byte

type categoryPolicyData struct {
	Rules map[string]categoryRuleData `json:"rules"`
}

type categoryRuleData struct {
	Contains         []string `json:"contains"`
	StrongSignals    []string `json:"strongSignals"`
	SoftSignals      []string `json:"softSignals"`
	NegativeSignals  []string `json:"negativeSignals"`
	Tokens           []string `json:"tokens"`
	RequiresToken    string   `json:"requiresToken"`
	RequiresAnyToken []string `json:"requiresAnyToken"`
	Threshold        int      `json:"threshold"`
	EnableCodeFence  bool     `json:"enableCodeFence"`
	EnableSQLPattern bool     `json:"enableSQLPattern"`
}

var categoryPolicy = loadCategoryPolicy()

func loadCategoryPolicy() categoryPolicyData {
	var policy categoryPolicyData
	if err := json.Unmarshal(categoryPolicyJSON, &policy); err != nil {
		panic(err)
	}
	return policy
}

type RuleBasedCategoryClassifier struct{}

type RoutingSignals struct {
	PromptLength        int
	HasCodeSignal       bool
	WantsTranslation    bool
	WantsSummarization  bool
	NeedsReasoning      bool
	Category            string
	CategoryDiagnostics CategoryDiagnostics
}

func NewRuleBasedCategoryClassifier() RuleBasedCategoryClassifier {
	return RuleBasedCategoryClassifier{}
}

func (RuleBasedCategoryClassifier) Classify(prompt string) string {
	return ExtractRoutingSignals(prompt).Category
}

func (RuleBasedCategoryClassifier) ExtractRoutingSignals(prompt string) RoutingSignals {
	return ExtractRoutingSignals(prompt)
}

func (RuleBasedCategoryClassifier) Diagnose(prompt string) CategoryDiagnostics {
	return ExtractRoutingSignals(prompt).CategoryDiagnostics
}

func ExtractRoutingSignals(prompt string) RoutingSignals {
	normalized := normalizeRoutingText(prompt, maxCategoryScanBytes)
	scores := categoryScores(normalized)
	top, second := topTwoCategoryScores(scores)
	category := CategoryGeneral
	if top.Score > 0 {
		category = top.Category
	}

	confidence := RoutingConfidenceLow
	margin := top.Score - second.Score
	if top.Score >= 4 && margin >= 2 {
		confidence = RoutingConfidenceHigh
	} else if top.Score >= 2 && margin >= 1 {
		confidence = RoutingConfidenceMedium
	}
	ambiguous := top.Score > 0 && margin <= 0
	diagnostics := CategoryDiagnostics{
		SelectedCategory: category,
		TopCategory:      category,
		TopScore:         top.Score,
		SecondCategory:   second.Category,
		SecondScore:      second.Score,
		ScoreMargin:      margin,
		Confidence:       confidence,
		Ambiguous:        ambiguous,
		ScoreVector:      scores,
	}
	if ambiguous {
		diagnostics.AmbiguityReason = AmbiguityReasonLowMargin
	} else if top.Score > 0 && top.Score < 2 {
		diagnostics.AmbiguityReason = AmbiguityReasonLowScore
	}

	return RoutingSignals{
		PromptLength:        utf8.RuneCountInString(prompt),
		HasCodeSignal:       scoreForCategory(scores, CategoryCode) > 0,
		WantsTranslation:    scoreForCategory(scores, CategoryTranslation) > 0,
		WantsSummarization:  scoreForCategory(scores, CategorySummarization) > 0,
		NeedsReasoning:      scoreForCategory(scores, CategoryReasoning) > 0,
		Category:            category,
		CategoryDiagnostics: diagnostics,
	}
}

func (d CategoryDiagnostics) WithSelectedCategory(category string) CategoryDiagnostics {
	d.SelectedCategory = canonicalCategory(category)
	if d.TopCategory == "" {
		d.TopCategory = d.SelectedCategory
	}
	if d.Confidence == "" {
		d.Confidence = RoutingConfidenceLow
	}
	return d
}

func (d CategoryDiagnostics) HasData() bool {
	return d.SelectedCategory != "" || d.TopCategory != "" || len(d.ScoreVector) > 0 || d.Confidence != ""
}

func categoryScores(text string) []CategoryScore {
	code := policyRuleScore(text, categoryPolicy.Rules[CategoryCode]) + weightedSignalScore(text,
		[]string{"```", "stack trace", "syntax error", "race condition", "nil pointer", "compile error"},
		[]string{"typescript", "javascript", "python", "golang", " go ", "sql", "function", "class", "api", "debug", "refactor", "code", "bug", "코드", "버그", "함수"},
	)
	translation := policyRuleScore(text, categoryPolicy.Rules[CategoryTranslation]) + weightedSignalScore(text,
		[]string{"translate", "translation", "번역", "영어로", "한국어로", "일본어로", "중국어로"},
		[]string{" to english", " to korean", " to japanese", " to chinese", "tone", "terminology"},
	)
	summarization := policyRuleScore(text, categoryPolicy.Rules[CategorySummarization]) + weightedSignalScore(text,
		[]string{"summarize", "summary", "요약", "핵심 정리", "key points"},
		[]string{"meeting notes", "report", "document", "결론", "결정사항"},
	)
	reasoning := policyRuleScore(text, categoryPolicy.Rules[CategoryReasoning]) + weightedSignalScore(text,
		[]string{"compare", "tradeoff", "trade-off", "recommend", "evaluate", "analyze", "reason", "비교", "추천", "분석", "판단"},
		[]string{"constraint", "option", "because", "if ", "plan", "우선순위", "장단점"},
	)

	// Translation and summarization are explicit output intents and win ties.
	return []CategoryScore{
		{Category: CategoryTranslation, Score: translation, Matched: translation > 0},
		{Category: CategorySummarization, Score: summarization, Matched: summarization > 0},
		{Category: CategoryCode, Score: code, Matched: code > 0},
		{Category: CategoryReasoning, Score: reasoning, Matched: reasoning > 0},
		{Category: CategoryGeneral, Score: 0, Matched: true},
	}
}

func policyRuleScore(text string, rule categoryRuleData) int {
	if text == "" || hasAnyPhrase(text, rule.NegativeSignals) {
		return 0
	}
	score := 0
	if rule.EnableCodeFence && strings.Contains(text, "```") {
		score += 4
	}
	for _, signal := range rule.Contains {
		if strings.Contains(text, strings.ToLower(signal)) {
			score += 3
		}
	}
	for _, signal := range rule.StrongSignals {
		if strings.Contains(text, strings.ToLower(signal)) {
			score += 3
		}
	}
	for _, signal := range rule.SoftSignals {
		if strings.Contains(text, strings.ToLower(signal)) {
			score++
		}
	}
	for _, token := range rule.Tokens {
		if containsRoutingToken(text, strings.ToLower(token)) {
			score += 2
		}
	}
	if rule.RequiresToken != "" && !containsRoutingToken(text, strings.ToLower(rule.RequiresToken)) {
		return 0
	}
	if len(rule.RequiresAnyToken) > 0 {
		matched := false
		for _, token := range rule.RequiresAnyToken {
			if containsRoutingToken(text, strings.ToLower(token)) {
				matched = true
				break
			}
		}
		if !matched {
			return 0
		}
	}
	threshold := rule.Threshold
	if threshold <= 0 {
		threshold = 3
	}
	if score < threshold {
		return 0
	}
	return score
}

func containsRoutingToken(text string, target string) bool {
	if target == "" {
		return false
	}
	for _, token := range strings.FieldsFunc(text, func(r rune) bool { return !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_') }) {
		if token == target {
			return true
		}
	}
	return false
}

func weightedSignalScore(text string, strong []string, soft []string) int {
	if text == "" {
		return 0
	}
	score := 0
	for _, signal := range strong {
		if strings.Contains(text, signal) {
			score += 3
		}
	}
	for _, signal := range soft {
		if strings.Contains(text, signal) {
			score++
		}
	}
	return score
}

func topTwoCategoryScores(scores []CategoryScore) (CategoryScore, CategoryScore) {
	top := CategoryScore{Category: CategoryGeneral}
	second := CategoryScore{Category: CategoryGeneral}
	for _, candidate := range scores {
		if candidate.Category == CategoryGeneral {
			continue
		}
		if candidate.Score > top.Score {
			second = top
			top = candidate
		} else if candidate.Score > second.Score {
			second = candidate
		}
	}
	return top, second
}

func scoreForCategory(scores []CategoryScore, category string) int {
	for _, score := range scores {
		if score.Category == category {
			return score.Score
		}
	}
	return 0
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

type RuleBasedDifficultyClassifier struct{}

func NewRuleBasedDifficultyClassifier() RuleBasedDifficultyClassifier {
	return RuleBasedDifficultyClassifier{}
}

// Classify uses the selected category as part of its rule set. Length is only
// an auxiliary signal; a long direct request can still be simple.
func (RuleBasedDifficultyClassifier) Classify(prompt string, category string) string {
	text := normalizeRoutingText(prompt, maxCategoryScanBytes)
	if isMeaninglessRoutingText(text) {
		return DifficultySimple
	}

	category = canonicalCategory(category)
	if hasAnyPhrase(text, genericComplexSignals()) || hasAnyPhrase(text, categoryComplexSignals(category)) {
		return DifficultyComplex
	}
	if hasAnyPhrase(text, categorySimpleSignals(category)) {
		return DifficultySimple
	}

	// Short, single-clause questions are clear enough to be simple. Meaningful
	// but otherwise uncertain requests deliberately fail closed to complex.
	if len(strings.Fields(text)) <= 9 && singleClause(text) {
		return DifficultySimple
	}
	return DifficultyComplex
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

func genericComplexSignals() []string {
	return []string{
		"multiple constraints", "several constraints", "tradeoff", "trade-off",
		"compare three", "compare four", "multi-step", "multiple steps",
		"across multiple", "end-to-end", "root cause", "rollout plan",
		"five constraints", "six constraints", "four options", "three plans",
		"investigate", "best approach",
	}
}

func categoryComplexSignals(category string) []string {
	switch category {
	case CategoryCode:
		return []string{"debug", "architecture", "refactor", "performance", "race condition", "multi-file", "multiple files", "distributed", "migration", "디버깅", "아키텍처", "리팩터링", "성능", "경쟁 상태", "여러 파일", "분산 시스템", "마이그레이션", "교착", "원인", "수정안"}
	case CategoryTranslation:
		return []string{"terminology", "defined terms", "modal verb", "cross-reference", "cross reference", "internal reference", "formal tone", "informal tone", "preserving tone", "preserve tone", "formatting", "table", "legal", "localize", "전문 용어", "전문용어", "법률 용어", "존댓말", "반말", "말투", "형식", "표", "현지화"}
	case CategorySummarization:
		return []string{"multiple documents", "three documents", "multi-document", "comparative", "disagreement", "unresolved conflict", "unassigned follow-up", "citations", "structured table", "long report", "여러 문서", "세 문서", "다중 문서", "비교 요약", "충돌점", "충돌 지점", "담당자 없는 후속 조치", "인용", "근거", "구조화된 표", "표로", "긴 보고서"}
	case CategoryReasoning:
		return []string{"evaluate", "options", "constraints", "tradeoff", "justify", "recommendation", "scenario", "prioritize", "평가", "대안", "제약", "트레이드오프", "근거", "추천안", "시나리오", "우선순위", "비용", "위험", "일정"}
	default:
		return []string{"compare", "plan", "constraints", "tradeoff", "alternatives", "strategy"}
	}
}

func categorySimpleSignals(category string) []string {
	switch category {
	case CategoryCode:
		return []string{"syntax", "one function", "small edit", "single api", "what does", "example"}
	case CategoryTranslation:
		return []string{"translate", "번역"}
	case CategorySummarization:
		return []string{"key points", "brief summary", "summarize", "요약"}
	case CategoryReasoning:
		return []string{"should i", "if ", "which one"}
	default:
		return []string{"explain", "what is", "how do i", "briefly", "single"}
	}
}

func hasAnyPhrase(text string, phrases []string) bool {
	for _, phrase := range phrases {
		if strings.Contains(text, phrase) {
			return true
		}
	}
	return false
}

func singleClause(text string) bool {
	return strings.Count(text, ",") == 0 &&
		strings.Count(text, ";") == 0 &&
		!strings.Contains(text, " and ") &&
		!strings.Contains(text, " then ")
}

func capabilityForCategory(category string) string {
	switch canonicalCategory(category) {
	case CategoryCode:
		return CapabilityCode
	case CategoryTranslation:
		return CapabilityTranslation
	case CategorySummarization:
		return CapabilitySummarization
	case CategoryReasoning:
		return CapabilityReasoning
	default:
		return CapabilityChat
	}
}
