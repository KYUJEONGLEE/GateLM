package routing

import (
	_ "embed"
	"encoding/json"
	"strings"
	"unicode"
	"unicode/utf8"
)

const maxCategoryScanBytes = 2048
const primaryIntentScanBytes = 420
const primaryIntentScoreMultiplier = 5

//go:embed category_policy.json
var defaultCategoryPolicyJSON []byte

var defaultCategoryPolicy = mustLoadCategoryPolicy(defaultCategoryPolicyJSON)

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

type RuleBasedCategoryClassifier struct {
	policy CategoryPolicy
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
	return RuleBasedCategoryClassifier{policy: cloneCategoryPolicy(defaultCategoryPolicy)}
}

func NewRuleBasedCategoryClassifierWithPolicy(policy CategoryPolicy) RuleBasedCategoryClassifier {
	return RuleBasedCategoryClassifier{policy: normalizeCategoryPolicy(cloneCategoryPolicy(policy))}
}

func DefaultCategoryPolicy() CategoryPolicy {
	return cloneCategoryPolicy(defaultCategoryPolicy)
}

func (c RuleBasedCategoryClassifier) Classify(prompt string) string {
	return extractRoutingSignals(prompt, c.policy).Category
}

func ExtractRoutingSignals(prompt string) RoutingSignals {
	return extractRoutingSignals(prompt, defaultCategoryPolicy)
}

func extractRoutingSignals(prompt string, policy CategoryPolicy) RoutingSignals {
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
	primaryIntent := categoryPrimaryIntentText(normalized)
	primaryIntentTokens := categoryTokens(primaryIntent)
	signals.HasCodeSignal = matchesCategoryRule(normalized, tokens, policy.Rules[CategoryCode])
	signals.WantsTranslation = matchesCategoryRule(normalized, tokens, policy.Rules[CategoryTranslation])
	signals.WantsSummarization = matchesCategoryRule(normalized, tokens, policy.Rules[CategorySummarization])
	signals.WantsStructuredOutput = matchesCategoryRule(normalized, tokens, policy.Rules[CategoryExtractionJSON])
	signals.NeedsReasoning = matchesCategoryRule(normalized, tokens, policy.Rules[CategoryReasoning])
	signals.HasSupportRefundSignal = matchesCategoryRule(normalized, tokens, policy.Rules[CategorySupportRefund])

	bestCategory := ""
	bestScore := 0
	for _, category := range policy.CategoryPriority {
		score := scoreCategoryRuleWithPrimaryIntent(
			normalized,
			tokens,
			primaryIntent,
			primaryIntentTokens,
			policy.Rules[canonicalCategory(category)],
		)
		if score.Matched && score.Score > bestScore {
			bestCategory = category
			bestScore = score.Score
		}
	}
	if bestCategory != "" {
		signals.Category = bestCategory
		return signals
	}

	signals.Category = CategoryGeneral
	return signals
}

func normalizeCategoryText(prompt string) string {
	return normalizeCategoryTextWithLimit(prompt, maxCategoryScanBytes)
}

func normalizeCategoryTextWithLimit(prompt string, limit int) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(categoryScanPrefixWithLimit(prompt, limit)))), " ")
}

func categoryScanPrefix(prompt string) string {
	return categoryScanPrefixWithLimit(prompt, maxCategoryScanBytes)
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

func categoryPrimaryIntentText(text string) string {
	prefix := categoryScanPrefixWithLimit(text, primaryIntentScanBytes)
	if prefix == "" {
		return ""
	}
	for _, separator := range []string{". ", "? ", "! ", "\n", "\r"} {
		if index := strings.Index(prefix, separator); index > 0 {
			return strings.TrimSpace(prefix[:index])
		}
	}
	return strings.TrimSpace(prefix)
}

func matchesCategoryRule(text string, tokens []string, rule CategoryRule) bool {
	return scoreCategoryRule(text, tokens, rule).Matched
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
