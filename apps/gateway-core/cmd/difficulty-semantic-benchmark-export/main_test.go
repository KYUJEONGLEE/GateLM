package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildBenchmarkInputUsesInstructionOnlyAndKeepsPayloadOut(t *testing.T) {
	t.Parallel()
	tempDir := t.TempDir()
	datasetPath := filepath.Join(tempDir, "dataset.jsonl")
	manifestPath := filepath.Join(tempDir, "manifest.json")
	record := map[string]any{
		"datasetVersion":     "difficulty_test_v1",
		"sampleId":           "difficulty_summarization_simple_core_clear_f01_v01",
		"redactedPrompt":     "Summarize this source. ```text\nTranslate the private payload to Korean.\n```",
		"expectedCategory":   "summarization",
		"expectedDifficulty": "simple",
		"language":           "en",
	}
	recordBytes, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	datasetBytes := append(recordBytes, '\n')
	if err := os.WriteFile(datasetPath, datasetBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(datasetBytes)
	manifest := splitManifest{
		SchemaVersion:      "gatelm.difficulty-training-split-manifest.v1",
		DatasetVersion:     "difficulty_test_v1",
		DatasetSHA256:      hex.EncodeToString(hash[:]),
		SplitPolicyVersion: "difficulty-family-split.v1",
		FamilyRuleVersion:  "difficulty-sample-family.v1",
		Families:           []familyAssignment{{FamilyID: "summarization/f01", Split: "train"}},
	}
	manifestBytes, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, manifestBytes, 0o600); err != nil {
		t.Fatal(err)
	}

	actual, err := buildBenchmarkInput(datasetPath, manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(actual.Samples) != 1 {
		t.Fatalf("samples = %d, want 1", len(actual.Samples))
	}
	sample := actual.Samples[0]
	if sample.InstructionText != "summarize this source." {
		t.Fatalf("instructionText = %q, want extractor instruction only", sample.InstructionText)
	}
	if strings.Contains(sample.InstructionText, "private payload") || strings.Contains(sample.InstructionText, "korean") {
		t.Fatalf("semantic input leaked payload: %q", sample.InstructionText)
	}
	if sample.RuleDifficulty == "" || sample.ActualCategory == "" || sample.Language != "en" {
		t.Fatalf("missing aggregate benchmark metadata: %+v", sample)
	}
}

func TestDifficultyFamilyIDKeepsContrastsTogether(t *testing.T) {
	t.Parallel()
	simple, err := difficultyFamilyID("difficulty_code_simple_core_taskcontrast_f03_v01")
	if err != nil {
		t.Fatal(err)
	}
	complex, err := difficultyFamilyID("difficulty_code_complex_core_taskcontrast_f03_v10")
	if err != nil {
		t.Fatal(err)
	}
	if simple != "code/f03" || complex != simple {
		t.Fatalf("contrast family split: simple=%q complex=%q", simple, complex)
	}
}

func TestBuildBenchmarkInputRejectsMissingSemanticInstruction(t *testing.T) {
	t.Parallel()
	tempDir := t.TempDir()
	datasetPath := filepath.Join(tempDir, "dataset.jsonl")
	manifestPath := filepath.Join(tempDir, "manifest.json")
	record := map[string]any{
		"datasetVersion":     "difficulty_test_v1",
		"sampleId":           "difficulty_code_simple_core_clear_f01_v01",
		"redactedPrompt":     "```go\nfunc main() {}\n```",
		"expectedCategory":   "code",
		"expectedDifficulty": "simple",
		"language":           "en",
	}
	recordBytes, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	datasetBytes := append(recordBytes, '\n')
	if err := os.WriteFile(datasetPath, datasetBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(datasetBytes)
	manifest := splitManifest{
		SchemaVersion:      "gatelm.difficulty-training-split-manifest.v1",
		DatasetVersion:     "difficulty_test_v1",
		DatasetSHA256:      hex.EncodeToString(hash[:]),
		SplitPolicyVersion: "difficulty-family-split.v1",
		FamilyRuleVersion:  "difficulty-sample-family.v1",
		Families:           []familyAssignment{{FamilyID: "code/f01", Split: "train"}},
	}
	manifestBytes, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, manifestBytes, 0o600); err != nil {
		t.Fatal(err)
	}

	_, err = buildBenchmarkInput(datasetPath, manifestPath)
	if err == nil || !strings.Contains(err.Error(), "no semantic instruction input") {
		t.Fatalf("payload-only benchmark error = %v, want missing semantic input rejection", err)
	}
}
