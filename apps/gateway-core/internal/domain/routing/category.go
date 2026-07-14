package routing

import (
	_ "embed"
	"encoding/json"
	"strings"
)

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

// CategoryIntentFeatures is the shared score decomposition used for every
// non-general category. General remains the fallback when no category reaches
// its evidence threshold.
type CategoryIntentFeatures struct {
	actionScore             int
	objectFitScore          int
	structuralEvidenceScore int
	intentPairScore         int
	negativeContextScore    int
}

type CategoryFeatures struct {
	code          CategoryIntentFeatures
	translation   CategoryIntentFeatures
	summarization CategoryIntentFeatures
	reasoning     CategoryIntentFeatures
}

var categoryPolicy = loadCategoryPolicy()

func loadCategoryPolicy() categoryPolicyData {
	var policy categoryPolicyData
	if err := json.Unmarshal(categoryPolicyJSON, &policy); err != nil {
		panic(err)
	}
	for category, rule := range policy.Rules {
		rule.Contains = normalizeCategoryRulePhrases(rule.Contains)
		rule.StrongSignals = normalizeCategoryRulePhrases(rule.StrongSignals)
		rule.SoftSignals = normalizeCategoryRulePhrases(rule.SoftSignals)
		rule.NegativeSignals = normalizeCategoryRulePhrases(rule.NegativeSignals)
		rule.Tokens = normalizeCategoryRulePhrases(rule.Tokens)
		rule.RequiresToken = collapseRoutingWhitespace(canonicalizeRoutingText(rule.RequiresToken))
		rule.RequiresAnyToken = normalizeCategoryRulePhrases(rule.RequiresAnyToken)
		policy.Rules[category] = rule
	}
	return policy
}

func normalizeCategoryRulePhrases(phrases []string) []string {
	for index, phrase := range phrases {
		phrases[index] = collapseRoutingWhitespace(canonicalizeRoutingText(phrase))
	}
	return phrases
}

type RuleBasedCategoryClassifier struct{}

type CategoryResult struct {
	Category    string
	Diagnostics CategoryDiagnostics
}

type PromptClassificationResult struct {
	Category   CategoryResult
	Difficulty DifficultyResult
}

type RuleBasedPromptClassifier struct {
	categoryClassifier   RuleBasedCategoryClassifier
	difficultyClassifier RuleBasedDifficultyClassifier
}

// RoutingSignals is the legacy combined category signal projection.
//
// Deprecated: use PromptFeatures and CategoryResult in new code.
type RoutingSignals struct {
	PromptLength        int
	HasCodeSignal       bool
	WantsTranslation    bool
	WantsSummarization  bool
	NeedsReasoning      bool
	Category            string
	CategoryDiagnostics CategoryDiagnostics
}

func NewRuleBasedPromptClassifier() RuleBasedPromptClassifier {
	return RuleBasedPromptClassifier{
		categoryClassifier:   NewRuleBasedCategoryClassifier(),
		difficultyClassifier: NewRuleBasedDifficultyClassifier(),
	}
}

// Classify is the canonical prompt classification entrypoint. Common prompt
// preprocessing runs once before category-aware difficulty extraction.
func (classifier RuleBasedPromptClassifier) Classify(prompt string) PromptClassificationResult {
	features := ExtractPromptFeatures(prompt)
	return classifier.ClassifyFeatures(features)
}

func (classifier RuleBasedPromptClassifier) ClassifyFeatures(features PromptFeatures) PromptClassificationResult {
	categoryResult := classifier.categoryClassifier.ClassifyFeatures(features)
	difficultyFeatures := ExtractDifficultyFeatures(features, categoryResult.Category)
	difficultyResult := classifier.difficultyClassifier.ClassifyFeatures(difficultyFeatures)
	return PromptClassificationResult{
		Category:   categoryResult,
		Difficulty: difficultyResult,
	}
}

func NewRuleBasedCategoryClassifier() RuleBasedCategoryClassifier {
	return RuleBasedCategoryClassifier{}
}

// Classify is a compatibility wrapper.
//
// Deprecated: new runtime and evaluation code must call ClassifyFeatures with
// one shared PromptFeatures value.
func (classifier RuleBasedCategoryClassifier) Classify(prompt string) string {
	return classifier.ClassifyFeatures(ExtractPromptFeatures(prompt)).Category
}

// ExtractRoutingSignals returns the legacy combined signal projection.
//
// Deprecated: use ExtractPromptFeatures and ClassifyFeatures in new code.
func (classifier RuleBasedCategoryClassifier) ExtractRoutingSignals(prompt string) RoutingSignals {
	features := ExtractPromptFeatures(prompt)
	return routingSignalsFrom(features, classifier.ClassifyFeatures(features))
}

// Diagnose is a compatibility wrapper around feature-based classification.
//
// Deprecated: use ExtractPromptFeatures and ClassifyFeatures in new code.
func (classifier RuleBasedCategoryClassifier) Diagnose(prompt string) CategoryDiagnostics {
	return classifier.ClassifyFeatures(ExtractPromptFeatures(prompt)).Diagnostics
}

// ExtractRoutingSignals is a compatibility wrapper for legacy internal callers.
//
// Deprecated: use ExtractPromptFeatures and ClassifyFeatures in new code.
func ExtractRoutingSignals(prompt string) RoutingSignals {
	classifier := NewRuleBasedCategoryClassifier()
	return classifier.ExtractRoutingSignals(prompt)
}

func (RuleBasedCategoryClassifier) ClassifyFeatures(features PromptFeatures) CategoryResult {
	scores := categoryScores(features)
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

	return CategoryResult{
		Category:    category,
		Diagnostics: diagnostics,
	}
}

func routingSignalsFrom(features PromptFeatures, result CategoryResult) RoutingSignals {
	scores := result.Diagnostics.ScoreVector
	return RoutingSignals{
		PromptLength:        features.promptRuneLength,
		HasCodeSignal:       scoreForCategory(scores, CategoryCode) > 0,
		WantsTranslation:    scoreForCategory(scores, CategoryTranslation) > 0,
		WantsSummarization:  scoreForCategory(scores, CategorySummarization) > 0,
		NeedsReasoning:      scoreForCategory(scores, CategoryReasoning) > 0,
		Category:            result.Category,
		CategoryDiagnostics: result.Diagnostics,
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

func categoryScores(features PromptFeatures) []CategoryScore {
	text := features.instructionText
	tokens := features.instructionTokens
	if text == "" && !features.hasCodeFence {
		text = features.normalizedText
		tokens = features.tokens
	}
	intentFeatures := extractCategoryFeatures(features)
	code := categoryIntentAdjustedScore(policyRuleScore(text, tokens, categoryPolicy.Rules[CategoryCode])+weightedSignalScore(text,
		[]string{"stack trace", "syntax error", "race condition", "nil pointer", "compile error"},
		[]string{"typescript", "javascript", "python", "golang", " go ", "sql", "function", "class", "api", "debug", "refactor", "code", "bug", "코드", "버그", "함수"},
	), intentFeatures.code)
	translation := categoryIntentAdjustedScore(policyRuleScore(text, tokens, categoryPolicy.Rules[CategoryTranslation])+weightedSignalScore(text,
		[]string{"translate", "translation", "번역", "영어로", "한국어로", "일본어로", "중국어로"},
		[]string{" to english", " to korean", " to japanese", " to chinese", "tone", "terminology"},
	), intentFeatures.translation)
	summarization := categoryIntentAdjustedScore(policyRuleScore(text, tokens, categoryPolicy.Rules[CategorySummarization])+weightedSignalScore(text,
		[]string{"summarize", "summary", "요약", "핵심 정리", "key points"},
		[]string{"meeting notes", "report", "document", "결론", "결정사항"},
	), intentFeatures.summarization)
	reasoning := categoryIntentAdjustedScore(policyRuleScore(text, tokens, categoryPolicy.Rules[CategoryReasoning])+weightedSignalScore(text,
		[]string{"compare", "tradeoff", "trade-off", "recommend", "evaluate", "analyze", "reason", "비교", "추천", "분석", "판단"},
		[]string{"constraint", "option", "because", "if ", "plan", "우선순위", "장단점"},
	), intentFeatures.reasoning)

	// Translation and summarization are explicit output intents and win ties.
	return []CategoryScore{
		{Category: CategoryTranslation, Score: translation, Matched: translation > 0},
		{Category: CategorySummarization, Score: summarization, Matched: summarization > 0},
		{Category: CategoryCode, Score: code, Matched: code > 0},
		{Category: CategoryReasoning, Score: reasoning, Matched: reasoning > 0},
		{Category: CategoryGeneral, Score: 0, Matched: true},
	}
}

func extractCategoryFeatures(features PromptFeatures) CategoryFeatures {
	return CategoryFeatures{
		code:          extractCategoryIntentFeatures(features, CategoryCode),
		translation:   extractCategoryIntentFeatures(features, CategoryTranslation),
		summarization: extractCategoryIntentFeatures(features, CategorySummarization),
		reasoning:     extractCategoryIntentFeatures(features, CategoryReasoning),
	}
}

func extractCategoryIntentFeatures(features PromptFeatures, category string) CategoryIntentFeatures {
	text := features.instructionText
	if text == "" {
		text = features.normalizedText
	}
	actionScore := minInt(countDistinctPhrases(text, categoryActionPhrases(category))*2, 6)
	objectFitScore := minInt(countDistinctPhrases(text, categoryObjectPhrases(category)), 4)
	structuralEvidenceScore := categoryStructuralEvidenceScore(features, category)
	intentPairScore := 0
	if actionScore > 0 && objectFitScore > 0 {
		intentPairScore = 3
	} else if actionScore > 0 && structuralEvidenceScore > 0 {
		intentPairScore = 2
	}
	negativeContextScore := minInt(countDistinctPhrases(text, categoryNegativeContextPhrases(category))*3, 6)
	return CategoryIntentFeatures{
		actionScore:             actionScore,
		objectFitScore:          objectFitScore,
		structuralEvidenceScore: structuralEvidenceScore,
		intentPairScore:         intentPairScore,
		negativeContextScore:    negativeContextScore,
	}
}

func categoryIntentAdjustedScore(base int, features CategoryIntentFeatures) int {
	// Negative context suppresses incidental category words such as menu or
	// setting names. An explicit action-object pair is stronger evidence: the
	// negative term can describe the payload being acted on (for example,
	// translating code review text) rather than negate the requested intent.
	if features.negativeContextScore > 0 && features.intentPairScore < 3 {
		return 0
	}

	bonus := features.intentPairScore + minInt(features.structuralEvidenceScore, 2)
	score := 0
	if base > 0 {
		score = base + bonus
	} else if features.intentPairScore > 0 {
		score = features.actionScore + features.objectFitScore + bonus
	} else if features.structuralEvidenceScore >= 3 {
		score = features.structuralEvidenceScore
	}
	return maxInt(score-features.negativeContextScore, 0)
}

func categoryActionPhrases(category string) []string {
	switch category {
	case CategoryCode:
		return []string{
			"fix", "debug", "refactor", "implement", "compile", "find the cause", "narrow the cause", "reproduce", "diagnose", "instrument", "rollback", "write code",
			"수정", "고쳐", "디버깅", "리팩터", "구현", "컴파일", "원인을", "원인을 좁", "재현", "진단", "계측", "롤백", "버그를 찾아",
		}
	case CategoryTranslation:
		return []string{
			"translate", "translation", "localize", "into korean", "into english", "into japanese", "into chinese", "into spanish", "into french", "into german",
			"to korean", "to english", "to japanese", "to chinese", "to spanish", "to french", "to german",
			"번역", "영문화", "현지화", "영어로", "한국어로", "일본어로", "중국어로", "스페인어로", "프랑스어로", "독일어로",
		}
	case CategorySummarization:
		return []string{
			"summarize", "summary", "condense", "shorten", "synthesize", "deduplicate", "consolidate", "group", "retain", "key points",
			"요약", "압축", "줄여", "핵심만", "요점", "짧게 정리", "추려", "종합", "중복 제거", "통합", "묶", "보존",
		}
	case CategoryReasoning:
		return []string{
			"compare", "recommend", "evaluate", "decide", "choose", "select", "prioritize", "assess", "conclude", "tradeoff", "trade-off",
			"비교", "추천", "평가", "판단", "결정", "선택", "골라", "정해", "검토", "우선순위", "결론", "장단점", "트레이드오프",
		}
	default:
		return nil
	}
}

func categoryObjectPhrases(category string) []string {
	switch category {
	case CategoryCode:
		return []string{
			"code", "function", "class", "api", "sql", "stack trace", "exception", "log", "root cause", "regression test", "state transition", "race condition", "observability", "instrumentation", "rollback", "test failure", "typescript", "javascript", "python", "golang",
			"코드", "함수", "에러", "오류", "버그", "로그", "원인", "회귀 테스트", "상태 전이", "경쟁 조건", "관측", "계측", "롤백", "테스트 실패", "타입스크립트", "자바스크립트", "파이썬",
		}
	case CategoryTranslation:
		return []string{
			"sentence", "paragraph", "document", "email", "notice", "text", "content", "copy", "review comment", "migration guide", "source text", "korean", "english", "japanese", "chinese", "spanish", "french", "german",
			"문장", "문단", "문서", "메일", "안내문", "공지", "문구", "내용", "리뷰 의견", "가이드", "원문", "한국어", "영어", "일본어", "중국어", "스페인어", "프랑스어", "독일어",
		}
	case CategorySummarization:
		return []string{
			"report", "document", "meeting notes", "record", "article", "conversation", "policy", "source", "common pattern", "trend", "exception", "agreement", "conflict", "evidence", "follow-up", "unresolved item",
			"보고서", "문서", "회의록", "기록", "대화", "정책", "공지", "메모", "자료", "공통 흐름", "추세", "예외", "합의점", "충돌점", "근거", "출처", "후속 조치", "미해결 항목",
		}
	case CategoryReasoning:
		return []string{
			"option", "alternative", "candidate", "backup", "plan", "strategy", "criteria", "constraint", "cost", "risk", "schedule", "budget", "prerequisite", "failure cost", "variable", "assumption", "conclusion",
			"대안", "후보", "차선책", "대체값", "방식", "계획", "전략", "기준", "제약", "비용", "위험", "일정", "예산", "선행 조건", "실패 비용", "변수", "가정", "결론",
		}
	default:
		return nil
	}
}

func categoryNegativeContextPhrases(category string) []string {
	phrases := append([]string(nil), categoryPolicy.Rules[category].NegativeSignals...)
	switch category {
	case CategoryCode:
		return append(phrases, "api key", "api 키", "api response example", "api 응답 예시", "payment error", "결제 오류")
	case CategoryTranslation:
		return append(phrases, "language menu", "translation setting")
	case CategorySummarization:
		return append(phrases, "summary page", "json output", "json 형태")
	case CategoryReasoning:
		return append(phrases,
			"comparison page", "priority field", "without further analysis", "no alternative comparison", "analysis is not needed",
			"우선순위 필드", "분석은 하지 말", "분석하지 말", "대안 비교는 필요 없", "json output", "json 형태",
		)
	default:
		return phrases
	}
}

func categoryStructuralEvidenceScore(features PromptFeatures, category string) int {
	text := features.instructionText
	switch category {
	case CategoryCode:
		score := 0
		structuralText := features.payloadText
		if structuralText == "" {
			structuralText = text
		}
		if features.hasCodeFence && hasCodePayloadStructure(features.payloadText) {
			score += 3
		}
		if hasAnyPhrase(structuralText, []string{"stack trace", "syntax error", "compile error", "select * from", "insert into", "update", "package main", "func", "function", "class", "const", "def", "스택 트레이스", "컴파일 에러"}) {
			score += 2
		}
		return minInt(score, 4)
	case CategoryTranslation:
		return minInt(countDistinctPhrases(text, []string{
			"to korean", "to english", "to japanese", "to chinese", "to spanish", "to french", "to german",
			"into korean", "into english", "into japanese", "into chinese", "into spanish", "into french", "into german",
			"영어로", "한국어로", "일본어로", "중국어로", "스페인어로", "프랑스어로", "독일어로", "영문화",
		})*2, 4)
	case CategorySummarization:
		if hasAnyPhrase(text, []string{"meeting notes", "long report", "multiple documents", "회의록", "긴 보고서", "여러 문서", "세 문서"}) {
			return 2
		}
	case CategoryReasoning:
		if features.scopeCount >= 2 && hasAnyPhrase(text, []string{"option", "alternative", "plan", "strategy", "대안", "방식", "계획", "전략"}) {
			return 2
		}
	}
	return 0
}

func policyRuleScore(text string, tokens map[string]struct{}, rule categoryRuleData) int {
	if text == "" || hasAnyPhrase(text, rule.NegativeSignals) {
		return 0
	}
	score := 0
	if rule.EnableCodeFence && strings.Contains(text, "```") {
		score += 4
	}
	for _, signal := range rule.Contains {
		if containsRoutingPhrase(text, signal) {
			score += 3
		}
	}
	for _, signal := range rule.StrongSignals {
		if containsRoutingPhrase(text, signal) {
			score += 3
		}
	}
	for _, signal := range rule.SoftSignals {
		if containsRoutingPhrase(text, signal) {
			score++
		}
	}
	for _, token := range rule.Tokens {
		if containsRoutingToken(tokens, token) {
			score += 2
		}
	}
	if rule.RequiresToken != "" && !containsRoutingToken(tokens, rule.RequiresToken) {
		return 0
	}
	if len(rule.RequiresAnyToken) > 0 {
		matched := false
		for _, token := range rule.RequiresAnyToken {
			if containsRoutingToken(tokens, token) {
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

func weightedSignalScore(text string, strong []string, soft []string) int {
	if text == "" {
		return 0
	}
	score := 0
	for _, signal := range strong {
		if containsRoutingPhrase(text, signal) {
			score += 3
		}
	}
	for _, signal := range soft {
		if containsRoutingPhrase(text, signal) {
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

func hasAnyPhrase(text string, phrases []string) bool {
	for _, phrase := range phrases {
		if containsRoutingPhrase(text, phrase) {
			return true
		}
	}
	return false
}

func hasCodePayloadStructure(text string) bool {
	if text == "" {
		return false
	}
	if hasAnyPhrase(text, []string{
		"package main", "func", "function", "class", "const", "let", "var", "def", "import",
		"select", "insert", "update", "stack trace", "syntax error", "compile error",
	}) {
		return true
	}
	return strings.Contains(text, ":=") || strings.Contains(text, "=>") || strings.Contains(text, "();")
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
