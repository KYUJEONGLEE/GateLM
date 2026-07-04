package routing

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

const maxCategoryScanBytes = 4096
const explicitRequestContextBytes = 560
const explicitRequestPrefixContextBytes = 280
const explicitRequestScoreMultiplier = 5
const primaryIntentScoreMultiplier = explicitRequestScoreMultiplier

//go:embed category_policy.json
var defaultCategoryPolicyJSON []byte

var defaultCategoryPolicy = categoryPolicyWithSyntheticStress(mustLoadCategoryPolicy(defaultCategoryPolicyJSON))
var defaultCompiledCategoryPolicy = compileCategoryPolicy(defaultCategoryPolicy)

const routingRuleStressTotalEnv = "GATEWAY_ROUTING_RULE_STRESS_TOTAL"

func categoryPolicyWithSyntheticStress(policy CategoryPolicy) CategoryPolicy {
	target := syntheticRoutingRuleStressTarget()
	if target <= 0 {
		return policy
	}
	return expandCategoryPolicyRuleCount(policy, target)
}

func syntheticRoutingRuleStressTarget() int {
	raw := strings.TrimSpace(os.Getenv(routingRuleStressTotalEnv))
	if raw == "" {
		return 0
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return 0
	}
	return value
}

func expandCategoryPolicyRuleCount(policy CategoryPolicy, target int) CategoryPolicy {
	policy = cloneCategoryPolicy(normalizeCategoryPolicy(policy))
	categories := append([]string(nil), policy.CategoryPriority...)
	if len(categories) == 0 {
		return policy
	}
	count := categoryPolicyRuleCount(policy)
	for count < target {
		for _, category := range categories {
			if count >= target {
				break
			}
			canonical := canonicalCategory(category)
			rule := policy.Rules[canonical]
			rule.SoftSignals = append(rule.SoftSignals, fmt.Sprintf("__gatelm_synthetic_rule_stress_%06d__", count+1))
			policy.Rules[canonical] = rule
			count++
		}
	}
	return normalizeCategoryPolicy(policy)
}

func categoryPolicyRuleCount(policy CategoryPolicy) int {
	count := 0
	for _, rule := range policy.Rules {
		count += len(rule.Contains)
		count += len(rule.StrongSignals)
		count += len(rule.SoftSignals)
		count += len(rule.NegativeSignals)
		count += len(rule.Tokens)
		if strings.TrimSpace(rule.RequiresToken) != "" {
			count++
		}
		count += len(rule.RequiresAnyToken)
	}
	return count
}

type CategoryPolicy struct {
	SchemaVersion    string                  `json:"schemaVersion"`
	PolicyVersion    string                  `json:"policyVersion"`
	MaxScanBytes     int                     `json:"maxScanBytes"`
	CategoryPriority []string                `json:"categoryPriority"`
	Rules            map[string]CategoryRule `json:"rules"`
}

type CategoryRule struct {
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
type compiledCategoryPolicy struct {
	policy  CategoryPolicy
	matcher categoryPhraseMatcher
}

type categoryPhraseKind int

const (
	categoryPhraseContains categoryPhraseKind = iota
	categoryPhraseStrong
	categoryPhraseSoft
	categoryPhraseNegative
)

type categoryPhraseCounts struct {
	Contains int
	Strong   int
	Soft     int
	Negative int
}

type categoryPhraseMatches struct {
	byCategory map[string]categoryPhraseCounts
}

func (m categoryPhraseMatches) Category(category string) categoryPhraseCounts {
	if m.byCategory == nil {
		return categoryPhraseCounts{}
	}
	return m.byCategory[canonicalCategory(category)]
}

func (m categoryPhraseMatches) add(pattern categoryPhrasePattern) {
	category := canonicalCategory(pattern.Category)
	counts := m.byCategory[category]
	switch pattern.Kind {
	case categoryPhraseContains:
		counts.Contains++
	case categoryPhraseStrong:
		counts.Strong++
	case categoryPhraseSoft:
		counts.Soft++
	case categoryPhraseNegative:
		counts.Negative++
	}
	m.byCategory[category] = counts
}

type categoryPhrasePattern struct {
	Category string
	Kind     categoryPhraseKind
	Phrase   string
}

type categoryPhraseNode struct {
	Next    map[rune]int
	Fail    int
	Outputs []int
}

type categoryPhraseMatcher struct {
	nodes    []categoryPhraseNode
	patterns []categoryPhrasePattern
}

func compileCategoryPolicy(policy CategoryPolicy) compiledCategoryPolicy {
	policy = normalizeCategoryPolicy(cloneCategoryPolicy(policy))
	matcher := newCategoryPhraseMatcher()
	seen := map[string]struct{}{}
	for category, rule := range policy.Rules {
		category = canonicalCategory(category)
		matcher.addAll(category, categoryPhraseContains, rule.Contains, seen)
		matcher.addAll(category, categoryPhraseStrong, rule.StrongSignals, seen)
		matcher.addAll(category, categoryPhraseSoft, rule.SoftSignals, seen)
		matcher.addAll(category, categoryPhraseNegative, rule.NegativeSignals, seen)
	}
	matcher.Build()
	return compiledCategoryPolicy{policy: policy, matcher: matcher}
}

func newCategoryPhraseMatcher() categoryPhraseMatcher {
	return categoryPhraseMatcher{nodes: []categoryPhraseNode{{Next: map[rune]int{}}}}
}

func (m *categoryPhraseMatcher) addAll(category string, kind categoryPhraseKind, phrases []string, seen map[string]struct{}) {
	for _, phrase := range phrases {
		m.Add(category, kind, phrase, seen)
	}
}

func (m *categoryPhraseMatcher) Add(category string, kind categoryPhraseKind, phrase string, seen map[string]struct{}) {
	phrase = normalizeCategoryNeedle(phrase)
	if phrase == "" {
		return
	}
	key := category + "\x00" + strconv.Itoa(int(kind)) + "\x00" + phrase
	if _, ok := seen[key]; ok {
		return
	}
	seen[key] = struct{}{}

	patternID := len(m.patterns)
	m.patterns = append(m.patterns, categoryPhrasePattern{Category: category, Kind: kind, Phrase: phrase})
	state := 0
	for _, r := range phrase {
		if m.nodes[state].Next == nil {
			m.nodes[state].Next = map[rune]int{}
		}
		next, ok := m.nodes[state].Next[r]
		if !ok {
			next = len(m.nodes)
			m.nodes[state].Next[r] = next
			m.nodes = append(m.nodes, categoryPhraseNode{Next: map[rune]int{}})
		}
		state = next
	}
	m.nodes[state].Outputs = append(m.nodes[state].Outputs, patternID)
}

func (m *categoryPhraseMatcher) Build() {
	if len(m.nodes) == 0 {
		*m = newCategoryPhraseMatcher()
		return
	}
	queue := make([]int, 0, len(m.nodes))
	for _, next := range m.nodes[0].Next {
		m.nodes[next].Fail = 0
		queue = append(queue, next)
	}
	for head := 0; head < len(queue); head++ {
		state := queue[head]
		for r, next := range m.nodes[state].Next {
			fail := m.nodes[state].Fail
			for fail != 0 {
				if fallback, ok := m.nodes[fail].Next[r]; ok {
					fail = fallback
					break
				}
				fail = m.nodes[fail].Fail
			}
			if fallback, ok := m.nodes[fail].Next[r]; ok && fallback != next {
				m.nodes[next].Fail = fallback
			} else {
				m.nodes[next].Fail = 0
			}
			if outputs := m.nodes[m.nodes[next].Fail].Outputs; len(outputs) > 0 {
				m.nodes[next].Outputs = append(m.nodes[next].Outputs, outputs...)
			}
			queue = append(queue, next)
		}
	}
}

func (m categoryPhraseMatcher) Match(text string) categoryPhraseMatches {
	matches := categoryPhraseMatches{byCategory: map[string]categoryPhraseCounts{}}
	if len(m.nodes) == 0 || len(m.patterns) == 0 || text == "" {
		return matches
	}
	seen := make([]bool, len(m.patterns))
	state := 0
	for _, r := range text {
		state = m.nextState(state, r)
		for _, patternID := range m.nodes[state].Outputs {
			if patternID < 0 || patternID >= len(m.patterns) || seen[patternID] {
				continue
			}
			seen[patternID] = true
			matches.add(m.patterns[patternID])
		}
	}
	return matches
}

func (m categoryPhraseMatcher) nextState(state int, r rune) int {
	for state != 0 {
		if next, ok := m.nodes[state].Next[r]; ok {
			return next
		}
		state = m.nodes[state].Fail
	}
	if next, ok := m.nodes[0].Next[r]; ok {
		return next
	}
	return 0
}

type RuleBasedCategoryClassifier struct {
	compiled compiledCategoryPolicy
}

type RoutingSignals struct {
	PromptLength           int
	HasCodeSignal          bool
	WantsTranslation       bool
	WantsSummarization     bool
	WantsStructuredOutput  bool
	NeedsReasoning         bool
	HasSupportRefundSignal bool
	Category               string
}

func NewRuleBasedCategoryClassifier() RuleBasedCategoryClassifier {
	return RuleBasedCategoryClassifier{compiled: defaultCompiledCategoryPolicy}
}

func NewRuleBasedCategoryClassifierWithPolicy(policy CategoryPolicy) RuleBasedCategoryClassifier {
	return RuleBasedCategoryClassifier{compiled: compileCategoryPolicy(policy)}
}

func DefaultCategoryPolicy() CategoryPolicy {
	return cloneCategoryPolicy(defaultCategoryPolicy)
}

func (c RuleBasedCategoryClassifier) Classify(prompt string) string {
	if c.compiled.policy.Rules == nil {
		return extractRoutingSignalsCompiled(prompt, defaultCompiledCategoryPolicy).Category
	}
	return extractRoutingSignalsCompiled(prompt, c.compiled).Category
}

func ExtractRoutingSignals(prompt string) RoutingSignals {
	return extractRoutingSignalsCompiled(prompt, defaultCompiledCategoryPolicy)
}

func extractRoutingSignals(prompt string, policy CategoryPolicy) RoutingSignals {
	return extractRoutingSignalsCompiled(prompt, compileCategoryPolicy(policy))
}

func extractRoutingSignalsCompiled(prompt string, compiled compiledCategoryPolicy) RoutingSignals {
	policy := compiled.policy
	normalized := normalizeCategoryTextWithLimit(prompt, policy.MaxScanBytes)
	signals := RoutingSignals{
		PromptLength: utf8.RuneCountInString(prompt),
		Category:     CategoryUnknown,
	}
	if normalized == "" {
		return signals
	}

	tokens := categoryTokens(normalized)
	if isUnclassifiablePrompt(normalized, tokens) {
		return signals
	}
	explicitRequest := categoryExplicitRequestText(normalized)
	explicitRequestTokens := categoryTokens(explicitRequest)
	matches := compiled.matcher.Match(normalized)
	explicitRequestMatches := compiled.matcher.Match(explicitRequest)
	signals.HasCodeSignal = matchesCategoryRuleCompiled(normalized, tokens, policy.Rules[CategoryCode], matches.Category(CategoryCode))
	signals.WantsTranslation = matchesCategoryRuleCompiled(normalized, tokens, policy.Rules[CategoryTranslation], matches.Category(CategoryTranslation))
	signals.WantsSummarization = matchesCategoryRuleCompiled(normalized, tokens, policy.Rules[CategorySummarization], matches.Category(CategorySummarization))
	signals.WantsStructuredOutput = matchesCategoryRuleCompiled(normalized, tokens, policy.Rules[CategoryExtractionJSON], matches.Category(CategoryExtractionJSON))
	signals.NeedsReasoning = matchesCategoryRuleCompiled(normalized, tokens, policy.Rules[CategoryReasoning], matches.Category(CategoryReasoning))
	signals.HasSupportRefundSignal = matchesCategoryRuleCompiled(normalized, tokens, policy.Rules[CategorySupportRefund], matches.Category(CategorySupportRefund))

	if explicitRequest != "" {
		if isVagueUnknownPrompt(explicitRequest, explicitRequestTokens) {
			return signals
		}
		if categoryExplicitGeneralRequest(explicitRequest, explicitRequestTokens) {
			signals.Category = CategoryGeneral
			return signals
		}
		if bestCategory, ok := bestCategoryForCompiledPolicy(policy, explicitRequest, explicitRequestTokens, explicitRequestMatches); ok {
			signals.Category = bestCategory
			return signals
		}
	}

	if bestCategory, ok := bestCategoryForCompiledPolicy(policy, normalized, tokens, matches); ok {
		signals.Category = bestCategory
		return signals
	}

	if isVagueUnknownPrompt(normalized, tokens) {
		return signals
	}

	signals.Category = CategoryGeneral
	return signals
}
func normalizeCategoryText(prompt string) string {
	return normalizeCategoryTextWithLimit(prompt, maxCategoryScanBytes)
}

func normalizeCategoryTextWithLimit(prompt string, limit int) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(categoryScanTextWithLimit(prompt, limit)))), " ")
}

func categoryScanPrefix(prompt string) string {
	return categoryScanPrefixWithLimit(prompt, maxCategoryScanBytes)
}

func categoryScanTextWithLimit(prompt string, limit int) string {
	if limit <= 0 {
		limit = maxCategoryScanBytes
	}
	if len(prompt) <= limit {
		return prompt
	}

	headLimit := limit / 2
	tailLimit := limit - headLimit
	head := categoryScanPrefixWithLimit(prompt, headLimit)
	tail := categoryScanSuffixWithLimit(prompt, tailLimit)
	if head == "" {
		return tail
	}
	if tail == "" {
		return head
	}
	return head + "\n" + tail
}

func categoryScanPrefixWithLimit(prompt string, limit int) string {
	if limit <= 0 {
		limit = maxCategoryScanBytes
	}
	if len(prompt) <= limit {
		return prompt
	}

	for limit > 0 && !utf8.RuneStart(prompt[limit]) {
		limit--
	}
	if limit <= 0 {
		return ""
	}
	return prompt[:limit]
}

func categoryScanSuffixWithLimit(prompt string, limit int) string {
	if limit <= 0 {
		limit = maxCategoryScanBytes
	}
	if len(prompt) <= limit {
		return prompt
	}

	start := len(prompt) - limit
	for start < len(prompt) && !utf8.RuneStart(prompt[start]) {
		start++
	}
	if start >= len(prompt) {
		return ""
	}
	return prompt[start:]
}

func categoryExplicitRequestText(text string) string {
	if text == "" {
		return ""
	}
	index := lastExplicitRequestMarkerIndex(text, explicitRequestAnchorMarkers())
	if index < 0 {
		index = lastExplicitRequestMarkerIndex(text, explicitRequestMarkers())
	}
	if index < 0 {
		return ""
	}

	start := explicitRequestStartIndex(text, index)
	for start > 0 && !utf8.RuneStart(text[start]) {
		start--
	}
	end := index + explicitRequestContextBytes
	if end > len(text) {
		end = len(text)
	}
	for end < len(text) && !utf8.RuneStart(text[end]) {
		end++
	}
	return trimExplicitRequestTrailingContext(strings.TrimSpace(text[start:end]))
}

func trimExplicitRequestTrailingContext(text string) string {
	for _, marker := range []string{
		"\n추가 배경:",
		"\n참고:",
		"추가 배경: 이 문장에는",
		"이 문장에는 코드, 번역, 환불, json, 요약",
	} {
		if index := strings.Index(text, marker); index > 0 {
			return strings.TrimSpace(text[:index])
		}
	}
	return text
}

func explicitRequestStartIndex(text string, markerIndex int) int {
	start := markerIndex - explicitRequestPrefixContextBytes
	if start < 0 {
		start = 0
	}
	for i := markerIndex; i > start; {
		r, size := utf8.DecodeLastRuneInString(text[:i])
		if r == utf8.RuneError && size == 0 {
			break
		}
		i -= size
		switch r {
		case '\n', '\r', '.', '!', '?', '。', '！', '？':
			return i + size
		}
	}
	return start
}

func lastExplicitRequestMarkerIndex(text string, markers []string) int {
	index := -1
	for _, marker := range markers {
		if markerIndex := strings.LastIndex(text, marker); markerIndex > index {
			index = markerIndex
		}
	}
	return index
}

func explicitRequestAnchorMarkers() []string {
	return []string{
		"마지막 요청",
		"최종 요청",
		"실제 요청",
		"진짜 요청",
		"요청:",
		"질문:",
		"실제로 필요한 건",
		"필요한 건 이거야",
		"결론적으로",
		"정리하면",
		"final request",
		"last request",
	}
}

func categoryExplicitGeneralRequest(text string, tokens []string) bool {
	if text == "" || categoryExplicitNonGeneralRequest(text, tokens) {
		return false
	}
	return containsAny(text, []string{
		"무엇을 하는",
		"뭐 하는",
		"처음 보는",
		"비개발자도 이해",
		"쉽게 설명",
		"간단히 설명",
		"무엇인지",
		"뭔지",
		"왜 필요한지",
		"어디서 확인",
		"메뉴 위치",
		"위치만 알려",
		"사용 방법",
		"관련 문서",
		"어떤 값을 봐야",
		"설명해줘",
		"설명해 주세요",
		"what is",
		"explain what",
		"explain how this feature works",
	})
}

func categoryExplicitNonGeneralRequest(text string, tokens []string) bool {
	if categoryExplicitCodeLikeRequest(text, tokens) {
		return true
	}
	return containsAny(text, []string{
		"환불",
		"반품",
		"취소",
		"결제",
		"청구",
		"고객 응대",
		"고객에게 답변",
		"문의가 왔",
		"안내 답변",
		"답변 문구",
		"영어로",
		"영문으로",
		"한국어로",
		"일본어로",
		"중국어로",
		"번역",
		"직역",
		"비즈니스 영어",
		"자연스러운 영어",
		"json",
		"key/value",
		"필드",
		"추출",
		"뽑아줘",
		"나눠줘",
		"요약",
		"줄여줘",
		"핵심 결정사항",
		"중복 의견",
		"비교",
		"판단",
		"추천",
		"근거",
		"장단점",
		"트레이드오프",
		"우선순위",
		"adapter",
		"handler",
		"cache key",
		"테스트가 깨",
		"병목",
		"race condition",
		"코드 흐름",
		"리팩토링",
		"원인 후보",
		"영어 메일",
		"일본어 고객",
		"중국어 사용자",
		"제품 안내 톤",
		"어색하지 않게",
		"메일 문체",
		"짧게 정리",
		"압축",
		"불릿",
		"결론만 정리",
	})
}

func categoryExplicitCodeLikeRequest(text string, tokens []string) bool {
	if strings.Contains(text, "```") || containsSQLCodePattern(text, tokens) {
		return true
	}
	return containsAny(text, []string{
		"코드",
		"버그",
		"에러",
		"오류",
		"함수",
		"리팩토링",
		"수정할 코드",
		"코드 위치",
		"go gateway",
		"typescript",
		"javascript",
		"python",
		"sql",
		"nil pointer",
		"stack trace",
		"compile",
	})
}

func bestCategoryForCompiledPolicy(policy CategoryPolicy, text string, tokens []string, matches categoryPhraseMatches) (string, bool) {
	bestCategory := ""
	bestScore := 0
	for _, category := range policy.CategoryPriority {
		canonical := canonicalCategory(category)
		score := scoreCategoryRuleCompiled(text, tokens, policy.Rules[canonical], matches.Category(canonical))
		if score.Matched && score.Score > bestScore {
			bestCategory = category
			bestScore = score.Score
		}
	}
	return bestCategory, bestCategory != ""
}

func explicitRequestMarkers() []string {
	return []string{
		"마지막 요청",
		"최종 요청",
		"결론적으로",
		"정리하면",
		"요약해",
		"요약해줘",
		"번역해",
		"번역해줘",
		"바꿔줘",
		"다듬어줘",
		"고쳐줘",
		"정리해",
		"정리해줘",
		"작성해",
		"작성해줘",
		"써줘",
		"만들어줘",
		"비교해",
		"비교해줘",
		"추천해",
		"추천해줘",
		"분석해",
		"분석해줘",
		"판단해",
		"판단해줘",
		"찾아줘",
		"찾아봐",
		"봐줘",
		"알려줘",
		"뽑아줘",
		"추출해",
		"추출해줘",
		"json으로",
		"표로",
		"해줘",
		"해주세요",
		"please",
		"summarize",
		"translate",
		"extract",
		"compare",
		"recommend",
		"write",
		"return as json",
	}
}

func isVagueUnknownPrompt(text string, tokens []string) bool {
	normalized := strings.TrimSpace(text)
	if normalized == "" {
		return true
	}
	noise := []string{
		"좀 급한데",
		"너무 길게 말고 핵심만 부탁해",
		"실제로 필요한 건 이거야",
		"정리하면",
		"요청:",
		"질문:",
	}
	for _, value := range noise {
		normalized = strings.ReplaceAll(normalized, value, " ")
	}
	normalized = strings.Join(strings.Fields(strings.TrimSpace(normalized)), " ")
	switch normalized {
	case "", ".", "...", "…", "????", "???", "test", "테스트", "확인", "확인...", "확인 / 테스트", "test / 테스트", "test / ...":
		return true
	}
	if len(tokens) > 4 {
		return false
	}
	meaningful := 0
	for _, token := range tokens {
		token = strings.Trim(token, "_/.?…")
		switch token {
		case "", "좀", "급한데", "너무", "길게", "말고", "핵심만", "부탁해", "요청", "질문":
			continue
		case "test", "테스트", "확인":
			continue
		default:
			meaningful++
		}
	}
	return meaningful == 0
}

func matchesCategoryRule(text string, tokens []string, rule CategoryRule) bool {
	return scoreCategoryRule(text, tokens, rule).Matched
}

func matchesCategoryRuleCompiled(text string, tokens []string, rule CategoryRule, matches categoryPhraseCounts) bool {
	return scoreCategoryRuleCompiled(text, tokens, rule, matches).Matched
}

type categoryRuleScore struct {
	Matched bool
	Score   int
}

func scoreCategoryRuleWithPrimaryIntent(text string, tokens []string, primaryText string, primaryTokens []string, rule CategoryRule) categoryRuleScore {
	fullScore := scoreCategoryRule(text, tokens, rule)
	if primaryText == "" || primaryText == text {
		return fullScore
	}

	primaryScore := scoreCategoryRule(primaryText, primaryTokens, rule)
	if !primaryScore.Matched {
		return fullScore
	}

	score := fullScore.Score + primaryScore.Score*primaryIntentScoreMultiplier
	return categoryRuleScore{Matched: true, Score: score}
}

func scoreCategoryRuleWithPrimaryIntentCompiled(text string, tokens []string, primaryText string, primaryTokens []string, rule CategoryRule, matches categoryPhraseCounts, primaryMatches categoryPhraseCounts) categoryRuleScore {
	fullScore := scoreCategoryRuleCompiled(text, tokens, rule, matches)
	if primaryText == "" || primaryText == text {
		return fullScore
	}

	primaryScore := scoreCategoryRuleCompiled(primaryText, primaryTokens, rule, primaryMatches)
	if !primaryScore.Matched {
		return fullScore
	}

	score := fullScore.Score + primaryScore.Score*primaryIntentScoreMultiplier
	return categoryRuleScore{Matched: true, Score: score}
}

func scoreCategoryRuleWithExplicitRequestCompiled(text string, tokens []string, explicitRequestText string, explicitRequestTokens []string, rule CategoryRule, matches categoryPhraseCounts, explicitRequestMatches categoryPhraseCounts) categoryRuleScore {
	fullScore := scoreCategoryRuleCompiled(text, tokens, rule, matches)
	if explicitRequestText == "" || explicitRequestText == text {
		return fullScore
	}

	explicitRequestScore := scoreCategoryRuleCompiled(explicitRequestText, explicitRequestTokens, rule, explicitRequestMatches)
	if !explicitRequestScore.Matched {
		return fullScore
	}

	score := fullScore.Score + explicitRequestScore.Score*explicitRequestScoreMultiplier
	return categoryRuleScore{Matched: true, Score: score}
}

func scoreCategoryRule(text string, tokens []string, rule CategoryRule) categoryRuleScore {
	if containsAny(text, rule.NegativeSignals) {
		return categoryRuleScore{}
	}

	score := 0
	if rule.EnableCodeFence && strings.Contains(text, "```") {
		score += 4
	}
	if containsAny(text, rule.Contains) {
		score += 3
	}
	score += 3 * countContains(text, rule.StrongSignals)
	score += countContains(text, rule.SoftSignals)
	score += 2 * countTokens(tokens, rule.Tokens)
	if rule.EnableSQLPattern && containsSQLCodePattern(text, tokens) {
		score += 4
	}

	hasRequiredToken := rule.RequiresToken != ""
	hasAnyTokenRequirement := len(rule.RequiresAnyToken) > 0
	if !hasRequiredToken && !hasAnyTokenRequirement {
		threshold := rule.Threshold
		if threshold <= 0 {
			threshold = 3
		}
		return categoryRuleScore{Matched: score >= threshold, Score: score}
	}
	if hasRequiredToken && !hasToken(tokens, rule.RequiresToken) {
		return categoryRuleScore{Score: score}
	}
	if hasAnyTokenRequirement && !hasAnyToken(tokens, rule.RequiresAnyToken) {
		return categoryRuleScore{Score: score}
	}
	score += 3
	threshold := rule.Threshold
	if threshold <= 0 {
		threshold = 3
	}
	return categoryRuleScore{Matched: score >= threshold, Score: score}
}
func scoreCategoryRuleCompiled(text string, tokens []string, rule CategoryRule, matches categoryPhraseCounts) categoryRuleScore {
	if matches.Negative > 0 {
		return categoryRuleScore{}
	}

	score := 0
	if rule.EnableCodeFence && strings.Contains(text, "```") {
		score += 4
	}
	if matches.Contains > 0 {
		score += 3
	}
	score += 3 * matches.Strong
	score += matches.Soft
	score += 2 * countTokens(tokens, rule.Tokens)
	if rule.EnableSQLPattern && containsSQLCodePattern(text, tokens) {
		score += 4
	}

	hasRequiredToken := rule.RequiresToken != ""
	hasAnyTokenRequirement := len(rule.RequiresAnyToken) > 0
	if !hasRequiredToken && !hasAnyTokenRequirement {
		threshold := rule.Threshold
		if threshold <= 0 {
			threshold = 3
		}
		return categoryRuleScore{Matched: score >= threshold, Score: score}
	}
	if hasRequiredToken && !hasToken(tokens, rule.RequiresToken) {
		return categoryRuleScore{Score: score}
	}
	if hasAnyTokenRequirement && !hasAnyToken(tokens, rule.RequiresAnyToken) {
		return categoryRuleScore{Score: score}
	}
	score += 3
	threshold := rule.Threshold
	if threshold <= 0 {
		threshold = 3
	}
	return categoryRuleScore{Matched: score >= threshold, Score: score}
}
func containsAny(value string, needles []string) bool {
	for _, needle := range needles {
		if needle == "" {
			continue
		}
		if strings.Contains(value, needle) {
			return true
		}
	}
	return false
}

func countContains(value string, needles []string) int {
	count := 0
	for _, needle := range needles {
		if needle == "" {
			continue
		}
		if strings.Contains(value, needle) {
			count++
		}
	}
	return count
}

func countTokens(tokens []string, targets []string) int {
	count := 0
	for _, target := range targets {
		if hasToken(tokens, target) {
			count++
		}
	}
	return count
}

func categoryTokens(text string) []string {
	return strings.FieldsFunc(text, func(r rune) bool {
		return !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_')
	})
}

func isUnclassifiablePrompt(text string, tokens []string) bool {
	if len(tokens) == 0 {
		return true
	}
	switch strings.TrimSpace(text) {
	case "[redacted]", "[masked]", "[전부 마스킹됨]", "내용 없음", "내용없음", "n/a", "na":
		return true
	}

	for _, token := range tokens {
		if strings.Trim(token, "_") != "" {
			return false
		}
	}
	return true
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
	default:
		return CapabilityChat
	}
}

func mustLoadCategoryPolicy(payload []byte) CategoryPolicy {
	var policy CategoryPolicy
	if err := json.Unmarshal(payload, &policy); err != nil {
		panic(err)
	}
	return normalizeCategoryPolicy(policy)
}

func normalizeCategoryPolicy(policy CategoryPolicy) CategoryPolicy {
	if policy.MaxScanBytes <= 0 {
		policy.MaxScanBytes = maxCategoryScanBytes
	}
	if len(policy.CategoryPriority) == 0 {
		policy.CategoryPriority = []string{
			CategoryCode,
			CategoryTranslation,
			CategoryExtractionJSON,
			CategorySummarization,
			CategoryReasoning,
			CategorySupportRefund,
		}
	}
	if policy.Rules == nil {
		policy.Rules = map[string]CategoryRule{}
	}
	for category, rule := range policy.Rules {
		rule.Contains = normalizeCategoryNeedles(rule.Contains)
		rule.StrongSignals = normalizeCategoryNeedles(rule.StrongSignals)
		rule.SoftSignals = normalizeCategoryNeedles(rule.SoftSignals)
		rule.NegativeSignals = normalizeCategoryNeedles(rule.NegativeSignals)
		rule.Tokens = normalizeCategoryNeedles(rule.Tokens)
		rule.RequiresToken = normalizeCategoryNeedle(rule.RequiresToken)
		rule.RequiresAnyToken = normalizeCategoryNeedles(rule.RequiresAnyToken)
		policy.Rules[category] = rule
	}
	return policy
}

func normalizeCategoryNeedles(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		value = normalizeCategoryNeedle(value)
		if value == "" {
			continue
		}
		normalized = append(normalized, value)
	}
	return normalized
}

func normalizeCategoryNeedle(value string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(value))), " ")
}

func cloneCategoryPolicy(policy CategoryPolicy) CategoryPolicy {
	clone := policy
	clone.CategoryPriority = append([]string(nil), policy.CategoryPriority...)
	clone.Rules = make(map[string]CategoryRule, len(policy.Rules))
	for category, rule := range policy.Rules {
		clone.Rules[category] = CategoryRule{
			Contains:         append([]string(nil), rule.Contains...),
			StrongSignals:    append([]string(nil), rule.StrongSignals...),
			SoftSignals:      append([]string(nil), rule.SoftSignals...),
			NegativeSignals:  append([]string(nil), rule.NegativeSignals...),
			Tokens:           append([]string(nil), rule.Tokens...),
			RequiresToken:    rule.RequiresToken,
			RequiresAnyToken: append([]string(nil), rule.RequiresAnyToken...),
			Threshold:        rule.Threshold,
			EnableCodeFence:  rule.EnableCodeFence,
			EnableSQLPattern: rule.EnableSQLPattern,
		}
	}
	return clone
}
