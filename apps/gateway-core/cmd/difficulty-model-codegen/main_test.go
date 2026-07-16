package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestRunGeneratesAndChecksGatewayShadow118DBundle(t *testing.T) {
	artifactPath := filepath.Join(
		"..", "..", "..", "..",
		"scripts", "routing_difficulty_model", "artifacts", "candidates",
		"difficulty-candidate-c-118d.owner-approved-500.v3.json",
	)
	outputPath := filepath.Join(t.TempDir(), "difficulty_model_118d_generated.go")
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	args := []string{
		"-profile", "gateway-shadow-118d",
		"-artifact", artifactPath,
		"-output", outputPath,
	}
	if exitCode := run(args, &stdout, &stderr); exitCode != 0 {
		t.Fatalf("generate exit=%d stderr=%s", exitCode, stderr.String())
	}
	generated, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(generated, []byte("generatedDifficultySemanticModel118D")) {
		t.Fatal("generated output is not the selected Gateway shadow bundle")
	}

	stderr.Reset()
	if exitCode := run(append(args, "-check"), &stdout, &stderr); exitCode != 0 {
		t.Fatalf("check exit=%d stderr=%s", exitCode, stderr.String())
	}
	if err := os.WriteFile(outputPath, append(generated, []byte("// drift\n")...), 0o644); err != nil {
		t.Fatal(err)
	}
	stderr.Reset()
	if exitCode := run(append(args, "-check"), &stdout, &stderr); exitCode == 0 {
		t.Fatal("check accepted drifted generated output")
	}
}
