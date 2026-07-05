package cache

import (
	"encoding/json"
	"sort"
	"strings"
)

var defaultSemanticCacheShadowEvalThresholds = []float64{0.85, 0.88, 0.90, 0.92, 0.95}

type SemanticCacheShadowEvalCase struct {
	Category                   string  `json:"category"`
	ExpectedSemanticHit        bool    `json:"expectedSemanticHit"`
	HardNegative               bool    `json:"hardNegative,omitempty"`
	DenyCategory               bool    `json:"denyCategory,omitempty"`
	SemanticCacheMode          string  `json:"semanticCacheMode,omitempty"`
	SemanticCacheEnabled       bool    `json:"semanticCacheEnabled"`
	SemanticCacheWouldHit      bool    `json:"semanticCacheWouldHit"`
	SemanticCacheWouldMiss     bool    `json:"semanticCacheWouldMiss"`
	SemanticDecisionReason     string  `json:"semanticCacheDecisionReason,omitempty"`
	SemanticSimilarity         float64 `json:"semanticSimilarity,omitempty"`
	SemanticCacheThreshold     float64 `json:"semanticCacheThreshold,omitempty"`
	SemanticCachePolicyVersion string  `json:"semanticCachePolicyVersion,omitempty"`
	SemanticCanonicalIntent    string  `json:"semanticCanonicalIntent,omitempty"`
	SemanticRequiredSlotsHash  string  `json:"semanticRequiredSlotsHash,omitempty"`
	SemanticCandidateFound     bool    `json:"semanticCandidateFound"`
	SemanticReturnedFromCache  bool    `json:"semanticReturnedFromCache"`
}

type SemanticCacheShadowEvalReport struct {
	ReportVersion                       string                                   `json:"reportVersion"`
	TotalCases                          int                                      `json:"totalCases"`
	CandidateFoundCount                 int                                      `json:"candidateFoundCount"`
	WouldHitCount                       int                                      `json:"wouldHitCount"`
	WouldMissCount                      int                                      `json:"wouldMissCount"`
	ReturnedFromSemanticCacheCount      int                                      `json:"returnedFromSemanticCacheCount"`
	Category                            map[string]SemanticCacheShadowCategory   `json:"category"`
	DecisionReasonCount                 map[string]int                           `json:"decisionReasonCount"`
	ThresholdMissCount                  int                                      `json:"thresholdMissCount"`
	HardNegativeBlockCount              int                                      `json:"hardNegativeBlockCount"`
	SlotsMismatchCount                  int                                      `json:"slotsMismatchCount"`
	IntentMismatchCount                 int                                      `json:"intentMismatchCount"`
	CategoryDisabledScopeDeniedCount    int                                      `json:"categoryDisabledScopeDeniedCount"`
	FalsePositiveCandidateCount         int                                      `json:"falsePositiveCandidateCount"`
	CriticalFalsePositiveCandidateCount int                                      `json:"criticalFalsePositiveCandidateCount"`
	FalseNegativeCandidateCount         int                                      `json:"falseNegativeCandidateCount"`
	SafeToEnforceCandidateCategories    []string                                 `json:"safeToEnforceCandidateCategories"`
	ThresholdSensitivity                []SemanticCacheThresholdSensitivityPoint `json:"thresholdSensitivity"`
	Readiness                           *SemanticCacheLimitedEnforceReadiness    `json:"readiness,omitempty"`
}

type SemanticCacheShadowCategory struct {
	TotalCases                     int     `json:"totalCases"`
	CandidateFound                 int     `json:"candidateFound"`
	WouldHit                       int     `json:"wouldHit"`
	WouldMiss                      int     `json:"wouldMiss"`
	FalsePositive                  int     `json:"falsePositive"`
	FalseNegative                  int     `json:"falseNegative"`
	AverageSimilarity              float64 `json:"averageSimilarity"`
	ReturnedFromSemanticCacheCount int     `json:"returnedFromSemanticCacheCount"`
}

type SemanticCacheThresholdSensitivityPoint struct {
	Category      string  `json:"category"`
	Threshold     float64 `json:"threshold"`
	WouldHit      int     `json:"wouldHit"`
	FalsePositive int     `json:"falsePositive"`
	FalseNegative int     `json:"falseNegative"`
}

type SemanticCacheLimitedEnforceReadinessConfig struct {
	AllowedEnforceCategories []string          `json:"allowedEnforceCategories,omitempty"`
	BlockedCategories        []string          `json:"blockedCategories,omitempty"`
	RequiredMode             string            `json:"requiredMode,omitempty"`
	CanaryOnly               bool              `json:"canaryOnly"`
	RecommendedCanaryEnv     map[string]string `json:"recommendedCanaryEnv,omitempty"`
}

type SemanticCacheLimitedEnforceReadiness struct {
	ReadyForLimitedEnforce   bool                                  `json:"readyForLimitedEnforce"`
	AllowedEnforceCategories []string                              `json:"allowedEnforceCategories"`
	BlockedCategories        []string                              `json:"blockedCategories"`
	BlockingReasons          []string                              `json:"blockingReasons"`
	CanaryOnly               bool                                  `json:"canaryOnly"`
	RequiredMode             string                                `json:"requiredMode"`
	ThresholdOnlyRiskSummary SemanticCacheThresholdOnlyRiskSummary `json:"thresholdOnlyRiskSummary"`
	PolicyGuardRiskSummary   SemanticCachePolicyGuardRiskSummary   `json:"policyGuardRiskSummary"`
	RecommendedCanaryEnv     map[string]string                     `json:"recommendedCanaryEnv"`
}

type SemanticCacheThresholdOnlyRiskSummary struct {
	HasThresholdOnlyFalsePositive bool           `json:"hasThresholdOnlyFalsePositive"`
	RiskyCategories               []string       `json:"riskyCategories"`
	FalsePositiveByCategory       map[string]int `json:"falsePositiveByCategory,omitempty"`
}

type SemanticCachePolicyGuardRiskSummary struct {
	FalsePositiveCandidateCount         int `json:"falsePositiveCandidateCount"`
	CriticalFalsePositiveCandidateCount int `json:"criticalFalsePositiveCandidateCount"`
	FalseNegativeCandidateCount         int `json:"falseNegativeCandidateCount"`
	ReturnedFromSemanticCacheCount      int `json:"returnedFromSemanticCacheCount"`
}

func BuildSemanticCacheShadowEvalReport(cases []SemanticCacheShadowEvalCase, thresholds []float64) SemanticCacheShadowEvalReport {
	if len(thresholds) == 0 {
		thresholds = defaultSemanticCacheShadowEvalThresholds
	}
	thresholds = normalizeSemanticShadowEvalThresholds(thresholds)
	report := SemanticCacheShadowEvalReport{
		ReportVersion:       "semantic-cache-shadow-eval-report.v1",
		Category:            map[string]SemanticCacheShadowCategory{},
		DecisionReasonCount: map[string]int{},
	}
	similaritySums := map[string]float64{}
	similarityCounts := map[string]int{}

	for _, evalCase := range cases {
		category := CanonicalSemanticCacheCategory(evalCase.Category)
		if category == "" {
			category = SemanticCacheCategoryUnknown
		}
		reason := strings.TrimSpace(evalCase.SemanticDecisionReason)
		if reason == "" {
			reason = "unknown"
		}
		categoryReport := report.Category[category]
		categoryReport.TotalCases++
		report.TotalCases++
		report.DecisionReasonCount[reason]++

		if evalCase.SemanticCandidateFound {
			report.CandidateFoundCount++
			categoryReport.CandidateFound++
		}
		if evalCase.SemanticCacheWouldHit {
			report.WouldHitCount++
			categoryReport.WouldHit++
		}
		if evalCase.SemanticCacheWouldMiss {
			report.WouldMissCount++
			categoryReport.WouldMiss++
		}
		if evalCase.SemanticReturnedFromCache {
			report.ReturnedFromSemanticCacheCount++
			categoryReport.ReturnedFromSemanticCacheCount++
		}
		if evalCase.SemanticSimilarity > 0 {
			similaritySums[category] += evalCase.SemanticSimilarity
			similarityCounts[category]++
		}

		if reason == SemanticCacheReasonThresholdMiss {
			report.ThresholdMissCount++
		}
		if reason == SemanticCacheReasonHardNegative {
			report.HardNegativeBlockCount++
		}
		if reason == SemanticCacheReasonSlotsMismatch {
			report.SlotsMismatchCount++
		}
		if reason == SemanticCacheReasonIntentMismatch {
			report.IntentMismatchCount++
		}
		if semanticShadowEvalCategoryDisabledOrScopeDenied(reason) {
			report.CategoryDisabledScopeDeniedCount++
		}
		if !evalCase.ExpectedSemanticHit && evalCase.SemanticCacheWouldHit {
			report.FalsePositiveCandidateCount++
			categoryReport.FalsePositive++
			if evalCase.HardNegative {
				report.CriticalFalsePositiveCandidateCount++
			}
		}
		if evalCase.ExpectedSemanticHit && !evalCase.SemanticCacheWouldHit {
			report.FalseNegativeCandidateCount++
			categoryReport.FalseNegative++
		}
		report.Category[category] = categoryReport
	}

	for category, categoryReport := range report.Category {
		if count := similarityCounts[category]; count > 0 {
			categoryReport.AverageSimilarity = similaritySums[category] / float64(count)
		}
		report.Category[category] = categoryReport
	}
	report.SafeToEnforceCandidateCategories = semanticShadowEvalSafeToEnforceCategories(report.Category)
	report.ThresholdSensitivity = buildSemanticShadowEvalThresholdSensitivity(cases, thresholds)
	return report
}

func MarshalSemanticCacheShadowEvalReport(report SemanticCacheShadowEvalReport) ([]byte, error) {
	return json.MarshalIndent(report, "", "  ")
}

func DefaultSemanticCacheLimitedEnforceReadinessConfig() SemanticCacheLimitedEnforceReadinessConfig {
	return SemanticCacheLimitedEnforceReadinessConfig{
		AllowedEnforceCategories: []string{SemanticCacheCategoryGeneral},
		BlockedCategories: []string{
			SemanticCacheCategoryAccountAccess,
			SemanticCacheCategorySupportRefund,
			SemanticCacheCategoryCode,
			SemanticCacheCategoryTranslation,
			SemanticCacheCategoryUnknown,
		},
		RequiredMode: SemanticCacheModeEnforce,
		CanaryOnly:   true,
		RecommendedCanaryEnv: map[string]string{
			"SEMANTIC_CACHE_ENABLED":                 "true",
			"SEMANTIC_CACHE_MODE":                    SemanticCacheModeEnforce,
			"SEMANTIC_CACHE_ALLOWED_CATEGORIES":      SemanticCacheCategoryGeneral,
			"SEMANTIC_CACHE_ALLOWED_TENANT_IDS":      "tenant_demo",
			"SEMANTIC_CACHE_ALLOWED_APPLICATION_IDS": "app_demo",
			"SEMANTIC_CACHE_THRESHOLD_GENERAL":       "0.92",
		},
	}
}

func EvaluateSemanticCacheLimitedEnforceReadiness(report SemanticCacheShadowEvalReport, config SemanticCacheLimitedEnforceReadinessConfig) SemanticCacheLimitedEnforceReadiness {
	config = normalizeSemanticCacheLimitedEnforceReadinessConfig(config)
	result := SemanticCacheLimitedEnforceReadiness{
		AllowedEnforceCategories: []string{},
		BlockedCategories:        semanticCacheAllLimitedEnforceCategories(config),
		BlockingReasons:          []string{},
		CanaryOnly:               config.CanaryOnly,
		RequiredMode:             config.RequiredMode,
		ThresholdOnlyRiskSummary: semanticCacheThresholdOnlyRiskSummary(report.ThresholdSensitivity),
		PolicyGuardRiskSummary: SemanticCachePolicyGuardRiskSummary{
			FalsePositiveCandidateCount:         report.FalsePositiveCandidateCount,
			CriticalFalsePositiveCandidateCount: report.CriticalFalsePositiveCandidateCount,
			FalseNegativeCandidateCount:         report.FalseNegativeCandidateCount,
			ReturnedFromSemanticCacheCount:      report.ReturnedFromSemanticCacheCount,
		},
		RecommendedCanaryEnv: cloneStringMap(config.RecommendedCanaryEnv),
	}

	if report.CriticalFalsePositiveCandidateCount > 0 {
		result.BlockingReasons = append(result.BlockingReasons, "critical_false_positive_candidate_count_non_zero")
	}
	if report.FalsePositiveCandidateCount > 0 {
		result.BlockingReasons = append(result.BlockingReasons, "false_positive_candidate_count_non_zero")
	}
	if report.ReturnedFromSemanticCacheCount > 0 {
		result.BlockingReasons = append(result.BlockingReasons, "returned_from_semantic_cache_count_non_zero")
	}
	if !semanticCacheCategoryListExactly(report.SafeToEnforceCandidateCategories, config.AllowedEnforceCategories) {
		if len(report.SafeToEnforceCandidateCategories) == 0 {
			result.BlockingReasons = append(result.BlockingReasons, "safe_to_enforce_candidate_categories_empty")
		} else {
			result.BlockingReasons = append(result.BlockingReasons, "safe_to_enforce_candidate_categories_not_general_only")
		}
	}
	if general := report.Category[SemanticCacheCategoryGeneral]; general.FalsePositive > 0 {
		result.BlockingReasons = append(result.BlockingReasons, "general_category_false_positive_non_zero")
	}

	if len(result.BlockingReasons) == 0 {
		result.ReadyForLimitedEnforce = true
		result.AllowedEnforceCategories = append([]string{}, config.AllowedEnforceCategories...)
		result.BlockedCategories = append([]string{}, config.BlockedCategories...)
	}
	return result
}

func SemanticCacheEvalReportOutputContainsForbiddenMarker(payload []byte) bool {
	return containsForbiddenSemanticCachePayload(payload) ||
		strings.Contains(strings.ToLower(string(payload)), "actual secret")
}

func normalizeSemanticCacheLimitedEnforceReadinessConfig(config SemanticCacheLimitedEnforceReadinessConfig) SemanticCacheLimitedEnforceReadinessConfig {
	defaultConfig := DefaultSemanticCacheLimitedEnforceReadinessConfig()
	if len(config.AllowedEnforceCategories) == 0 {
		config.AllowedEnforceCategories = defaultConfig.AllowedEnforceCategories
	}
	if len(config.BlockedCategories) == 0 {
		config.BlockedCategories = defaultConfig.BlockedCategories
	}
	if strings.TrimSpace(config.RequiredMode) == "" {
		config.RequiredMode = defaultConfig.RequiredMode
	}
	if !config.CanaryOnly {
		config.CanaryOnly = defaultConfig.CanaryOnly
	}
	if config.RecommendedCanaryEnv == nil {
		config.RecommendedCanaryEnv = defaultConfig.RecommendedCanaryEnv
	}
	config.AllowedEnforceCategories = normalizeSemanticCacheCategoryList(config.AllowedEnforceCategories)
	config.BlockedCategories = normalizeSemanticCacheCategoryList(config.BlockedCategories)
	config.RequiredMode = strings.TrimSpace(config.RequiredMode)
	return config
}

func semanticCacheAllLimitedEnforceCategories(config SemanticCacheLimitedEnforceReadinessConfig) []string {
	categories := make([]string, 0, len(config.AllowedEnforceCategories)+len(config.BlockedCategories))
	categories = append(categories, config.AllowedEnforceCategories...)
	categories = append(categories, config.BlockedCategories...)
	return normalizeSemanticCacheCategoryList(categories)
}

func semanticCacheThresholdOnlyRiskSummary(points []SemanticCacheThresholdSensitivityPoint) SemanticCacheThresholdOnlyRiskSummary {
	falsePositiveByCategory := map[string]int{}
	for _, point := range points {
		if point.FalsePositive <= 0 {
			continue
		}
		category := CanonicalSemanticCacheCategory(point.Category)
		if category == "" {
			category = SemanticCacheCategoryUnknown
		}
		if point.FalsePositive > falsePositiveByCategory[category] {
			falsePositiveByCategory[category] = point.FalsePositive
		}
	}
	riskyCategories := make([]string, 0, len(falsePositiveByCategory))
	for category := range falsePositiveByCategory {
		riskyCategories = append(riskyCategories, category)
	}
	riskyCategories = normalizeSemanticCacheCategoryList(riskyCategories)
	return SemanticCacheThresholdOnlyRiskSummary{
		HasThresholdOnlyFalsePositive: len(riskyCategories) > 0,
		RiskyCategories:               riskyCategories,
		FalsePositiveByCategory:       falsePositiveByCategory,
	}
}

func semanticCacheCategoryListExactly(actual []string, expected []string) bool {
	actual = normalizeSemanticCacheCategoryList(actual)
	expected = normalizeSemanticCacheCategoryList(expected)
	if len(actual) != len(expected) {
		return false
	}
	for i := range actual {
		if actual[i] != expected[i] {
			return false
		}
	}
	return true
}

func normalizeSemanticCacheCategoryList(categories []string) []string {
	seen := map[string]struct{}{}
	normalized := make([]string, 0, len(categories))
	for _, category := range categories {
		canonical := CanonicalSemanticCacheCategory(category)
		if canonical == "" {
			canonical = SemanticCacheCategoryUnknown
		}
		if _, ok := seen[canonical]; ok {
			continue
		}
		seen[canonical] = struct{}{}
		normalized = append(normalized, canonical)
	}
	sort.SliceStable(normalized, func(i int, j int) bool {
		return semanticCacheCategoryReadinessRank(normalized[i]) < semanticCacheCategoryReadinessRank(normalized[j])
	})
	return normalized
}

func semanticCacheCategoryReadinessRank(category string) int {
	switch category {
	case SemanticCacheCategoryGeneral:
		return 0
	case SemanticCacheCategoryAccountAccess:
		return 1
	case SemanticCacheCategorySupportRefund:
		return 2
	case SemanticCacheCategoryCode:
		return 3
	case SemanticCacheCategoryTranslation:
		return 4
	case SemanticCacheCategoryUnknown:
		return 5
	default:
		return 100
	}
}

func cloneStringMap(values map[string]string) map[string]string {
	if values == nil {
		return nil
	}
	cloned := make(map[string]string, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func normalizeSemanticShadowEvalThresholds(thresholds []float64) []float64 {
	seen := map[float64]struct{}{}
	normalized := make([]float64, 0, len(thresholds))
	for _, threshold := range thresholds {
		if threshold <= 0 || threshold > 1 {
			continue
		}
		if _, ok := seen[threshold]; ok {
			continue
		}
		seen[threshold] = struct{}{}
		normalized = append(normalized, threshold)
	}
	sort.Float64s(normalized)
	return normalized
}

func semanticShadowEvalCategoryDisabledOrScopeDenied(reason string) bool {
	switch strings.TrimSpace(reason) {
	case SemanticCacheReasonCategoryDisabled,
		SemanticCacheReasonScopeDenied,
		SemanticCacheReasonTenantDenied,
		SemanticCacheReasonApplicationDenied,
		"semantic_category_disabled":
		return true
	default:
		return false
	}
}

func semanticShadowEvalSafeToEnforceCategories(categories map[string]SemanticCacheShadowCategory) []string {
	var safe []string
	if general, ok := categories[SemanticCacheCategoryGeneral]; ok && general.WouldHit > 0 && general.FalsePositive == 0 {
		safe = append(safe, SemanticCacheCategoryGeneral)
	}
	return safe
}

func buildSemanticShadowEvalThresholdSensitivity(cases []SemanticCacheShadowEvalCase, thresholds []float64) []SemanticCacheThresholdSensitivityPoint {
	categorySet := map[string]struct{}{}
	for _, evalCase := range cases {
		category := CanonicalSemanticCacheCategory(evalCase.Category)
		if category == "" {
			category = SemanticCacheCategoryUnknown
		}
		categorySet[category] = struct{}{}
	}
	categories := make([]string, 0, len(categorySet))
	for category := range categorySet {
		categories = append(categories, category)
	}
	sort.Strings(categories)

	points := make([]SemanticCacheThresholdSensitivityPoint, 0, len(categories)*len(thresholds))
	for _, category := range categories {
		for _, threshold := range thresholds {
			point := SemanticCacheThresholdSensitivityPoint{
				Category:  category,
				Threshold: threshold,
			}
			for _, evalCase := range cases {
				caseCategory := CanonicalSemanticCacheCategory(evalCase.Category)
				if caseCategory == "" {
					caseCategory = SemanticCacheCategoryUnknown
				}
				if caseCategory != category {
					continue
				}
				wouldHit := evalCase.SemanticCandidateFound &&
					evalCase.SemanticSimilarity >= threshold &&
					!evalCase.DenyCategory
				if wouldHit {
					point.WouldHit++
				}
				if !evalCase.ExpectedSemanticHit && wouldHit {
					point.FalsePositive++
				}
				if evalCase.ExpectedSemanticHit && !wouldHit {
					point.FalseNegative++
				}
			}
			points = append(points, point)
		}
	}
	return points
}
