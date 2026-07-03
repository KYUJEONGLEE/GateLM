package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	cache "gatelm/apps/gateway-core/internal/domain/cache"
)

const (
	defaultDatasetPath = "apps/gateway-core/internal/domain/cache/testdata/semantic_cache_intent_eval_cases.json"
	defaultPolicyPath  = "apps/gateway-core/internal/domain/cache/testdata/semantic_cache_policy_ko_v1.json"
)

type evalDataset struct {
	DatasetID string     `json:"datasetId"`
	Cases     []evalCase `json:"cases"`
}

type evalCase struct {
	CaseID                string            `json:"caseId"`
	PairType              string            `json:"pairType"`
	Category              string            `json:"category"`
	CanonicalIntent       string            `json:"canonicalIntent"`
	First                 string            `json:"first"`
	Second                string            `json:"second"`
	FirstCanonicalIntent  string            `json:"firstCanonicalIntent"`
	SecondCanonicalIntent string            `json:"secondCanonicalIntent"`
	RequiredSlots         map[string]string `json:"requiredSlots"`
	OptionalSlots         map[string]string `json:"optionalSlots"`
	ExpectedSemanticHit   *bool             `json:"expectedSemanticHit"`
	SameAnswerReusable    bool              `json:"sameAnswerReusable"`
	HardNegative          bool              `json:"hardNegative"`
	DenyCategory          bool              `json:"denyCategory"`
	ExpectedDecision      string            `json:"expectedDecision"`
	Reason                string            `json:"reason"`
}

func main() {
	datasetPath := flag.String("dataset", defaultDatasetPath, "semantic cache intent eval dataset path")
	policyPath := flag.String("policy", defaultPolicyPath, "semantic cache hit policy path")
	thresholds := flag.String("thresholds", "0.85,0.88,0.90,0.92,0.95", "comma separated threshold buckets")
	gate := flag.Bool("gate", false, "exit non-zero when limited enforce readiness gate fails")
	flag.Parse()

	policy, err := cache.LoadSemanticCacheHitPolicyFile(*policyPath)
	if err != nil {
		exitWithError(err)
	}
	dataset, err := loadDataset(*datasetPath)
	if err != nil {
		exitWithError(err)
	}
	reportCases := make([]cache.SemanticCacheShadowEvalCase, 0, len(dataset.Cases))
	for _, tc := range dataset.Cases {
		reportCases = append(reportCases, shadowEvalCase(policy, tc))
	}
	report := cache.BuildSemanticCacheShadowEvalReport(reportCases, parseThresholds(*thresholds))
	readiness := cache.EvaluateSemanticCacheLimitedEnforceReadiness(
		report,
		cache.DefaultSemanticCacheLimitedEnforceReadinessConfig(),
	)
	report.Readiness = &readiness
	payload, err := cache.MarshalSemanticCacheShadowEvalReport(report)
	if err != nil {
		exitWithError(err)
	}
	if cache.SemanticCacheEvalReportOutputContainsForbiddenMarker(payload) {
		exitWithError(fmt.Errorf("semantic cache shadow eval output contains forbidden marker"))
	}
	fmt.Println(string(payload))
	if *gate && !readiness.ReadyForLimitedEnforce {
		exitWithError(fmt.Errorf("semantic cache limited enforce gate failed: %s", strings.Join(readiness.BlockingReasons, ",")))
	}
}

func loadDataset(path string) (evalDataset, error) {
	payload, err := os.ReadFile(strings.TrimSpace(path))
	if err != nil {
		return evalDataset{}, err
	}
	var dataset evalDataset
	if err := json.Unmarshal(payload, &dataset); err != nil {
		return evalDataset{}, err
	}
	return dataset, nil
}

func shadowEvalCase(policy cache.SemanticCacheHitPolicy, tc evalCase) cache.SemanticCacheShadowEvalCase {
	expectedHit := expectedSemanticHit(tc)
	category := cache.CanonicalSemanticCacheCategory(tc.Category)
	if category == "" {
		category = cache.SemanticCacheCategoryUnknown
	}
	reportCase := cache.SemanticCacheShadowEvalCase{
		Category:                   category,
		ExpectedSemanticHit:        expectedHit,
		HardNegative:               tc.HardNegative,
		DenyCategory:               tc.DenyCategory,
		SemanticCacheMode:          cache.SemanticCacheModeShadow,
		SemanticCacheEnabled:       true,
		SemanticCachePolicyVersion: policy.PolicyVersion,
	}
	if tc.DenyCategory || strings.TrimSpace(tc.ExpectedDecision) == "bypass" {
		material := cache.NewSemanticCacheIntentMaterial(
			category,
			tc.CanonicalIntent,
			tc.RequiredSlots,
			tc.OptionalSlots,
			policy.CanonicalizationVersion,
			policy.SynonymPolicyVersion,
		)
		decision := policy.Evaluate(material, material, 0.99, policy.DefaultThreshold)
		reportCase.SemanticCacheWouldMiss = true
		reportCase.SemanticDecisionReason = decision.Reason
		reportCase.SemanticCacheThreshold = decision.CategoryThreshold
		reportCase.SemanticCanonicalIntent = decision.CanonicalIntent
		reportCase.SemanticRequiredSlotsHash = decision.RequiredSlotsHash
		return reportCase
	}

	first, firstDecision := policy.Materialize(category, tc.First)
	second, secondDecision := policy.Materialize(category, tc.Second)
	if first.IsZero() || second.IsZero() || !firstDecision.Allowed || !secondDecision.Allowed {
		reportCase.SemanticCacheWouldMiss = true
		reportCase.SemanticDecisionReason = cache.SemanticCacheReasonIntentUnavailable
		return reportCase
	}
	decision := policy.Evaluate(second, first, 0.99, policy.DefaultThreshold)
	reportCase.SemanticCandidateFound = true
	reportCase.SemanticSimilarity = 0.99
	reportCase.SemanticCacheThreshold = decision.CategoryThreshold
	reportCase.SemanticCanonicalIntent = decision.CanonicalIntent
	reportCase.SemanticRequiredSlotsHash = decision.RequiredSlotsHash
	reportCase.SemanticDecisionReason = decision.Reason
	if decision.ProviderBypassAllowed {
		reportCase.SemanticCacheWouldHit = true
	} else {
		reportCase.SemanticCacheWouldMiss = true
	}
	return reportCase
}

func expectedSemanticHit(tc evalCase) bool {
	if tc.ExpectedSemanticHit != nil {
		return *tc.ExpectedSemanticHit
	}
	switch strings.TrimSpace(tc.ExpectedDecision) {
	case "hit_candidate", "strict_hit_candidate":
		return true
	default:
		return false
	}
}

func parseThresholds(raw string) []float64 {
	parts := strings.Split(raw, ",")
	thresholds := make([]float64, 0, len(parts))
	for _, part := range parts {
		var threshold float64
		if _, err := fmt.Sscanf(strings.TrimSpace(part), "%f", &threshold); err == nil && threshold > 0 && threshold <= 1 {
			thresholds = append(thresholds, threshold)
		}
	}
	return thresholds
}

func exitWithError(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
