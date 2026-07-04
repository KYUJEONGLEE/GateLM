package cache

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestSemanticCacheShadowEvalReportCountsFalsePositiveNegativeAndReasons(t *testing.T) {
	cases := []SemanticCacheShadowEvalCase{
		{
			Category:               SemanticCacheCategoryGeneral,
			ExpectedSemanticHit:    true,
			SemanticCacheEnabled:   true,
			SemanticCacheWouldHit:  true,
			SemanticCandidateFound: true,
			SemanticDecisionReason: SemanticCacheReasonHit,
			SemanticSimilarity:     0.94,
		},
		{
			Category:               SemanticCacheCategorySupportRefund,
			ExpectedSemanticHit:    false,
			HardNegative:           true,
			SemanticCacheEnabled:   true,
			SemanticCacheWouldHit:  true,
			SemanticCandidateFound: true,
			SemanticDecisionReason: SemanticCacheReasonHit,
			SemanticSimilarity:     0.96,
		},
		{
			Category:                   SemanticCacheCategoryGeneral,
			ExpectedSemanticHit:        true,
			SemanticCacheEnabled:       true,
			SemanticCacheWouldMiss:     true,
			SemanticCandidateFound:     true,
			SemanticDecisionReason:     SemanticCacheReasonThresholdMiss,
			SemanticSimilarity:         0.84,
			SemanticCacheThreshold:     0.92,
			SemanticCachePolicyVersion: "v1",
		},
		{
			Category:               SemanticCacheCategoryTranslation,
			ExpectedSemanticHit:    false,
			DenyCategory:           true,
			SemanticCacheEnabled:   true,
			SemanticCacheWouldMiss: true,
			SemanticDecisionReason: SemanticCacheReasonCategoryDisabled,
		},
		{
			Category:               SemanticCacheCategorySupportRefund,
			ExpectedSemanticHit:    false,
			HardNegative:           true,
			SemanticCacheEnabled:   true,
			SemanticCacheWouldMiss: true,
			SemanticCandidateFound: true,
			SemanticDecisionReason: SemanticCacheReasonHardNegative,
			SemanticSimilarity:     0.99,
		},
		{
			Category:               SemanticCacheCategorySupportRefund,
			ExpectedSemanticHit:    false,
			SemanticCacheEnabled:   true,
			SemanticCacheWouldMiss: true,
			SemanticCandidateFound: true,
			SemanticDecisionReason: SemanticCacheReasonSlotsMismatch,
			SemanticSimilarity:     0.93,
		},
		{
			Category:               SemanticCacheCategoryAccountAccess,
			ExpectedSemanticHit:    false,
			SemanticCacheEnabled:   true,
			SemanticCacheWouldMiss: true,
			SemanticCandidateFound: true,
			SemanticDecisionReason: SemanticCacheReasonIntentMismatch,
			SemanticSimilarity:     0.91,
		},
	}

	report := BuildSemanticCacheShadowEvalReport(cases, []float64{0.85, 0.92})

	if report.TotalCases != len(cases) {
		t.Fatalf("totalCases 불일치: %+v", report)
	}
	if report.CandidateFoundCount != 6 || report.WouldHitCount != 2 || report.WouldMissCount != 5 {
		t.Fatalf("wouldHit/wouldMiss 집계 불일치: %+v", report)
	}
	if report.FalsePositiveCandidateCount != 1 || report.CriticalFalsePositiveCandidateCount != 1 {
		t.Fatalf("false positive 집계 불일치: %+v", report)
	}
	if report.FalseNegativeCandidateCount != 1 {
		t.Fatalf("false negative 집계 불일치: %+v", report)
	}
	if report.ThresholdMissCount != 1 ||
		report.HardNegativeBlockCount != 1 ||
		report.SlotsMismatchCount != 1 ||
		report.IntentMismatchCount != 1 ||
		report.CategoryDisabledScopeDeniedCount != 1 {
		t.Fatalf("decision reason 집계 불일치: %+v", report)
	}
	if report.Category[SemanticCacheCategoryGeneral].WouldHit != 1 ||
		report.Category[SemanticCacheCategoryGeneral].WouldMiss != 1 ||
		report.Category[SemanticCacheCategorySupportRefund].FalsePositive != 1 {
		t.Fatalf("category별 집계 불일치: %+v", report.Category)
	}
	if report.DecisionReasonCount[SemanticCacheReasonHit] != 2 ||
		report.DecisionReasonCount[SemanticCacheReasonThresholdMiss] != 1 {
		t.Fatalf("reason별 count 불일치: %+v", report.DecisionReasonCount)
	}
}

func TestSemanticCacheShadowEvalReportBuildsThresholdSensitivity(t *testing.T) {
	cases := []SemanticCacheShadowEvalCase{
		{
			Category:               SemanticCacheCategoryGeneral,
			ExpectedSemanticHit:    true,
			SemanticCandidateFound: true,
			SemanticSimilarity:     0.91,
		},
		{
			Category:               SemanticCacheCategoryGeneral,
			ExpectedSemanticHit:    false,
			SemanticCandidateFound: true,
			SemanticSimilarity:     0.89,
		},
		{
			Category:               SemanticCacheCategoryTranslation,
			ExpectedSemanticHit:    false,
			DenyCategory:           true,
			SemanticCandidateFound: true,
			SemanticSimilarity:     0.99,
		},
	}

	report := BuildSemanticCacheShadowEvalReport(cases, []float64{0.85, 0.90, 0.95})
	points := map[string]SemanticCacheThresholdSensitivityPoint{}
	for _, point := range report.ThresholdSensitivity {
		points[point.Category+"/"+formatSemanticShadowEvalThreshold(point.Threshold)] = point
	}

	if point := points["general/0.85"]; point.WouldHit != 2 || point.FalsePositive != 1 || point.FalseNegative != 0 {
		t.Fatalf("general 0.85 threshold sensitivity 불일치: %+v", point)
	}
	if point := points["general/0.90"]; point.WouldHit != 1 || point.FalsePositive != 0 || point.FalseNegative != 0 {
		t.Fatalf("general 0.90 threshold sensitivity 불일치: %+v", point)
	}
	if point := points["general/0.95"]; point.WouldHit != 0 || point.FalsePositive != 0 || point.FalseNegative != 1 {
		t.Fatalf("general 0.95 threshold sensitivity 불일치: %+v", point)
	}
	if point := points["translation/0.85"]; point.WouldHit != 0 || point.FalsePositive != 0 {
		t.Fatalf("denyCategory는 threshold sensitivity에서 hit 후보가 아니어야 함: %+v", point)
	}
}

func TestSemanticCacheShadowEvalReportOutputDoesNotContainRawPromptOrSecrets(t *testing.T) {
	report := BuildSemanticCacheShadowEvalReport([]SemanticCacheShadowEvalCase{
		{
			Category:                  SemanticCacheCategoryGeneral,
			ExpectedSemanticHit:       true,
			SemanticCacheEnabled:      true,
			SemanticCacheMode:         SemanticCacheModeShadow,
			SemanticCacheWouldHit:     true,
			SemanticDecisionReason:    SemanticCacheReasonHit,
			SemanticSimilarity:        0.93,
			SemanticCanonicalIntent:   "usage.monthly_usage_check",
			SemanticRequiredSlotsHash: "sha256:test_slots_hash",
			SemanticCandidateFound:    true,
		},
	}, nil)

	payload, err := MarshalSemanticCacheShadowEvalReport(report)
	if err != nil {
		t.Fatalf("shadow eval report marshal 실패: %v", err)
	}
	for _, forbidden := range []string{
		"비밀번호 재설정 방법 알려줘",
		"raw prompt",
		"raw response",
		"api_key=",
		"app_token=",
		"provider_key=",
		"Authorization:",
		"provider raw error",
		"actual secret",
	} {
		if strings.Contains(string(payload), forbidden) {
			t.Fatalf("shadow eval report output에 forbidden marker가 남으면 안 됨: marker=%q payload=%s", forbidden, payload)
		}
	}
}

func TestSemanticCacheLimitedEnforceReadinessReadyForGeneralOnlyCanary(t *testing.T) {
	report := semanticCacheReadyShadowReportForTest()
	report.ThresholdSensitivity = []SemanticCacheThresholdSensitivityPoint{
		{
			Category:      SemanticCacheCategoryAccountAccess,
			Threshold:     0.50,
			WouldHit:      4,
			FalsePositive: 2,
			FalseNegative: 0,
		},
		{
			Category:      SemanticCacheCategorySupportRefund,
			Threshold:     0.70,
			WouldHit:      3,
			FalsePositive: 1,
			FalseNegative: 0,
		},
	}

	readiness := EvaluateSemanticCacheLimitedEnforceReadiness(report, DefaultSemanticCacheLimitedEnforceReadinessConfig())

	if !readiness.ReadyForLimitedEnforce {
		t.Fatalf("general-only 조건을 만족하면 limited enforce readiness는 true여야 함: %+v", readiness)
	}
	if !semanticCacheCategoryListExactly(readiness.AllowedEnforceCategories, []string{SemanticCacheCategoryGeneral}) {
		t.Fatalf("allowedEnforceCategories는 general만 허용해야 함: %+v", readiness.AllowedEnforceCategories)
	}
	for _, blocked := range []string{
		SemanticCacheCategoryAccountAccess,
		SemanticCacheCategorySupportRefund,
		SemanticCacheCategoryCode,
		SemanticCacheCategoryTranslation,
		SemanticCacheCategoryUnknown,
	} {
		if !containsString(readiness.BlockedCategories, blocked) {
			t.Fatalf("false positive가 없어도 이번 gate에서는 %s를 enforce 후보에서 제외해야 함: %+v", blocked, readiness.BlockedCategories)
		}
	}
	if !readiness.ThresholdOnlyRiskSummary.HasThresholdOnlyFalsePositive {
		t.Fatalf("threshold-only false positive 위험은 별도 summary에 남아야 함: %+v", readiness.ThresholdOnlyRiskSummary)
	}
	if !containsString(readiness.ThresholdOnlyRiskSummary.RiskyCategories, SemanticCacheCategoryAccountAccess) ||
		!containsString(readiness.ThresholdOnlyRiskSummary.RiskyCategories, SemanticCacheCategorySupportRefund) {
		t.Fatalf("threshold-only risky category 집계가 필요함: %+v", readiness.ThresholdOnlyRiskSummary)
	}
	if readiness.PolicyGuardRiskSummary.FalsePositiveCandidateCount != 0 ||
		readiness.PolicyGuardRiskSummary.CriticalFalsePositiveCandidateCount != 0 ||
		readiness.PolicyGuardRiskSummary.ReturnedFromSemanticCacheCount != 0 {
		t.Fatalf("policy guard 기준 false positive/returned count는 0이어야 함: %+v", readiness.PolicyGuardRiskSummary)
	}
	if readiness.RecommendedCanaryEnv["SEMANTIC_CACHE_THRESHOLD_GENERAL"] != "0.92" {
		t.Fatalf("canary env 예시에 general threshold 추천값이 있어야 함: %+v", readiness.RecommendedCanaryEnv)
	}
}

func TestSemanticCacheLimitedEnforceReadinessBlocksUnsafeReports(t *testing.T) {
	tests := []struct {
		name       string
		mutate     func(*SemanticCacheShadowEvalReport)
		wantReason string
	}{
		{
			name: "critical false positive",
			mutate: func(report *SemanticCacheShadowEvalReport) {
				report.CriticalFalsePositiveCandidateCount = 1
			},
			wantReason: "critical_false_positive_candidate_count_non_zero",
		},
		{
			name: "false positive",
			mutate: func(report *SemanticCacheShadowEvalReport) {
				report.FalsePositiveCandidateCount = 1
			},
			wantReason: "false_positive_candidate_count_non_zero",
		},
		{
			name: "returned from semantic cache",
			mutate: func(report *SemanticCacheShadowEvalReport) {
				report.ReturnedFromSemanticCacheCount = 1
			},
			wantReason: "returned_from_semantic_cache_count_non_zero",
		},
		{
			name: "empty safe categories",
			mutate: func(report *SemanticCacheShadowEvalReport) {
				report.SafeToEnforceCandidateCategories = nil
			},
			wantReason: "safe_to_enforce_candidate_categories_empty",
		},
		{
			name: "extra safe category",
			mutate: func(report *SemanticCacheShadowEvalReport) {
				report.SafeToEnforceCandidateCategories = []string{SemanticCacheCategoryGeneral, SemanticCacheCategoryAccountAccess}
			},
			wantReason: "safe_to_enforce_candidate_categories_not_general_only",
		},
		{
			name: "general false positive",
			mutate: func(report *SemanticCacheShadowEvalReport) {
				general := report.Category[SemanticCacheCategoryGeneral]
				general.FalsePositive = 1
				report.Category[SemanticCacheCategoryGeneral] = general
			},
			wantReason: "general_category_false_positive_non_zero",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			report := semanticCacheReadyShadowReportForTest()
			tt.mutate(&report)

			readiness := EvaluateSemanticCacheLimitedEnforceReadiness(report, DefaultSemanticCacheLimitedEnforceReadinessConfig())

			if readiness.ReadyForLimitedEnforce {
				t.Fatalf("unsafe report는 limited enforce ready가 아니어야 함: %+v", readiness)
			}
			if !containsString(readiness.BlockingReasons, tt.wantReason) {
				t.Fatalf("blocking reason 누락: want=%s got=%+v", tt.wantReason, readiness.BlockingReasons)
			}
			if !containsString(readiness.BlockedCategories, SemanticCacheCategoryGeneral) {
				t.Fatalf("readiness 실패 시 general도 blockedCategories에 포함되어야 함: %+v", readiness.BlockedCategories)
			}
		})
	}
}

func TestSemanticCacheLimitedEnforceReadinessOutputDoesNotDuplicateTopLevelFieldsOrLeakSecrets(t *testing.T) {
	report := semanticCacheReadyShadowReportForTest()
	readiness := EvaluateSemanticCacheLimitedEnforceReadiness(report, DefaultSemanticCacheLimitedEnforceReadinessConfig())
	report.Readiness = &readiness

	payload, err := MarshalSemanticCacheShadowEvalReport(report)
	if err != nil {
		t.Fatalf("readiness 포함 report marshal 실패: %v", err)
	}
	if SemanticCacheEvalReportOutputContainsForbiddenMarker(payload) {
		t.Fatalf("readiness report output에는 forbidden marker가 없어야 함: %s", payload)
	}
	var topLevel map[string]any
	if err := json.Unmarshal(payload, &topLevel); err != nil {
		t.Fatalf("readiness report json unmarshal 실패: %v", err)
	}
	for _, duplicate := range []string{"falsePositive", "criticalFalsePositive", "returnedFromSemanticCache"} {
		if _, ok := topLevel[duplicate]; ok {
			t.Fatalf("기존 aggregate field와 중복되는 top-level alias를 만들면 안 됨: %s", duplicate)
		}
	}
	for _, forbiddenPayload := range [][]byte{
		[]byte("Authorization: Bearer test"),
		[]byte("api_key=test"),
		[]byte("app_token=test"),
		[]byte("provider_key=test"),
		[]byte("raw prompt"),
		[]byte("raw response"),
		[]byte("provider raw error"),
		[]byte("actual secret"),
	} {
		if !SemanticCacheEvalReportOutputContainsForbiddenMarker(forbiddenPayload) {
			t.Fatalf("forbidden marker를 감지해야 함: %s", forbiddenPayload)
		}
	}
}

func semanticCacheReadyShadowReportForTest() SemanticCacheShadowEvalReport {
	return SemanticCacheShadowEvalReport{
		ReportVersion:                  "semantic-cache-shadow-eval-report.v1",
		TotalCases:                     3,
		CandidateFoundCount:            2,
		WouldHitCount:                  2,
		WouldMissCount:                 1,
		ReturnedFromSemanticCacheCount: 0,
		Category: map[string]SemanticCacheShadowCategory{
			SemanticCacheCategoryGeneral: {
				TotalCases:     2,
				CandidateFound: 2,
				WouldHit:       2,
				FalsePositive:  0,
				FalseNegative:  0,
			},
			SemanticCacheCategoryAccountAccess: {
				TotalCases:     1,
				CandidateFound: 1,
				WouldMiss:      1,
				FalsePositive:  0,
				FalseNegative:  0,
			},
		},
		DecisionReasonCount:                 map[string]int{SemanticCacheReasonHit: 2},
		FalsePositiveCandidateCount:         0,
		CriticalFalsePositiveCandidateCount: 0,
		FalseNegativeCandidateCount:         0,
		SafeToEnforceCandidateCategories:    []string{SemanticCacheCategoryGeneral},
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func formatSemanticShadowEvalThreshold(threshold float64) string {
	return fmt.Sprintf("%.2f", threshold)
}
