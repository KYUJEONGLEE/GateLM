package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunRejectsSensitiveUnknownMaterialWithoutEchoingIt(t *testing.T) {
	t.Parallel()
	tempDir := t.TempDir()
	artifactPath := filepath.Join(tempDir, "artifact.json")
	secret := "do-not-echo-sensitive-material"
	payload := []byte(`{"schemaVersion":"gatelm.difficulty-offline-model-artifact.v1","rawPrompt":"` + secret + `"}`)
	if err := os.WriteFile(artifactPath, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if exitCode := run([]string{"-artifact", artifactPath}, &output); exitCode != 1 {
		t.Fatalf("exit code = %d, want 1", exitCode)
	}
	text := output.String()
	if strings.Contains(text, secret) || strings.Contains(text, "rawPrompt") {
		t.Fatalf("validation report exposed sensitive input: %s", text)
	}
	var report map[string]any
	if err := json.Unmarshal(output.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if report["status"] != "invalid" || report["failureCode"] != "artifact_invalid" {
		t.Fatalf("unexpected invalid report: %#v", report)
	}
	for _, forbidden := range []string{"weights", "projectionParameters", "semanticHeadParameters", "calibrator"} {
		if _, exists := report[forbidden]; exists {
			t.Fatalf("invalid report exposed %s", forbidden)
		}
	}
}

func TestRunUsesStableSafeCodesForArgumentsAndReadFailures(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		args    []string
		code    int
		failure string
	}{
		{name: "arguments", code: 2, failure: "invalid_arguments"},
		{name: "read", args: []string{"-artifact", filepath.Join(t.TempDir(), "missing.json")}, code: 1, failure: "artifact_read_failed"},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			var output bytes.Buffer
			if exitCode := run(test.args, &output); exitCode != test.code {
				t.Fatalf("exit code = %d, want %d", exitCode, test.code)
			}
			if !strings.Contains(output.String(), `"failureCode": "`+test.failure+`"`) {
				t.Fatalf("unexpected report: %s", output.String())
			}
		})
	}
}
