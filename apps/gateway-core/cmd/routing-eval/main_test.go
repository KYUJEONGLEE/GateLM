package main

import (
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

func stringPtr(value string) *string {
	return &value
}
