package main

import (
	"path/filepath"
	"testing"

	cache "gatelm/apps/gateway-core/internal/domain/cache"
)

func TestShadowEvalCommandBuildsReadinessReportFromDefaultDataset(t *testing.T) {
	policy, err := cache.LoadSemanticCacheHitPolicyFile(repoRootPathForTest(defaultPolicyPath))
	if err != nil {
		t.Fatalf("policy load 실패: %v", err)
	}
	dataset, err := loadDataset(repoRootPathForTest(defaultDatasetPath))
	if err != nil {
		t.Fatalf("dataset load 실패: %v", err)
	}
	if len(dataset.Cases) < 90 {
		t.Fatalf("shadow rollout eval dataset은 91 cases 기준이어야 함: got=%d", len(dataset.Cases))
	}

	reportCases := make([]cache.SemanticCacheShadowEvalCase, 0, len(dataset.Cases))
	for _, tc := range dataset.Cases {
		reportCases = append(reportCases, shadowEvalCase(policy, tc))
	}
	report := cache.BuildSemanticCacheShadowEvalReport(reportCases, parseThresholds("0.85,0.88,0.90,0.92,0.95"))
	readiness := cache.EvaluateSemanticCacheLimitedEnforceReadiness(
		report,
		cache.DefaultSemanticCacheLimitedEnforceReadinessConfig(),
	)
	report.Readiness = &readiness

	payload, err := cache.MarshalSemanticCacheShadowEvalReport(report)
	if err != nil {
		t.Fatalf("readiness report marshal 실패: %v", err)
	}
	if cache.SemanticCacheEvalReportOutputContainsForbiddenMarker(payload) {
		t.Fatalf("shadow eval command output에는 forbidden marker가 없어야 함: %s", payload)
	}
	if !readiness.ReadyForLimitedEnforce {
		t.Fatalf("default dataset은 general-only limited enforce gate 후보여야 함: %+v", readiness)
	}
}

func repoRootPathForTest(path string) string {
	return filepath.Join("..", "..", "..", "..", filepath.FromSlash(path))
}
