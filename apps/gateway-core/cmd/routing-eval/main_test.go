package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/tools/difficultymodel"
)

func TestEvaluateReportIncludesSyntheticPromptText(t *testing.T) {
	records := []datasetRecord{
		{
			SampleID:         "sample_report_redaction",
			RedactedPrompt:   stringPtr("safe synthetic prompt text for report review"),
			ExpectedCategory: "code",
		},
	}

	report := evaluate("synthetic.json", defaultClassifierVersion, records, 1)
	payload, err := marshalReport(report, true)
	if err != nil {
		t.Fatalf("marshalReport returned error: %v", err)
	}

	output := string(payload)
	if !strings.Contains(output, `"redactedPrompt"`) || !strings.Contains(output, "safe synthetic prompt text for report review") {
		t.Fatalf("report should include synthetic redacted prompt text for review: %s", output)
	}
	if strings.Contains(output, `"rawPrompt"`) {
		t.Fatalf("report must not use rawPrompt field name: %s", output)
	}
	if !strings.Contains(output, `"한글요약"`) || !strings.Contains(output, "카테고리 분류 정답 평가 리포트") {
		t.Fatalf("report should include Korean summary for operators: %s", output)
	}
	if !strings.Contains(output, "sample_report_redaction") {
		t.Fatalf("report should include sample id for investigation: %s", output)
	}
	if !strings.Contains(output, `"actualCategory"`) {
		t.Fatalf("report should include actual category for investigation: %s", output)
	}
	if len(report.Samples) != 1 || report.Samples[0].RedactedPrompt != "safe synthetic prompt text for report review" {
		t.Fatalf("report should include per-sample prompt context: %#v", report.Samples)
	}
}

func TestEvaluateReportContainsCategoryEvidenceOnly(t *testing.T) {
	records := []datasetRecord{
		{
			SampleID:         "sample_general",
			RedactedPrompt:   stringPtr("Explain the onboarding checklist briefly."),
			ExpectedCategory: "general",
		},
		{
			SampleID:         "sample_code",
			RedactedPrompt:   stringPtr("Fix this TypeScript function error."),
			ExpectedCategory: "code",
		},
	}

	report := evaluate("synthetic.json", defaultClassifierVersion, records, 3)
	payload, err := marshalReport(report, true)
	if err != nil {
		t.Fatalf("marshalReport returned error: %v", err)
	}

	if report.ErrorRate != 0 {
		t.Fatalf("expected no category errors for matching fixture, got %.4f", report.ErrorRate)
	}
	if report.ByCategory["general"].Incorrect != 0 || report.ByCategory["general"].IncorrectRate != 0 {
		t.Fatalf("expected category stats to include zero incorrect counts: %#v", report.ByCategory["general"])
	}
	if report.Latency.Samples != 6 {
		t.Fatalf("expected latency samples per iteration, got %d", report.Latency.Samples)
	}
	if report.Latency.AvgMicros <= 0 {
		t.Fatalf("expected latency average evidence, got %.4f", report.Latency.AvgMicros)
	}
	if report.Latency.P95Micros <= 0 {
		t.Fatalf("expected latency p95 evidence, got %.4f", report.Latency.P95Micros)
	}
	if len(report.Samples) != 2 || report.Samples[1].CategoryDiagnostics.TopCategory == "" || len(report.Samples[1].CategoryDiagnostics.ScoreVector) == 0 {
		t.Fatalf("expected per-sample category diagnostics for score/margin review: %#v", report.Samples)
	}

	output := string(payload)
	for _, forbiddenField := range []string{
		`"expectedTier"`,
		`"actualTier"`,
		`"tierAccuracy"`,
		`"tierErrorRate"`,
		`"byTier"`,
		`"costEstimate"`,
		`"routingReason"`,
	} {
		if strings.Contains(output, forbiddenField) {
			t.Fatalf("category-only report must not include %s: %s", forbiddenField, output)
		}
	}
}

func TestEvaluateDifficultyReportIncludesCombinationDirectionalAndLatencyEvidence(t *testing.T) {
	records := []datasetRecord{
		{
			SampleID:           "forced_simple_to_complex",
			RedactedPrompt:     stringPtr("Debug a race condition across multiple files."),
			ExpectedCategory:   "code",
			ExpectedDifficulty: "simple",
		},
		{
			SampleID:           "forced_complex_to_simple",
			RedactedPrompt:     stringPtr(""),
			ExpectedCategory:   "general",
			ExpectedDifficulty: "complex",
		},
		{
			SampleID:           "matching_simple",
			RedactedPrompt:     stringPtr("Explain OAuth briefly."),
			ExpectedCategory:   "general",
			ExpectedDifficulty: "simple",
		},
		{
			SampleID:           "matching_complex",
			RedactedPrompt:     stringPtr("Debug a race condition across multiple files."),
			ExpectedCategory:   "code",
			ExpectedDifficulty: "complex",
		},
	}

	report := evaluateDifficulty("difficulty.jsonl", "rule_based_difficulty_classifier_v1", records, 2, nil)
	if report.TotalSamples != 4 || report.CorrectSamples != 2 || report.IncorrectSamples != 2 || report.Accuracy != 0.5 {
		t.Fatalf("unexpected difficulty summary: %#v", report)
	}
	if got := report.ByCategoryDifficulty["code"]["simple"]; got.Total != 1 || got.Correct != 0 || got.Incorrect != 1 {
		t.Fatalf("unexpected code/simple stats: %#v", got)
	}
	if got := report.ByCategoryDifficulty["code"]["complex"]; got.Total != 1 || got.Correct != 1 || got.Incorrect != 0 {
		t.Fatalf("unexpected code/complex stats: %#v", got)
	}
	if report.DirectionalErrors.SimpleExpectedSamples != 2 || report.DirectionalErrors.SimpleToComplexCount != 1 || report.DirectionalErrors.SimpleToComplexRate != 0.5 {
		t.Fatalf("unexpected simple-to-complex evidence: %#v", report.DirectionalErrors)
	}
	if report.DirectionalErrors.ComplexExpectedSamples != 2 || report.DirectionalErrors.ComplexToSimpleCount != 1 || report.DirectionalErrors.ComplexToSimpleRate != 0.5 {
		t.Fatalf("unexpected complex-to-simple evidence: %#v", report.DirectionalErrors)
	}
	for name, latency := range map[string]latencyStats{
		"category":   report.ClassificationLatency.Category,
		"difficulty": report.ClassificationLatency.Difficulty,
		"total":      report.ClassificationLatency.Total,
	} {
		if latency.Samples != 8 || latency.Iterations != 2 || latency.AvgMicros <= 0 || latency.P95Micros <= 0 {
			t.Fatalf("unexpected %s latency evidence: %#v", name, latency)
		}
	}

	payload, err := marshalDifficultyReport(report, true)
	if err != nil {
		t.Fatalf("marshalDifficultyReport returned error: %v", err)
	}
	output := string(payload)
	for _, expectedField := range []string{`"byCategoryDifficulty"`, `"simpleToComplexCount"`, `"complexToSimpleCount"`, `"classificationLatency"`} {
		if !strings.Contains(output, expectedField) {
			t.Fatalf("difficulty report is missing %s: %s", expectedField, output)
		}
	}
}

func TestEvaluateDifficultyShadowComparesRuntimeWithoutChangingIt(t *testing.T) {
	artifactPath := writeTestDifficultyArtifact(t, -100)
	shadowOptions, err := loadDifficultyShadowOptions(artifactPath)
	if err != nil {
		t.Fatalf("loadDifficultyShadowOptions returned error: %v", err)
	}
	longSimplePrompt := strings.Repeat("Summarize this synthetic note briefly. ", 5) + "Then explain the owner."
	records := []datasetRecord{
		{
			SampleID:           "long_simple",
			RedactedPrompt:     stringPtr(longSimplePrompt),
			ExpectedCategory:   routing.CategorySummarization,
			ExpectedDifficulty: routing.DifficultySimple,
		},
		{
			SampleID:           "short_hard_complex",
			RedactedPrompt:     stringPtr("Debug a race condition."),
			ExpectedCategory:   routing.CategoryCode,
			ExpectedDifficulty: routing.DifficultyComplex,
		},
	}

	report := evaluateDifficulty("difficulty-shadow.jsonl", defaultDifficultyClassifierVersion, records, 2, shadowOptions)
	if report.Shadow == nil {
		t.Fatal("shadow report is required when a model artifact is supplied")
	}
	if report.Shadow.ProductRuntimeChanged {
		t.Fatal("offline shadow evaluation must not claim a product runtime change")
	}
	if report.Shadow.RuntimeComparison.ChangedSamples != 1 || report.Shadow.RuntimeComparison.RuntimeComplexToShadowSimple != 1 {
		t.Fatalf("unexpected runtime comparison: %#v", report.Shadow.RuntimeComparison)
	}
	if !report.Shadow.RuntimeComparison.SafetyGatePassed {
		t.Fatalf("expected complex-to-simple safety gate to pass: %#v", report.Shadow.RuntimeComparison)
	}
	if segment := report.Shadow.Segments.LongSimple; segment.Total != 1 || segment.RuntimeCorrect != 0 || segment.ShadowCorrect != 1 {
		t.Fatalf("unexpected long-simple segment: %#v", segment)
	}
	if segment := report.Shadow.Segments.ShortComplex; segment.Total != 1 || segment.RuntimeCorrect != 1 || segment.ShadowCorrect != 1 {
		t.Fatalf("unexpected short-complex segment: %#v", segment)
	}
	if report.Samples[0].ComplexityScore == nil || *report.Samples[0].ComplexityScore >= difficultymodel.ThresholdValue || report.Samples[0].ShadowDifficulty != routing.DifficultySimple {
		t.Fatalf("expected model-path shadow result for long simple sample: %#v", report.Samples[0])
	}
	if report.Samples[1].ComplexityScore == nil || *report.Samples[1].ComplexityScore != 1 || report.Samples[1].ShadowDifficulty != routing.DifficultyComplex {
		t.Fatalf("expected hard-complex sentinel for short sample: %#v", report.Samples[1])
	}
	if report.Samples[0].ModelPath == nil || !*report.Samples[0].ModelPath || report.Samples[1].ModelPath == nil || *report.Samples[1].ModelPath {
		t.Fatalf("expected explicit model-path boundaries: %#v", report.Samples)
	}
	if calibration := report.Shadow.Calibration; !calibration.Valid || calibration.Samples != 1 || calibration.SentinelExcluded != 1 || calibration.BinPolicy != "equal-width-10-v1" {
		t.Fatalf("unexpected calibration evidence: %#v", calibration)
	}
	if report.Calibration.Applicable || report.Calibration.Reason == "" {
		t.Fatalf("rule calibration must be unavailable: %#v", report.Calibration)
	}
	if report.ClassificationLatency.Total.WarmupIterations != defaultLatencyWarmupIterations || report.Shadow.TotalLatency.WarmupIterations != defaultLatencyWarmupIterations || report.ClassificationLatency.Total.BatchSize != defaultLatencyBatchSize || report.Shadow.TotalLatency.BatchSize != defaultLatencyBatchSize {
		t.Fatalf("missing latency warm-up provenance: runtime=%#v shadow=%#v", report.ClassificationLatency.Total, report.Shadow.TotalLatency)
	}
	if report.ClassificationLatency.Difficulty.BatchSize != defaultDifficultyLatencyBatchSize || report.Shadow.DifficultyLatency.BatchSize != defaultDifficultyLatencyBatchSize {
		t.Fatalf("missing difficulty-only latency batch provenance: runtime=%#v shadow=%#v", report.ClassificationLatency.Difficulty, report.Shadow.DifficultyLatency)
	}

	payload, err := marshalDifficultyReport(report, false)
	if err != nil {
		t.Fatalf("marshalDifficultyReport returned error: %v", err)
	}
	output := string(payload)
	for _, forbiddenField := range []string{`"rawProbability"`, `"logit"`, `"weights"`, `"featureContribution"`} {
		if strings.Contains(output, forbiddenField) {
			t.Fatalf("shadow report must not include %s: %s", forbiddenField, output)
		}
	}
}

func TestSummarizeDifficultyCalibrationUsesFixedBins(t *testing.T) {
	report := summarizeDifficultyCalibration([]difficultyCalibrationObservation{
		{ExpectedCategory: routing.CategoryGeneral, Label: 0, Score: 0.2},
		{ExpectedCategory: routing.CategoryCode, Label: 1, Score: 0.8},
	}, 3)
	if !report.Valid || report.Samples != 2 || report.SentinelExcluded != 3 || report.LogLoss != 0.223144 || report.BrierScore != 0.04 {
		t.Fatalf("unexpected calibration summary: %#v", report)
	}
	if len(report.Bins) != 10 || report.Bins[2].Samples != 1 || report.Bins[8].Samples != 1 {
		t.Fatalf("unexpected calibration bins: %#v", report.Bins)
	}
}

func TestLoadDatasetHandlesUTF8BOMJSONFile(t *testing.T) {
	datasetPath := filepath.Join(t.TempDir(), "category_eval_cases.json")
	payload := "\ufeff" + `[
  {
    "schemaVersion": "gatelm.category-evaluation-record.v2",
    "sampleId": "sample_bom_json",
    "redactedPrompt": "Explain the onboarding checklist.",
    "expectedCategory": "general"
  }
]`
	if err := os.WriteFile(datasetPath, []byte(payload), 0o644); err != nil {
		t.Fatalf("write dataset fixture: %v", err)
	}

	records, err := loadDataset(datasetPath, true)
	if err != nil {
		t.Fatalf("loadDataset returned error: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected 1 record, got %d", len(records))
	}
	if records[0].expectedID() != "sample_bom_json" {
		t.Fatalf("unexpected sample id: %q", records[0].expectedID())
	}
}

func TestLoadDifficultyDatasetAcceptsCanonicalDifficultyRecord(t *testing.T) {
	datasetPath := filepath.Join(t.TempDir(), "difficulty_eval.jsonl")
	payload := `{"schemaVersion":"gatelm.difficulty-evaluation-record.v1","sampleId":"difficulty_001","redactedPrompt":"Explain OAuth briefly.","expectedCategory":"general","expectedDifficulty":"simple","language":"en"}` + "\n"
	if err := os.WriteFile(datasetPath, []byte(payload), 0o644); err != nil {
		t.Fatalf("write difficulty dataset fixture: %v", err)
	}

	records, err := loadDifficultyDataset(datasetPath)
	if err != nil {
		t.Fatalf("loadDifficultyDataset returned error: %v", err)
	}
	if len(records) != 1 || records[0].ExpectedDifficulty != "simple" || records[0].ExpectedCategory != "general" {
		t.Fatalf("unexpected difficulty records: %#v", records)
	}
}

func TestRoutingEvalCLIProducesDifficultyReport(t *testing.T) {
	datasetPath := filepath.Join(t.TempDir(), "difficulty_eval.jsonl")
	payload := `{"schemaVersion":"gatelm.difficulty-evaluation-record.v1","sampleId":"difficulty_cli_001","redactedPrompt":"Explain OAuth briefly.","expectedCategory":"general","expectedDifficulty":"simple","language":"en"}` + "\n"
	if err := os.WriteFile(datasetPath, []byte(payload), 0o644); err != nil {
		t.Fatalf("write difficulty CLI fixture: %v", err)
	}

	command := exec.Command(
		"go", "run", ".",
		"-evaluation-scope", "difficulty",
		"-dataset", datasetPath,
		"-latency-iterations", "1",
		"-pretty=false",
	)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("difficulty CLI failed: %v\n%s", err, output)
	}

	var report difficultyReport
	if err := json.Unmarshal(output, &report); err != nil {
		t.Fatalf("decode difficulty CLI report: %v\n%s", err, output)
	}
	if report.TotalSamples != 1 || report.CorrectSamples != 1 || report.Accuracy != 1 {
		t.Fatalf("unexpected difficulty CLI report: %#v", report)
	}
}

func TestRoutingEvalCLIProducesOptInDifficultyShadowReport(t *testing.T) {
	datasetPath := filepath.Join(t.TempDir(), "difficulty_eval.jsonl")
	payload := `{"schemaVersion":"gatelm.difficulty-evaluation-record.v1","sampleId":"difficulty_shadow_cli_001","redactedPrompt":"Explain OAuth briefly.","expectedCategory":"general","expectedDifficulty":"simple","language":"en"}` + "\n"
	if err := os.WriteFile(datasetPath, []byte(payload), 0o644); err != nil {
		t.Fatalf("write difficulty CLI fixture: %v", err)
	}
	artifactPath := writeTestDifficultyArtifact(t, -100)

	command := exec.Command(
		"go", "run", ".",
		"-evaluation-scope", "difficulty",
		"-dataset", datasetPath,
		"-difficulty-shadow-model-artifact", artifactPath,
		"-latency-iterations", "1",
		"-pretty=false",
	)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("difficulty shadow CLI failed: %v\n%s", err, output)
	}

	var report difficultyReport
	if err := json.Unmarshal(output, &report); err != nil {
		t.Fatalf("decode difficulty shadow CLI report: %v\n%s", err, output)
	}
	if report.Shadow == nil || report.Shadow.ProductRuntimeChanged || report.Shadow.ArtifactVersion != "difficulty-logistic-v1-test" {
		t.Fatalf("unexpected difficulty shadow CLI report: %#v", report.Shadow)
	}
}

func TestLoadDatasetRejectsV1RecordAtHardCutover(t *testing.T) {
	datasetPath := filepath.Join(t.TempDir(), "category_eval_v1.jsonl")
	payload := `{"schemaVersion":"gatelm.category-evaluation-record.v1","sampleId":"sample_v1_compatible","redactedPrompt":"Explain the onboarding checklist.","expectedCategory":"general","expectedTier":"low_cost"}` + "\n"
	if err := os.WriteFile(datasetPath, []byte(payload), 0o644); err != nil {
		t.Fatalf("write dataset fixture: %v", err)
	}

	_, err := loadDataset(datasetPath, true)
	if err == nil || !strings.Contains(err.Error(), "unsupported schemaVersion") {
		t.Fatalf("expected v1 hard cutover rejection, got %v", err)
	}
}

func TestLoadDatasetRejectsExpectedTierInV2Record(t *testing.T) {
	datasetPath := filepath.Join(t.TempDir(), "category_eval_v2.jsonl")
	payload := `{"schemaVersion":"gatelm.category-evaluation-record.v2","sampleId":"sample_v2_with_tier","redactedPrompt":"Explain the onboarding checklist.","expectedCategory":"general","expectedTier":"low_cost"}` + "\n"
	if err := os.WriteFile(datasetPath, []byte(payload), 0o644); err != nil {
		t.Fatalf("write dataset fixture: %v", err)
	}

	_, err := loadDataset(datasetPath, true)
	if err == nil || !strings.Contains(err.Error(), "expectedTier") {
		t.Fatalf("expected v2 expectedTier validation error, got %v", err)
	}
}

func TestLoadDatasetRejectsExpectedDifficultyInCategoryRecord(t *testing.T) {
	datasetPath := filepath.Join(t.TempDir(), "category_eval_with_difficulty.jsonl")
	payload := `{"schemaVersion":"gatelm.category-evaluation-record.v2","sampleId":"category_with_difficulty","redactedPrompt":"Explain the onboarding checklist.","expectedCategory":"general","expectedDifficulty":"simple"}` + "\n"
	if err := os.WriteFile(datasetPath, []byte(payload), 0o644); err != nil {
		t.Fatalf("write category fixture: %v", err)
	}

	_, err := loadDataset(datasetPath, true)
	if err == nil || !strings.Contains(err.Error(), "expectedDifficulty") {
		t.Fatalf("expected category-only rejection, got %v", err)
	}
}

func TestLoadDatasetRejectsMissingSchemaVersionForEvaluation(t *testing.T) {
	datasetPath := filepath.Join(t.TempDir(), "category_eval_unversioned.jsonl")
	payload := `{"sampleId":"sample_unversioned","redactedPrompt":"Explain the onboarding checklist.","expectedCategory":"general"}` + "\n"
	if err := os.WriteFile(datasetPath, []byte(payload), 0o644); err != nil {
		t.Fatalf("write dataset fixture: %v", err)
	}

	_, err := loadDataset(datasetPath, true)
	if err == nil || !strings.Contains(err.Error(), "schemaVersion") {
		t.Fatalf("expected missing schemaVersion validation error, got %v", err)
	}
}

func TestLoadDatasetRejectsV1RecordWithoutExpectedTier(t *testing.T) {
	datasetPath := filepath.Join(t.TempDir(), "category_eval_v1_missing_tier.jsonl")
	payload := `{"schemaVersion":"gatelm.category-evaluation-record.v1","sampleId":"sample_v1_missing_tier","redactedPrompt":"Explain the onboarding checklist.","expectedCategory":"general"}` + "\n"
	if err := os.WriteFile(datasetPath, []byte(payload), 0o644); err != nil {
		t.Fatalf("write dataset fixture: %v", err)
	}

	_, err := loadDataset(datasetPath, true)
	if err == nil || !strings.Contains(err.Error(), "unsupported schemaVersion") {
		t.Fatalf("expected v1 hard cutover rejection, got %v", err)
	}
}

func TestLoadDatasetRejectsLegacyPromptForEvaluation(t *testing.T) {
	datasetPath := filepath.Join(t.TempDir(), "category_eval_legacy_prompt.jsonl")
	payload := `{"schemaVersion":"gatelm.category-evaluation-record.v2","sampleId":"sample_legacy_prompt","prompt":"Explain the onboarding checklist.","expectedCategory":"general"}` + "\n"
	if err := os.WriteFile(datasetPath, []byte(payload), 0o644); err != nil {
		t.Fatalf("write dataset fixture: %v", err)
	}

	_, err := loadDataset(datasetPath, true)
	if err == nil || !strings.Contains(err.Error(), "redactedPrompt") {
		t.Fatalf("expected redactedPrompt validation error, got %v", err)
	}
}

func TestProbeReportClassifiesUnlabeledRecordsWithPromptText(t *testing.T) {
	records := []datasetRecord{
		{
			SampleID:       "probe_neutral",
			RedactedPrompt: stringPtr("Please describe a safe synthetic workspace reminder."),
		},
		{
			SampleID:       "probe_blank",
			RedactedPrompt: stringPtr(""),
		},
	}

	report := probe("probe.jsonl", defaultClassifierVersion, records, 1)
	payload, err := marshalProbeReport(report, true)
	if err != nil {
		t.Fatalf("marshalProbeReport returned error: %v", err)
	}

	output := string(payload)
	if !strings.Contains(output, `"redactedPrompt"`) || !strings.Contains(output, "safe synthetic workspace reminder") {
		t.Fatalf("probe report should include synthetic redacted prompt text for review: %s", output)
	}
	if strings.Contains(output, `"rawPrompt"`) {
		t.Fatalf("probe report must not use rawPrompt field name: %s", output)
	}
	if !strings.Contains(output, `"한글요약"`) || !strings.Contains(output, "카테고리 분포 관찰 리포트") {
		t.Fatalf("probe report should include Korean summary for operators: %s", output)
	}
	if report.TotalSamples != 2 {
		t.Fatalf("expected 2 samples, got %d", report.TotalSamples)
	}
	if report.ByCategory["general"].Total != 2 {
		t.Fatalf("unexpected category distribution: %#v", report.ByCategory)
	}
	if _, exists := report.ByCategory["unknown"]; exists {
		t.Fatalf("retired unknown category must normalize to general: %#v", report.ByCategory)
	}
	if len(report.Samples) != 2 {
		t.Fatalf("expected sample classifications, got %d", len(report.Samples))
	}
	for _, forbiddenField := range []string{
		`"tier"`,
		`"byTier"`,
		`"costEstimate"`,
		`"routingReason"`,
	} {
		if strings.Contains(output, forbiddenField) {
			t.Fatalf("category-only probe report must not include %s: %s", forbiddenField, output)
		}
	}
}

func TestLoadDatasetAllowsUnlabeledProbeRecords(t *testing.T) {
	datasetPath := filepath.Join(t.TempDir(), "probe.jsonl")
	payload := `{"sampleId":"probe_001","redactedPrompt":"Please describe a neutral workspace note."}` + "\n"
	if err := os.WriteFile(datasetPath, []byte(payload), 0o644); err != nil {
		t.Fatalf("write probe fixture: %v", err)
	}

	records, err := loadDataset(datasetPath, false)
	if err != nil {
		t.Fatalf("loadDataset returned error: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected 1 record, got %d", len(records))
	}
	if records[0].ExpectedCategory != "" {
		t.Fatalf("probe record should not require expected category")
	}
}

func stringPtr(value string) *string {
	return &value
}

func writeTestDifficultyArtifact(t *testing.T, bias float64) string {
	t.Helper()
	coefficient := 20.0
	intercept := -10.0
	artifact := difficultymodel.Artifact{
		SchemaVersion:          difficultymodel.ArtifactSchemaVersion,
		ArtifactVersion:        "difficulty-logistic-v1-test",
		ModelVersion:           difficultymodel.ModelVersion,
		FeatureVersion:         routing.DifficultyFeatureVectorVersionV1,
		TrainingDatasetVersion: "difficulty-test-dataset.v1",
		TrainingDatasetSHA256:  "sha256:test",
		SplitPolicyVersion:     "difficulty-family-split.v1",
		Bias:                   bias,
		FeatureNames:           routing.DifficultyFeatureNamesV1(),
		Weights:                make([]float64, routing.DifficultyFeatureVectorDimensionV1),
		CalibrationVersion:     difficultymodel.CalibrationVersion,
		Calibrator: difficultymodel.Calibrator{
			Type:        "platt",
			Input:       "raw_probability",
			Coefficient: &coefficient,
			Intercept:   &intercept,
		},
		ThresholdPolicyVersion: difficultymodel.ThresholdPolicyVersion,
		Threshold:              difficultymodel.ThresholdValue,
		ContentHashAlgorithm:   difficultymodel.ContentHashAlgorithm,
	}
	artifact.ContentHash = difficultymodel.ContentHash(artifact)
	payload, err := json.Marshal(artifact)
	if err != nil {
		t.Fatalf("marshal difficulty artifact: %v", err)
	}
	artifactPath := filepath.Join(t.TempDir(), "difficulty-model.json")
	if err := os.WriteFile(artifactPath, payload, 0o644); err != nil {
		t.Fatalf("write difficulty artifact: %v", err)
	}
	return artifactPath
}
