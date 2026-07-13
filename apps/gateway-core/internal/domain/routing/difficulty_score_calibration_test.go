package routing

import (
	"bufio"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
)

type difficultyCalibrationRecord struct {
	SampleID           string `json:"sampleId"`
	RedactedPrompt     string `json:"redactedPrompt"`
	ExpectedCategory   string `json:"expectedCategory"`
	ExpectedDifficulty string `json:"expectedDifficulty"`
}

type difficultyCalibrationSample struct {
	record           difficultyCalibrationRecord
	familyKey        string
	oracleFeatures   DifficultyFeatures
	endToEndFeatures DifficultyFeatures
	legacyOracle     string
	legacyEndToEnd   string
}

type difficultyCalibrationMetrics struct {
	total           int
	correct         int
	simpleExpected  int
	simpleToComplex int
	complexExpected int
	complexToSimple int
}

func TestDifficultyScoreCalibration(t *testing.T) {
	t.Parallel()

	samples := loadDifficultyCalibrationSamples(t)
	calibration, holdout := splitDifficultyCalibrationSamples(t, samples)
	if len(calibration) != 400 || len(holdout) != 100 {
		t.Fatalf("calibration split = %d/%d, want 400/100", len(calibration), len(holdout))
	}
	calibrationFamilies := map[string]bool{}
	for _, sample := range calibration {
		calibrationFamilies[sample.familyKey] = true
	}
	for _, sample := range holdout {
		if calibrationFamilies[sample.familyKey] {
			t.Fatalf("family %q leaked across calibration and holdout", sample.familyKey)
		}
	}

	legacyOracleCalibration := evaluateLegacyDifficultyCalibration(calibration, true)
	legacyEndToEndCalibration := evaluateLegacyDifficultyCalibration(calibration, false)
	selected, selectedOracleCalibration, selectedEndToEndCalibration, ok := selectDifficultyScorePolicy(
		calibration,
		legacyOracleCalibration,
	)
	if !ok {
		t.Fatal("no deterministic score policy met the calibration non-regression gates")
	}

	if selected != defaultDifficultyScorePolicy {
		t.Fatalf(
			"default score policy is not the calibrated selection: got %+v, want %+v, selected oracle=%s legacy=%s endToEnd=%s legacy=%s",
			defaultDifficultyScorePolicy,
			selected,
			selectedOracleCalibration,
			legacyOracleCalibration,
			selectedEndToEndCalibration,
			legacyEndToEndCalibration,
		)
	}

	legacyOracleHoldout := evaluateLegacyDifficultyCalibration(holdout, true)
	legacyEndToEndHoldout := evaluateLegacyDifficultyCalibration(holdout, false)
	selectedOracleHoldout := evaluateDifficultyScorePolicy(holdout, selected, true)
	selectedEndToEndHoldout := evaluateDifficultyScorePolicy(holdout, selected, false)
	assertDifficultyCalibrationNonRegression(t, "oracle holdout", selectedOracleHoldout, legacyOracleHoldout)
	assertDifficultyCalibrationNonRegression(t, "end-to-end holdout", selectedEndToEndHoldout, legacyEndToEndHoldout)

	t.Logf(
		"policy=%+v calibration oracle=%s legacy=%s endToEnd=%s legacy=%s holdout oracle=%s legacy=%s endToEnd=%s legacy=%s",
		selected,
		selectedOracleCalibration,
		legacyOracleCalibration,
		selectedEndToEndCalibration,
		legacyEndToEndCalibration,
		selectedOracleHoldout,
		legacyOracleHoldout,
		selectedEndToEndHoldout,
		legacyEndToEndHoldout,
	)
}

func loadDifficultyCalibrationSamples(t *testing.T) []difficultyCalibrationSample {
	t.Helper()
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve calibration test path")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", "..", "..", "..", ".."))
	datasetPath := filepath.Join(repoRoot, "docs", "v2.1.0", "fixtures", "difficulty-evaluation-dataset.fixture.jsonl")
	file, err := os.Open(datasetPath)
	if err != nil {
		t.Fatalf("open calibration dataset: %v", err)
	}
	defer file.Close()

	categoryClassifier := NewRuleBasedCategoryClassifier()
	samples := make([]difficultyCalibrationSample, 0, 500)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var record difficultyCalibrationRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			t.Fatalf("decode calibration dataset: %v", err)
		}
		promptFeatures := ExtractPromptFeatures(record.RedactedPrompt)
		actualCategory := categoryClassifier.ClassifyFeatures(promptFeatures).Category
		oracleFeatures := ExtractDifficultyFeatures(promptFeatures, record.ExpectedCategory)
		endToEndFeatures := ExtractDifficultyFeatures(promptFeatures, actualCategory)
		samples = append(samples, difficultyCalibrationSample{
			record:           record,
			familyKey:        difficultyCalibrationFamilyKey(record.SampleID),
			oracleFeatures:   oracleFeatures,
			endToEndFeatures: endToEndFeatures,
			legacyOracle:     legacyDifficultyForCalibration(oracleFeatures),
			legacyEndToEnd:   legacyDifficultyForCalibration(endToEndFeatures),
		})
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("read calibration dataset: %v", err)
	}
	if len(samples) != 500 {
		t.Fatalf("calibration dataset has %d samples, want 500", len(samples))
	}
	return samples
}

func difficultyCalibrationFamilyKey(sampleID string) string {
	parts := strings.Split(sampleID, "_")
	if len(parts) < 7 {
		return sampleID
	}
	family := parts[len(parts)-2]
	return strings.Join([]string{parts[1], parts[2], family}, "/")
}

func splitDifficultyCalibrationSamples(t *testing.T, samples []difficultyCalibrationSample) ([]difficultyCalibrationSample, []difficultyCalibrationSample) {
	t.Helper()
	familiesByCell := map[string]map[string]bool{}
	for _, sample := range samples {
		cell := sample.record.ExpectedCategory + "/" + sample.record.ExpectedDifficulty
		if familiesByCell[cell] == nil {
			familiesByCell[cell] = map[string]bool{}
		}
		familiesByCell[cell][sample.familyKey] = true
	}

	holdoutFamilies := map[string]bool{}
	for cell, familySet := range familiesByCell {
		families := make([]string, 0, len(familySet))
		for family := range familySet {
			families = append(families, family)
		}
		if len(families) != 5 {
			t.Fatalf("cell %s has %d families, want 5", cell, len(families))
		}
		sort.Slice(families, func(left int, right int) bool {
			leftHash := sha256.Sum256([]byte(families[left]))
			rightHash := sha256.Sum256([]byte(families[right]))
			return string(leftHash[:]) < string(rightHash[:])
		})
		holdoutFamilies[families[0]] = true
	}

	calibration := make([]difficultyCalibrationSample, 0, 400)
	holdout := make([]difficultyCalibrationSample, 0, 100)
	for _, sample := range samples {
		if holdoutFamilies[sample.familyKey] {
			holdout = append(holdout, sample)
		} else {
			calibration = append(calibration, sample)
		}
	}
	return calibration, holdout
}

func selectDifficultyScorePolicy(
	samples []difficultyCalibrationSample,
	legacyOracle difficultyCalibrationMetrics,
) (difficultyScorePolicy, difficultyCalibrationMetrics, difficultyCalibrationMetrics, bool) {
	var selected difficultyScorePolicy
	var selectedOracle difficultyCalibrationMetrics
	var selectedEndToEnd difficultyCalibrationMetrics
	found := false

	for _, commonPoints := range []int{4, 6, 8, 10, 12} {
		for _, categoryPoints := range []int{4, 6, 8, 10, 12} {
			for _, strongBonus := range []int{10, 20, 30, 40, 50} {
				for _, riskPoints := range []int{20, 30, 40, 50, 60} {
					for thresholdPoints := 30; thresholdPoints <= 80; thresholdPoints += 5 {
						policy := difficultyScorePolicy{
							commonUnitPoints:       commonPoints,
							categoryUnitPoints:     categoryPoints,
							strongSignalBonus:      strongBonus,
							unboundedRiskPoints:    riskPoints,
							complexThresholdPoints: thresholdPoints,
						}
						oracle := evaluateDifficultyScorePolicy(samples, policy, true)
						endToEnd := evaluateDifficultyScorePolicy(samples, policy, false)
						if oracle.correct < legacyOracle.correct || oracle.complexToSimple > legacyOracle.complexToSimple {
							continue
						}
						if !found || betterDifficultyCalibrationCandidate(oracle, policy, selectedOracle, selected) {
							selected = policy
							selectedOracle = oracle
							selectedEndToEnd = endToEnd
							found = true
						}
					}
				}
			}
		}
	}
	return selected, selectedOracle, selectedEndToEnd, found
}

func betterDifficultyCalibrationCandidate(
	candidate difficultyCalibrationMetrics,
	candidatePolicy difficultyScorePolicy,
	selected difficultyCalibrationMetrics,
	selectedPolicy difficultyScorePolicy,
) bool {
	if candidate.complexToSimple != selected.complexToSimple {
		return candidate.complexToSimple < selected.complexToSimple
	}
	if candidate.correct != selected.correct {
		return candidate.correct > selected.correct
	}
	if candidate.simpleToComplex != selected.simpleToComplex {
		return candidate.simpleToComplex < selected.simpleToComplex
	}
	if candidatePolicy.complexThresholdPoints != selectedPolicy.complexThresholdPoints {
		return candidatePolicy.complexThresholdPoints < selectedPolicy.complexThresholdPoints
	}
	return fmt.Sprint(candidatePolicy) < fmt.Sprint(selectedPolicy)
}

func evaluateDifficultyScorePolicy(samples []difficultyCalibrationSample, policy difficultyScorePolicy, oracle bool) difficultyCalibrationMetrics {
	return evaluateDifficultyCalibration(samples, oracle, func(sample difficultyCalibrationSample, useOracle bool) string {
		features := sample.endToEndFeatures
		if useOracle {
			features = sample.oracleFeatures
		}
		return classifyDifficultyWithPolicy(features, policy).Difficulty
	})
}

func evaluateLegacyDifficultyCalibration(samples []difficultyCalibrationSample, oracle bool) difficultyCalibrationMetrics {
	return evaluateDifficultyCalibration(samples, oracle, func(sample difficultyCalibrationSample, useOracle bool) string {
		if useOracle {
			return sample.legacyOracle
		}
		return sample.legacyEndToEnd
	})
}

func evaluateDifficultyCalibration(
	samples []difficultyCalibrationSample,
	oracle bool,
	classify func(difficultyCalibrationSample, bool) string,
) difficultyCalibrationMetrics {
	metrics := difficultyCalibrationMetrics{total: len(samples)}
	for _, sample := range samples {
		actual := classify(sample, oracle)
		expected := sample.record.ExpectedDifficulty
		if actual == expected {
			metrics.correct++
		}
		if expected == DifficultySimple {
			metrics.simpleExpected++
			if actual == DifficultyComplex {
				metrics.simpleToComplex++
			}
		} else {
			metrics.complexExpected++
			if actual == DifficultySimple {
				metrics.complexToSimple++
			}
		}
	}
	return metrics
}

func assertDifficultyCalibrationNonRegression(t *testing.T, name string, actual difficultyCalibrationMetrics, baseline difficultyCalibrationMetrics) {
	t.Helper()
	if actual.correct < baseline.correct || actual.complexToSimple > baseline.complexToSimple {
		t.Fatalf("%s regressed: actual=%s baseline=%s", name, actual, baseline)
	}
}

func (metrics difficultyCalibrationMetrics) String() string {
	return fmt.Sprintf(
		"accuracy=%.4f simpleToComplex=%.4f complexToSimple=%.4f",
		float64(metrics.correct)/float64(metrics.total),
		float64(metrics.simpleToComplex)/float64(metrics.simpleExpected),
		float64(metrics.complexToSimple)/float64(metrics.complexExpected),
	)
}

func legacyDifficultyForCalibration(features DifficultyFeatures) string {
	if features.common.payloadSizeBucket == "empty" {
		return DifficultySimple
	}
	if legacyHasCommonComplexity(features.common) || legacyHasCategoryComplexity(features) {
		return DifficultyComplex
	}
	if legacyHasBoundedSimpleEvidence(features) {
		return DifficultySimple
	}
	return DifficultyComplex
}

func legacyHasCommonComplexity(features CommonDifficultyFeatures) bool {
	if features.payloadSizeBucket == "large" || features.taskCount >= 3 || features.constraintCount >= 3 || features.scopeCount >= 4 || features.dependencyDepth >= 3 {
		return true
	}
	moderateSignals := 0
	for _, matched := range []bool{
		features.payloadSizeBucket == "medium",
		features.taskCount >= 2,
		features.constraintCount >= 2,
		features.scopeCount >= 2,
		features.dependencyDepth >= 2,
	} {
		if matched {
			moderateSignals++
		}
	}
	return moderateSignals >= 2
}

func legacyHasCategoryComplexity(features DifficultyFeatures) bool {
	switch features.category {
	case CategoryCode:
		return features.code != nil && (isComplexCodeOperation(features.code.codeOperationKind) || features.code.codeScopeBreadth >= 3 || features.code.causalComplexity >= 1 || features.code.engineeringConstraintCount >= 2)
	case CategoryTranslation:
		return features.translation != nil && (features.translation.translationScopeCount >= 2 || features.translation.preservationConstraintCount >= 2 || features.translation.domainTerminologyLevel >= 2 || features.translation.localizationDegree >= 2)
	case CategorySummarization:
		return features.summarization != nil && (features.summarization.sourceBreadth >= 3 || features.summarization.synthesisLevel >= 2 || features.summarization.facetCount >= 3 || features.summarization.hasTraceabilityConstraints)
	case CategoryReasoning:
		return features.reasoning != nil && (features.reasoning.alternativeCount >= 3 || features.reasoning.criteriaAndConstraintCount >= 3 || features.reasoning.reasoningDepth >= 2 || features.reasoning.uncertaintyScenarioCount >= 2)
	default:
		return features.general != nil && (features.general.workflowDepth >= 2 || features.general.branchOrExceptionCount >= 2 || features.general.extractionBreadth >= 4 || features.general.hasCrossSourceSynthesis)
	}
}

func legacyHasBoundedSimpleEvidence(features DifficultyFeatures) bool {
	common := features.common
	if common.payloadSizeBucket != "small" || common.taskCount > 1 || common.constraintCount > 1 || common.scopeCount > 1 || common.dependencyDepth > 1 {
		return false
	}
	switch features.category {
	case CategoryCode:
		return features.code != nil && (features.code.codeOperationKind == "syntax" || features.code.codeOperationKind == "example" || features.code.codeOperationKind == "small_edit" || features.code.codeOperationKind == "unknown")
	case CategoryTranslation:
		return features.translation != nil && features.translation.preservationConstraintCount <= 1 && features.translation.domainTerminologyLevel <= 1 && features.translation.localizationDegree <= 1
	case CategorySummarization:
		return features.summarization != nil && features.summarization.sourceBreadth <= 1 && features.summarization.synthesisLevel <= 1 && features.summarization.facetCount <= 2 && !features.summarization.hasTraceabilityConstraints
	case CategoryReasoning:
		return features.reasoning != nil && features.reasoning.alternativeCount <= 2 && features.reasoning.criteriaAndConstraintCount <= 1 && features.reasoning.reasoningDepth <= 1 && features.reasoning.uncertaintyScenarioCount <= 1
	default:
		return features.general != nil && features.general.workflowDepth <= 1 && features.general.branchOrExceptionCount <= 1 && features.general.extractionBreadth <= 3 && !features.general.hasCrossSourceSynthesis
	}
}
