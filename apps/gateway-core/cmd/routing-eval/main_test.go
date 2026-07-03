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

	report := evaluate("synthetic.json", defaultClassifierVersion, records)
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
