package routing

import (
	_ "embed"
	"encoding/json"
	"strings"
	"unicode"
	"unicode/utf8"
)

const maxCategoryScanBytes = 2048

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
	Tokens           []string `json:"tokens"`
	RequiresToken    string   `json:"requiresToken"`
	RequiresAnyToken []string `json:"requiresAnyToken"`
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
	return RuleBasedCategoryClassifier{policy: defaultCategoryPolicy}
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
	policy = normalizeCategoryPolicy(policy)
	normalized := normalizeCategoryTextWithLimit(prompt, policy.MaxScanBytes)
	signals := RoutingSignals{
		PromptLength: utf8.RuneCountInString(prompt),
		Category:     CategoryUnknown,
	}
	if normalized == "" {
		return signals
	}

	tokens := categoryTokens(normalized)
	signals.HasCodeSignal = matchesCategoryRule(normalized, tokens, policy.Rules[CategoryCode])
	signals.WantsTranslation = matchesCategoryRule(normalized, tokens, policy.Rules[CategoryTranslation])
	signals.WantsSummarization = matchesCategoryRule(normalized, tokens, policy.Rules[CategorySummarization])
	signals.WantsStructuredOutput = matchesCategoryRule(normalized, tokens, policy.Rules[CategoryExtractionJSON])
	signals.NeedsReasoning = matchesCategoryRule(normalized, tokens, policy.Rules[CategoryReasoning])
	signals.HasSupportRefundSignal = matchesCategoryRule(normalized, tokens, policy.Rules[CategorySupportRefund])

	for _, category := range policy.CategoryPriority {
		if signalMatched(category, signals) {
			signals.Category = category
			return signals
		}
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

func matchesCategoryRule(text string, tokens []string, rule CategoryRule) bool {
	if rule.EnableCodeFence && strings.Contains(text, "```") {
		return true
	}
	if containsAny(text, rule.Contains) {
		return true
	}
	if hasAnyToken(tokens, rule.Tokens) {
		return true
	}
	if rule.EnableSQLPattern && containsSQLCodePattern(text, tokens) {
		return true
	}
	hasRequiredToken := rule.RequiresToken != ""
	hasAnyTokenRequirement := len(rule.RequiresAnyToken) > 0
	if !hasRequiredToken && !hasAnyTokenRequirement {
		return false
	}
	if hasRequiredToken && !hasToken(tokens, rule.RequiresToken) {
		return false
	}
	if hasAnyTokenRequirement && !hasAnyToken(tokens, rule.RequiresAnyToken) {
		return false
	}
	return true
}

func signalMatched(category string, signals RoutingSignals) bool {
	switch canonicalCategory(category) {
	case CategoryCode:
		return signals.HasCodeSignal
	case CategoryTranslation:
		return signals.WantsTranslation
	case CategoryExtractionJSON:
		return signals.WantsStructuredOutput
	case CategorySummarization:
		return signals.WantsSummarization
	case CategoryReasoning:
		return signals.NeedsReasoning
	case CategorySupportRefund:
		return signals.HasSupportRefundSignal
	default:
		return false
	}
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
	return policy
}

func cloneCategoryPolicy(policy CategoryPolicy) CategoryPolicy {
	clone := policy
	clone.CategoryPriority = append([]string(nil), policy.CategoryPriority...)
	clone.Rules = make(map[string]CategoryRule, len(policy.Rules))
	for category, rule := range policy.Rules {
		clone.Rules[category] = CategoryRule{
			Contains:         append([]string(nil), rule.Contains...),
			Tokens:           append([]string(nil), rule.Tokens...),
			RequiresToken:    rule.RequiresToken,
			RequiresAnyToken: append([]string(nil), rule.RequiresAnyToken...),
			EnableCodeFence:  rule.EnableCodeFence,
			EnableSQLPattern: rule.EnableSQLPattern,
		}
	}
	return clone
}
