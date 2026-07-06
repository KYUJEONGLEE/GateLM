package cache

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
)

const (
	SemanticCachePolicyModeDisabled      = "disabled"
	SemanticCachePolicyModeCandidateOnly = "candidate_only"
	SemanticCachePolicyModeStrictHit     = "strict_hit"

	SemanticCacheReasonIntentPolicyUnavailable = "intent_policy_unavailable"
	SemanticCacheReasonIntentUnavailable       = "intent_unavailable"
	SemanticCacheReasonIntentMaterialMissing   = "intent_material_missing"
	SemanticCacheReasonIntentMismatch          = "canonical_intent_mismatch"
	SemanticCacheReasonSlotsUnavailable        = "slots_unavailable"
	SemanticCacheReasonSlotsMismatch           = "required_slots_mismatch"
	SemanticCacheReasonHardNegative            = "hard_negative_guard_failed"
	SemanticCacheReasonCategoryDisabled        = "category_denied"
	SemanticCacheReasonCandidateOnly           = "candidate_only"
	SemanticCacheReasonDynamicUserStateDenied  = "dynamic_user_state_denied"
	SemanticCacheReasonAccountAccessDenied     = "account_access_denied"
	SemanticCacheReasonSupportRefundDenied     = "support_refund_denied"
)

var ErrSemanticCacheIntentPolicyInvalid = errors.New("semantic cache intent policy is invalid")

type SemanticCacheHitPolicy struct {
	PolicyVersion           string                               `json:"semanticCachePolicyVersion"`
	CanonicalizationVersion string                               `json:"canonicalizationVersion"`
	SynonymPolicyVersion    string                               `json:"synonymPolicyVersion"`
	DefaultThreshold        float64                              `json:"defaultThreshold"`
	BypassRules             []SemanticCachePolicyRule            `json:"bypassRules,omitempty"`
	DenyRules               []SemanticCachePolicyRule            `json:"denyRules,omitempty"`
	StrictAllowRules        []SemanticCacheStrictAllowRule       `json:"strictAllowRules,omitempty"`
	Categories              map[string]SemanticCacheCategoryMode `json:"categories"`
	Synonyms                map[string]map[string][]string       `json:"synonyms"`
	Intents                 map[string]SemanticCacheIntentRule   `json:"intents"`
	ForbiddenIntentPairs    []SemanticCacheIntentPair            `json:"forbiddenIntentPairs"`
}

type SemanticCachePolicyRule struct {
	ID                 string   `json:"id"`
	Reason             string   `json:"reason"`
	Categories         []string `json:"categories,omitempty"`
	CanonicalIntents   []string `json:"canonicalIntents,omitempty"`
	RequiredSlotKeys   []string `json:"requiredSlotKeys,omitempty"`
	RequiredSlotValues []string `json:"requiredSlotValues,omitempty"`
}

type SemanticCacheStrictAllowRule struct {
	ID               string   `json:"id"`
	Reason           string   `json:"reason"`
	Categories       []string `json:"categories,omitempty"`
	CanonicalIntents []string `json:"canonicalIntents,omitempty"`
}

type SemanticCacheCategoryMode struct {
	Enabled               bool    `json:"enabled"`
	Mode                  string  `json:"mode"`
	CategoryThreshold     float64 `json:"categoryThreshold"`
	RequiresIntent        bool    `json:"requiresIntent"`
	RequiresRequiredSlots bool    `json:"requiresRequiredSlots"`
	RequiresHardNegative  bool    `json:"requiresHardNegative"`
}

type SemanticCacheIntentRule struct {
	Category      string            `json:"category"`
	MatchAll      []string          `json:"matchAll"`
	RequiredSlots map[string]string `json:"requiredSlots"`
	OptionalSlots map[string]string `json:"optionalSlots"`
	Priority      int               `json:"priority"`
}

type SemanticCacheIntentPair struct {
	Category string `json:"category"`
	First    string `json:"first"`
	Second   string `json:"second"`
	Reason   string `json:"reason"`
}

type SemanticCacheIntentMaterial struct {
	Category                string            `json:"category"`
	CanonicalIntent         string            `json:"canonicalIntent"`
	RequiredSlots           map[string]string `json:"requiredSlots,omitempty"`
	RequiredSlotsHash       string            `json:"requiredSlotsHash"`
	OptionalSlots           map[string]string `json:"optionalSlots,omitempty"`
	OptionalSlotsHash       string            `json:"optionalSlotsHash,omitempty"`
	CanonicalizationVersion string            `json:"canonicalizationVersion"`
	SynonymPolicyVersion    string            `json:"synonymPolicyVersion"`
	MaterialHash            string            `json:"materialHash"`
}

type SemanticCacheIntentDecision struct {
	Allowed                 bool
	Outcome                 string
	Reason                  string
	Category                string
	CanonicalIntent         string
	RequiredSlotsHash       string
	CategoryThreshold       float64
	SemanticSimilarity      float64
	PolicyVersion           string
	CanonicalizationVersion string
	HardNegativeMatched     bool
	ProviderBypassAllowed   bool
}

func LoadSemanticCacheHitPolicyFile(path string) (SemanticCacheHitPolicy, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return SemanticCacheHitPolicy{}, fmt.Errorf("%w: empty policy path", ErrSemanticCacheIntentPolicyInvalid)
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		return SemanticCacheHitPolicy{}, err
	}
	var policy SemanticCacheHitPolicy
	if err := json.Unmarshal(payload, &policy); err != nil {
		return SemanticCacheHitPolicy{}, err
	}
	return policy.Normalize()
}

func (p SemanticCacheHitPolicy) Normalize() (SemanticCacheHitPolicy, error) {
	p.PolicyVersion = strings.TrimSpace(p.PolicyVersion)
	if p.PolicyVersion == "" {
		p.PolicyVersion = "v1"
	}
	p.CanonicalizationVersion = strings.TrimSpace(p.CanonicalizationVersion)
	if p.CanonicalizationVersion == "" {
		p.CanonicalizationVersion = p.PolicyVersion
	}
	p.SynonymPolicyVersion = strings.TrimSpace(p.SynonymPolicyVersion)
	if p.SynonymPolicyVersion == "" {
		p.SynonymPolicyVersion = p.CanonicalizationVersion
	}
	if p.DefaultThreshold <= 0 || p.DefaultThreshold > 1 {
		p.DefaultThreshold = 0.92
	}

	p.Categories = normalizeCategoryModes(p.Categories)
	p.BypassRules = normalizeSemanticCachePolicyRules(p.BypassRules)
	p.DenyRules = normalizeSemanticCachePolicyRules(p.DenyRules)
	p.StrictAllowRules = normalizeSemanticCacheStrictAllowRules(p.StrictAllowRules)
	p.Synonyms = normalizeSynonymPolicy(p.Synonyms)
	p.Intents = normalizeIntentRules(p.Intents)
	p.ForbiddenIntentPairs = normalizeForbiddenIntentPairs(p.ForbiddenIntentPairs)
	if len(p.Intents) == 0 {
		return p, fmt.Errorf("%w: intents are required", ErrSemanticCacheIntentPolicyInvalid)
	}
	return p, nil
}

func (p SemanticCacheHitPolicy) Configured() bool {
	return len(p.Intents) > 0
}

func (p SemanticCacheHitPolicy) Materialize(category string, normalizedText string) (SemanticCacheIntentMaterial, SemanticCacheIntentDecision) {
	normalizedText = normalizeSemanticText(normalizedText)
	decision := SemanticCacheIntentDecision{
		Outcome:                 SemanticCacheOutcomeMiss,
		Reason:                  SemanticCacheReasonIntentUnavailable,
		PolicyVersion:           p.PolicyVersion,
		CanonicalizationVersion: p.CanonicalizationVersion,
	}
	if !p.Configured() {
		decision.Reason = SemanticCacheReasonIntentPolicyUnavailable
		return SemanticCacheIntentMaterial{}, decision
	}
	if normalizedText == "" || containsForbiddenSemanticCachePayload([]byte(normalizedText)) {
		return SemanticCacheIntentMaterial{}, decision
	}
	promptCategory := CanonicalSemanticCacheCategory(category)
	bestIntent := ""
	var bestRule SemanticCacheIntentRule
	bestScore := -1
	for intent, rule := range p.Intents {
		if !intentRuleCategoryAllowed(promptCategory, rule.Category) {
			continue
		}
		score, ok := p.intentRuleMatchScore(rule, normalizedText)
		if !ok {
			continue
		}
		if score > bestScore || (score == bestScore && intent < bestIntent) {
			bestIntent = intent
			bestRule = rule
			bestScore = score
		}
	}
	if bestIntent == "" {
		return SemanticCacheIntentMaterial{}, decision
	}
	material := NewSemanticCacheIntentMaterial(
		bestRule.Category,
		bestIntent,
		bestRule.RequiredSlots,
		bestRule.OptionalSlots,
		p.CanonicalizationVersion,
		p.SynonymPolicyVersion,
	)
	if material.IsZero() {
		return SemanticCacheIntentMaterial{}, decision
	}
	decision.Allowed = true
	decision.Reason = SemanticCacheReasonHit
	decision.Category = material.Category
	decision.CanonicalIntent = material.CanonicalIntent
	decision.RequiredSlotsHash = material.RequiredSlotsHash
	return material, decision
}

func (p SemanticCacheHitPolicy) Evaluate(request SemanticCacheIntentMaterial, cached SemanticCacheIntentMaterial, similarity float64, fallbackThreshold float64) SemanticCacheIntentDecision {
	request = request.Normalize()
	cached = cached.Normalize()
	threshold := p.CategoryThreshold(request.Category, fallbackThreshold)
	decision := SemanticCacheIntentDecision{
		Outcome:                 SemanticCacheOutcomeMiss,
		Reason:                  SemanticCacheReasonThresholdMiss,
		Category:                request.Category,
		CanonicalIntent:         request.CanonicalIntent,
		RequiredSlotsHash:       request.RequiredSlotsHash,
		CategoryThreshold:       threshold,
		SemanticSimilarity:      similarity,
		PolicyVersion:           p.PolicyVersion,
		CanonicalizationVersion: p.CanonicalizationVersion,
	}
	if !p.Configured() {
		decision.Reason = SemanticCacheReasonIntentPolicyUnavailable
		return decision
	}
	if request.IsZero() {
		decision.Reason = SemanticCacheReasonIntentUnavailable
		return decision
	}
	if denyRule, denied := p.firstDenyRule(request); denied {
		decision.Outcome = SemanticCacheOutcomeBypassed
		decision.Reason = firstSemanticReason(denyRule.Reason, SemanticCacheReasonCategoryDenied)
		return decision
	}
	categoryPolicy := p.categoryPolicy(request.Category)
	if !categoryPolicy.Enabled || categoryPolicy.Mode == SemanticCachePolicyModeDisabled {
		decision.Outcome = SemanticCacheOutcomeBypassed
		decision.Reason = SemanticCacheReasonCategoryDisabled
		return decision
	}
	if cached.IsZero() {
		decision.Reason = SemanticCacheReasonIntentMaterialMissing
		return decision
	}
	if p.isForbiddenIntentPair(request, cached) {
		decision.Reason = SemanticCacheReasonHardNegative
		decision.HardNegativeMatched = true
		return decision
	}
	if request.Category != cached.Category || request.CanonicalIntent != cached.CanonicalIntent {
		decision.Reason = SemanticCacheReasonIntentMismatch
		return decision
	}
	if !p.strictAllowRuleMatches(request) {
		decision.Reason = SemanticCacheReasonCategoryDenied
		return decision
	}
	if categoryPolicy.RequiresRequiredSlots && request.RequiredSlotsHash == "" {
		decision.Reason = SemanticCacheReasonSlotsUnavailable
		return decision
	}
	if request.RequiredSlotsHash != cached.RequiredSlotsHash {
		decision.Reason = SemanticCacheReasonSlotsMismatch
		return decision
	}
	if similarity < threshold {
		decision.Reason = SemanticCacheReasonThresholdMiss
		return decision
	}
	decision.Allowed = true
	if categoryPolicy.Mode == SemanticCachePolicyModeCandidateOnly {
		decision.Outcome = SemanticCacheReasonCandidateOnly
		decision.Reason = SemanticCacheReasonCandidateOnly
		return decision
	}
	decision.Outcome = SemanticCacheOutcomeHit
	decision.Reason = SemanticCacheReasonHit
	decision.ProviderBypassAllowed = true
	return decision
}

func (p SemanticCacheHitPolicy) CategoryThreshold(category string, fallback float64) float64 {
	if fallback <= 0 || fallback > 1 {
		fallback = p.DefaultThreshold
	}
	if mode := p.categoryPolicy(category); mode.CategoryThreshold > 0 && mode.CategoryThreshold <= 1 {
		return mode.CategoryThreshold
	}
	if p.DefaultThreshold > 0 && p.DefaultThreshold <= 1 {
		return p.DefaultThreshold
	}
	return fallback
}

func (p SemanticCacheHitPolicy) firstDenyRule(material SemanticCacheIntentMaterial) (SemanticCachePolicyRule, bool) {
	material = material.Normalize()
	for _, rule := range p.DenyRules {
		if rule.matches(material) {
			return rule, true
		}
	}
	switch material.Category {
	case SemanticCacheCategoryAccountAccess:
		return SemanticCachePolicyRule{Reason: SemanticCacheReasonAccountAccessDenied}, true
	case SemanticCacheCategorySupportRefund:
		return SemanticCachePolicyRule{Reason: SemanticCacheReasonSupportRefundDenied}, true
	case SemanticCacheCategoryCode, SemanticCacheCategoryTranslation, SemanticCacheCategoryReasoning, SemanticCacheCategorySensitive, SemanticCacheCategoryToolCall, SemanticCacheCategoryUnknown:
		return SemanticCachePolicyRule{Reason: SemanticCacheReasonCategoryDenied}, true
	default:
		return SemanticCachePolicyRule{}, false
	}
}

func (p SemanticCacheHitPolicy) strictAllowRuleMatches(material SemanticCacheIntentMaterial) bool {
	if len(p.StrictAllowRules) == 0 {
		return true
	}
	material = material.Normalize()
	for _, rule := range p.StrictAllowRules {
		if rule.matches(material) {
			return true
		}
	}
	return false
}

func (p SemanticCacheHitPolicy) categoryPolicy(category string) SemanticCacheCategoryMode {
	category = canonicalIntentCategory(category)
	if mode, ok := p.Categories[category]; ok {
		return mode
	}
	return SemanticCacheCategoryMode{
		Enabled:               true,
		Mode:                  SemanticCachePolicyModeStrictHit,
		CategoryThreshold:     p.DefaultThreshold,
		RequiresIntent:        true,
		RequiresRequiredSlots: true,
		RequiresHardNegative:  true,
	}
}

func (p SemanticCacheHitPolicy) intentRuleMatchScore(rule SemanticCacheIntentRule, normalizedText string) (int, bool) {
	if len(rule.MatchAll) == 0 {
		return 0, false
	}
	score := rule.Priority
	for _, term := range rule.MatchAll {
		term = strings.TrimSpace(strings.ToLower(term))
		if term == "" {
			return 0, false
		}
		variants := p.termVariants(term)
		matched := false
		for _, variant := range variants {
			if strings.Contains(normalizedText, variant) {
				matched = true
				score++
				break
			}
		}
		if !matched {
			return 0, false
		}
	}
	return score, true
}

func (p SemanticCacheHitPolicy) termVariants(term string) []string {
	seen := map[string]struct{}{}
	var variants []string
	add := func(value string) {
		value = normalizeSemanticText(value)
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		variants = append(variants, value)
	}
	add(term)
	for _, byTerm := range p.Synonyms {
		for _, synonym := range byTerm[term] {
			add(synonym)
		}
	}
	sort.Strings(variants)
	return variants
}

func (p SemanticCacheHitPolicy) isForbiddenIntentPair(first SemanticCacheIntentMaterial, second SemanticCacheIntentMaterial) bool {
	first = first.Normalize()
	second = second.Normalize()
	for _, pair := range p.ForbiddenIntentPairs {
		category := canonicalIntentCategory(pair.Category)
		if category != "" && category != first.Category && category != second.Category {
			continue
		}
		a := strings.TrimSpace(pair.First)
		b := strings.TrimSpace(pair.Second)
		if (first.CanonicalIntent == a && second.CanonicalIntent == b) ||
			(first.CanonicalIntent == b && second.CanonicalIntent == a) {
			return true
		}
	}
	return false
}

func NewSemanticCacheIntentMaterial(category string, canonicalIntent string, requiredSlots map[string]string, optionalSlots map[string]string, canonicalizationVersion string, synonymPolicyVersion string) SemanticCacheIntentMaterial {
	material := SemanticCacheIntentMaterial{
		Category:                canonicalIntentCategory(category),
		CanonicalIntent:         strings.TrimSpace(canonicalIntent),
		RequiredSlots:           normalizeSemanticStringMap(requiredSlots),
		OptionalSlots:           normalizeSemanticStringMap(optionalSlots),
		CanonicalizationVersion: strings.TrimSpace(canonicalizationVersion),
		SynonymPolicyVersion:    strings.TrimSpace(synonymPolicyVersion),
	}
	material.RequiredSlotsHash = semanticMapHash(material.RequiredSlots)
	material.OptionalSlotsHash = semanticMapHash(material.OptionalSlots)
	material.MaterialHash = semanticIntentMaterialHash(material)
	return material
}

func (m SemanticCacheIntentMaterial) Normalize() SemanticCacheIntentMaterial {
	return NewSemanticCacheIntentMaterial(
		m.Category,
		m.CanonicalIntent,
		m.RequiredSlots,
		m.OptionalSlots,
		m.CanonicalizationVersion,
		m.SynonymPolicyVersion,
	)
}

func (m SemanticCacheIntentMaterial) IsZero() bool {
	return strings.TrimSpace(m.Category) == "" ||
		strings.TrimSpace(m.CanonicalIntent) == "" ||
		strings.TrimSpace(m.CanonicalizationVersion) == ""
}

func (m SemanticCacheIntentMaterial) Clone() SemanticCacheIntentMaterial {
	return m.Normalize()
}

func (m SemanticCacheIntentMaterial) ContainsForbiddenMaterial() bool {
	m = m.Normalize()
	payload, _ := json.Marshal(m)
	return containsForbiddenSemanticCachePayload(payload)
}

func normalizeCategoryModes(modes map[string]SemanticCacheCategoryMode) map[string]SemanticCacheCategoryMode {
	normalized := map[string]SemanticCacheCategoryMode{}
	for category, mode := range modes {
		canonical := canonicalIntentCategory(category)
		if canonical == "" {
			continue
		}
		mode.Mode = strings.TrimSpace(mode.Mode)
		if mode.Mode == "" {
			if mode.Enabled {
				mode.Mode = SemanticCachePolicyModeStrictHit
			} else {
				mode.Mode = SemanticCachePolicyModeDisabled
			}
		}
		if mode.CategoryThreshold <= 0 || mode.CategoryThreshold > 1 {
			mode.CategoryThreshold = 0
		}
		normalized[canonical] = mode
	}
	return normalized
}

func normalizeSynonymPolicy(synonyms map[string]map[string][]string) map[string]map[string][]string {
	normalized := map[string]map[string][]string{}
	for language, terms := range synonyms {
		language = strings.TrimSpace(strings.ToLower(language))
		if language == "" {
			continue
		}
		normalized[language] = map[string][]string{}
		for term, values := range terms {
			term = normalizeSemanticText(term)
			if term == "" {
				continue
			}
			for _, value := range values {
				value = normalizeSemanticText(value)
				if value == "" {
					continue
				}
				normalized[language][term] = append(normalized[language][term], value)
			}
			if normalized[language][term] == nil {
				normalized[language][term] = []string{}
			} else {
				sort.Strings(normalized[language][term])
			}
		}
	}
	return normalized
}

func normalizeIntentRules(rules map[string]SemanticCacheIntentRule) map[string]SemanticCacheIntentRule {
	normalized := map[string]SemanticCacheIntentRule{}
	for intent, rule := range rules {
		intent = strings.TrimSpace(intent)
		if intent == "" {
			continue
		}
		rule.Category = canonicalIntentCategory(rule.Category)
		rule.MatchAll = normalizeSemanticStringList(rule.MatchAll)
		rule.RequiredSlots = normalizeSemanticStringMap(rule.RequiredSlots)
		rule.OptionalSlots = normalizeSemanticStringMap(rule.OptionalSlots)
		if rule.Category == "" || len(rule.MatchAll) == 0 || len(rule.RequiredSlots) == 0 {
			continue
		}
		normalized[intent] = rule
	}
	return normalized
}

func normalizeForbiddenIntentPairs(pairs []SemanticCacheIntentPair) []SemanticCacheIntentPair {
	normalized := make([]SemanticCacheIntentPair, 0, len(pairs))
	for _, pair := range pairs {
		pair.Category = canonicalIntentCategory(pair.Category)
		pair.First = strings.TrimSpace(pair.First)
		pair.Second = strings.TrimSpace(pair.Second)
		pair.Reason = strings.TrimSpace(pair.Reason)
		if pair.First == "" || pair.Second == "" {
			continue
		}
		normalized = append(normalized, pair)
	}
	return normalized
}

func normalizeSemanticCachePolicyRules(rules []SemanticCachePolicyRule) []SemanticCachePolicyRule {
	normalized := make([]SemanticCachePolicyRule, 0, len(rules))
	for _, rule := range rules {
		rule.ID = strings.TrimSpace(rule.ID)
		rule.Reason = strings.TrimSpace(rule.Reason)
		rule.Categories = normalizeSemanticCacheCategories(rule.Categories)
		rule.CanonicalIntents = normalizeSemanticStringList(rule.CanonicalIntents)
		rule.RequiredSlotKeys = normalizeSemanticPolicyRuleKeys(rule.RequiredSlotKeys)
		rule.RequiredSlotValues = normalizeSemanticStringList(rule.RequiredSlotValues)
		if rule.Reason == "" {
			continue
		}
		normalized = append(normalized, rule)
	}
	return normalized
}

func normalizeSemanticCacheStrictAllowRules(rules []SemanticCacheStrictAllowRule) []SemanticCacheStrictAllowRule {
	normalized := make([]SemanticCacheStrictAllowRule, 0, len(rules))
	for _, rule := range rules {
		rule.ID = strings.TrimSpace(rule.ID)
		rule.Reason = strings.TrimSpace(rule.Reason)
		rule.Categories = normalizeSemanticCacheCategories(rule.Categories)
		rule.CanonicalIntents = normalizeSemanticStringList(rule.CanonicalIntents)
		if rule.Reason == "" {
			continue
		}
		normalized = append(normalized, rule)
	}
	return normalized
}

func normalizeSemanticPolicyRuleKeys(values []string) []string {
	seen := map[string]struct{}{}
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		normalized = append(normalized, value)
	}
	sort.Strings(normalized)
	return normalized
}

func (r SemanticCachePolicyRule) matches(material SemanticCacheIntentMaterial) bool {
	material = material.Normalize()
	if len(r.Categories) > 0 && !semanticCategoryContains(r.Categories, material.Category) {
		return false
	}
	if len(r.CanonicalIntents) > 0 && !semanticStringContains(r.CanonicalIntents, material.CanonicalIntent) {
		return false
	}
	if len(r.RequiredSlotKeys) > 0 {
		matched := false
		for _, key := range r.RequiredSlotKeys {
			if _, ok := material.RequiredSlots[key]; ok {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	if len(r.RequiredSlotValues) > 0 {
		matched := false
		for _, value := range material.RequiredSlots {
			if semanticStringContains(r.RequiredSlotValues, value) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	return len(r.Categories) > 0 ||
		len(r.CanonicalIntents) > 0 ||
		len(r.RequiredSlotKeys) > 0 ||
		len(r.RequiredSlotValues) > 0
}

func (r SemanticCacheStrictAllowRule) matches(material SemanticCacheIntentMaterial) bool {
	material = material.Normalize()
	if len(r.Categories) > 0 && !semanticCategoryContains(r.Categories, material.Category) {
		return false
	}
	if len(r.CanonicalIntents) > 0 && !semanticStringContains(r.CanonicalIntents, material.CanonicalIntent) {
		return false
	}
	return len(r.Categories) > 0 || len(r.CanonicalIntents) > 0
}

func intentRuleCategoryAllowed(promptCategory string, intentCategory string) bool {
	promptCategory = CanonicalSemanticCacheCategory(promptCategory)
	intentCategory = canonicalIntentCategory(intentCategory)
	if promptCategory == intentCategory {
		return true
	}
	return promptCategory == SemanticCacheCategoryGeneral && intentCategory == SemanticCacheCategoryAccountAccess
}

func canonicalIntentCategory(category string) string {
	category = strings.TrimSpace(strings.ToLower(category))
	switch category {
	case SemanticCacheCategoryGeneral,
		SemanticCacheCategoryAccountAccess,
		SemanticCacheCategorySupportRefund,
		SemanticCacheCategoryCode,
		SemanticCacheCategoryTranslation,
		SemanticCacheCategoryReasoning,
		SemanticCacheCategorySensitive,
		SemanticCacheCategoryToolCall,
		SemanticCacheCategoryUnknown:
		return category
	default:
		return ""
	}
}

func normalizeSemanticStringList(values []string) []string {
	seen := map[string]struct{}{}
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		value = normalizeSemanticText(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		normalized = append(normalized, value)
	}
	sort.Strings(normalized)
	return normalized
}

func normalizeSemanticStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	normalized := map[string]string{}
	for key, value := range values {
		key = strings.TrimSpace(key)
		value = normalizeSemanticText(value)
		if key == "" || value == "" || value == "unknown" {
			continue
		}
		normalized[key] = value
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func semanticMapHash(values map[string]string) string {
	if len(values) == 0 {
		return ""
	}
	payload, _ := json.Marshal(values)
	return "sha256:" + sha256Hex(payload)
}

func semanticIntentMaterialHash(material SemanticCacheIntentMaterial) string {
	type hashMaterial struct {
		Category                string            `json:"category"`
		CanonicalIntent         string            `json:"canonicalIntent"`
		RequiredSlots           map[string]string `json:"requiredSlots"`
		OptionalSlots           map[string]string `json:"optionalSlots,omitempty"`
		CanonicalizationVersion string            `json:"canonicalizationVersion"`
		SynonymPolicyVersion    string            `json:"synonymPolicyVersion"`
	}
	payload, _ := json.Marshal(hashMaterial{
		Category:                material.Category,
		CanonicalIntent:         material.CanonicalIntent,
		RequiredSlots:           material.RequiredSlots,
		OptionalSlots:           material.OptionalSlots,
		CanonicalizationVersion: material.CanonicalizationVersion,
		SynonymPolicyVersion:    material.SynonymPolicyVersion,
	})
	return "sha256:" + sha256Hex(payload)
}

func sha256Hex(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}
