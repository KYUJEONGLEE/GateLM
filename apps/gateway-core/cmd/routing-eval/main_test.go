package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEvaluateReportIncludesSyntheticPromptText(t *testing.T) {
	records := []datasetRecord{
		{
			SampleID:         "sample_report_redaction",
			Prompt:           stringPtr("safe synthetic prompt text for report review"),
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
	if !strings.Contains(output, `"한글요약"`) || !strings.Contains(output, "라우팅 정답 평가 리포트") {
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

func TestEvaluateReportIncludesTierLatencyAndCostEvidence(t *testing.T) {
	records := []datasetRecord{
		{
			SampleID:         "sample_low_cost",
			Prompt:           stringPtr("Explain the onboarding checklist briefly."),
			ExpectedCategory: "general",
			ExpectedTier:     "low_cost",
		},
		{
			SampleID:         "sample_high_quality",
			Prompt:           stringPtr("Fix this TypeScript function error."),
			ExpectedCategory: "code",
			ExpectedTier:     "high_quality",
		},
	}

	report := evaluate("synthetic.json", defaultClassifierVersion, records, 3)

	if report.TierLabeledSamples != 2 {
		t.Fatalf("expected tier labeled samples, got %d", report.TierLabeledSamples)
	}
	if report.TierAccuracy <= 0 {
		t.Fatalf("expected positive tier accuracy, got %.4f", report.TierAccuracy)
	}
	if report.ErrorRate != 0 || report.TierErrorRate != 0 {
		t.Fatalf("expected no errors for matching fixture, got category=%.4f tier=%.4f", report.ErrorRate, report.TierErrorRate)
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
	if report.CostEstimate.BaselineCostUnits <= report.CostEstimate.ActualCostUnits {
		t.Fatalf("expected high-quality baseline to cost more than routed result: %#v", report.CostEstimate)
	}
	if report.CostEstimate.SavingRate <= 0 {
		t.Fatalf("expected positive cost saving estimate: %#v", report.CostEstimate)
	}
	if len(report.Samples) != 2 || report.Samples[1].CategoryDiagnostics.TopCategory == "" || len(report.Samples[1].CategoryDiagnostics.ScoreVector) == 0 {
		t.Fatalf("expected per-sample category diagnostics for score/margin review: %#v", report.Samples)
	}
}

func TestLoadDatasetHandlesUTF8BOMJSONFile(t *testing.T) {
	datasetPath := filepath.Join(t.TempDir(), "category_eval_cases.json")
	payload := "\ufeff" + `[
  {
    "id": "sample_bom_json",
    "prompt": "Explain the onboarding checklist.",
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
	if !strings.Contains(output, `"한글요약"`) || !strings.Contains(output, "라우팅 분포 관찰 리포트") {
		t.Fatalf("probe report should include Korean summary for operators: %s", output)
	}
	if report.TotalSamples != 2 {
		t.Fatalf("expected 2 samples, got %d", report.TotalSamples)
	}
	if report.ByCategory["general"].Total != 1 || report.ByCategory["unknown"].Total != 1 {
		t.Fatalf("unexpected category distribution: %#v", report.ByCategory)
	}
	if len(report.Samples) != 2 {
		t.Fatalf("expected sample classifications, got %d", len(report.Samples))
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
