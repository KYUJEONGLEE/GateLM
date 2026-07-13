package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
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

	report := evaluateDifficulty("difficulty.jsonl", "rule_based_difficulty_classifier_v1", records, 2)
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
