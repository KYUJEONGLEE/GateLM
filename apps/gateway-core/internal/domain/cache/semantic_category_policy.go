package cache

import "strings"

const (
	SemanticCacheCategoryGeneral        = "general"
	SemanticCacheCategoryAccountAccess  = "account_access"
	SemanticCacheCategorySupportRefund  = "support_refund"
	SemanticCacheCategoryCode           = "code"
	SemanticCacheCategoryTranslation    = "translation"
	SemanticCacheCategorySummarization  = "summarization"
	SemanticCacheCategoryExtractionJSON = "extraction_json"
	SemanticCacheCategoryReasoning      = "reasoning"
	SemanticCacheCategorySensitive      = "sensitive"
	SemanticCacheCategoryToolCall       = "tool_call"
	SemanticCacheCategoryUnknown        = "unknown"
)

type SemanticCacheCategoryPolicy struct {
	AllowCategories []string
	DenyCategories  []string
}

func NewSemanticCacheCategoryPolicy(allowCategories []string, denyCategories []string) SemanticCacheCategoryPolicy {
	return SemanticCacheCategoryPolicy{
		AllowCategories: normalizeSemanticCacheCategories(allowCategories),
		DenyCategories:  normalizeSemanticCacheCategories(denyCategories),
	}
}

func (p SemanticCacheCategoryPolicy) Allows(category string) bool {
	category = CanonicalSemanticCacheCategory(category)
	if category == SemanticCacheCategoryUnknown {
		return false
	}
	if semanticCategoryContains(p.DenyCategories, category) {
		return false
	}
	return semanticCategoryContains(p.AllowCategories, category)
}

func CanonicalSemanticCacheCategory(category string) string {
	switch strings.TrimSpace(strings.ToLower(category)) {
	case SemanticCacheCategoryGeneral:
		return SemanticCacheCategoryGeneral
	case SemanticCacheCategoryAccountAccess:
		return SemanticCacheCategoryAccountAccess
	case SemanticCacheCategorySupportRefund:
		return SemanticCacheCategorySupportRefund
	case SemanticCacheCategoryCode:
		return SemanticCacheCategoryCode
	case SemanticCacheCategoryTranslation:
		return SemanticCacheCategoryTranslation
	case SemanticCacheCategorySummarization:
		return SemanticCacheCategorySummarization
	case SemanticCacheCategoryExtractionJSON:
		return SemanticCacheCategoryExtractionJSON
	case SemanticCacheCategoryReasoning:
		return SemanticCacheCategoryReasoning
	case SemanticCacheCategorySensitive:
		return SemanticCacheCategorySensitive
	case SemanticCacheCategoryToolCall:
		return SemanticCacheCategoryToolCall
	case SemanticCacheCategoryUnknown:
		return SemanticCacheCategoryUnknown
	default:
		return SemanticCacheCategoryUnknown
	}
}

func normalizeSemanticCacheCategories(categories []string) []string {
	seen := map[string]struct{}{}
	normalized := make([]string, 0, len(categories))
	for _, category := range categories {
		canonical := CanonicalSemanticCacheCategory(category)
		if _, ok := seen[canonical]; ok {
			continue
		}
		seen[canonical] = struct{}{}
		normalized = append(normalized, canonical)
	}
	return normalized
}

func semanticCategoryContains(categories []string, category string) bool {
	for _, candidate := range categories {
		if candidate == category {
			return true
		}
	}
	return false
}
