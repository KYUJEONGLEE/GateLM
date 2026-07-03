package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEvaluateReportDoesNotIncludePromptText(t *testing.T) {
	records := []datasetRecord{
		{
			SampleID:         "sample_report_redaction",
			Prompt:           stringPtr("private synthetic prompt text for report redaction"),
			ExpectedCategory: "code",
		},
	}

	report := evaluate("synthetic.json", defaultClassifierVersion, records, 1)
	payload, err := marshalReport(report, true)
	if err != nil {
		t.Fatalf("marshalReport returned error: %v", err)
	}

	output := string(payload)
	if strings.Contains(output, "private synthetic prompt text") {
		t.Fatalf("report must not include prompt text: %s", output)
	}
	if !strings.Contains(output, "sample_report_redaction") {
		t.Fatalf("report should include sample id for investigation: %s", output)
	}
	if !strings.Contains(output, `"actualCategory"`) {
		t.Fatalf("report should include actual category for investigation: %s", output)
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
	if report.Latency.Samples != 6 {
		t.Fatalf("expected latency samples per iteration, got %d", report.Latency.Samples)
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

	records, err := loadDataset(datasetPath)
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

func stringPtr(value string) *string {
	return &value
}
