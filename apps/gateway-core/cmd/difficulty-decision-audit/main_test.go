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

func TestBuildDifficultyDecisionAuditUsesCanonicalRoutesWithoutPromptOutput(t *testing.T) {
	t.Parallel()
	tempDir := t.TempDir()
	datasetPath := filepath.Join(tempDir, "dataset.jsonl")
	manifestPath := filepath.Join(tempDir, "manifest.json")
	records := []map[string]any{
		auditTestRecord("simple-empty", "family.simple", "```text\npayload only\n```", "simple", "empty_instruction"),
		auditTestRecord("hard", "family.hard", "Across multiple services, diagnose a race condition and deadlock; preserve behavior, security, and compatibility.", "complex", "eligible"),
		auditTestRecord("model", "family.model", "Explain OAuth briefly.", "simple", "eligible"),
	}
	var dataset []byte
	for _, record := range records {
		encoded, err := json.Marshal(record)
		if err != nil {
			t.Fatal(err)
		}
		dataset = append(dataset, encoded...)
		dataset = append(dataset, '\n')
	}
	if err := os.WriteFile(datasetPath, dataset, 0o600); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(dataset)
	manifest := map[string]any{
		"schemaVersion":       "gatelm.difficulty-label-dataset-manifest.v2",
		"datasetVersion":      "difficulty_audit_test_v1",
		"recordSchemaVersion": "gatelm.difficulty-label-record.v2",
		"datasetSha256":       hex.EncodeToString(hash[:]),
		"trainingEligible":    true,
		"families": []map[string]any{
			{"promptFamily": "family.simple", "partition": "train", "records": 1},
			{"promptFamily": "family.hard", "partition": "calibration", "records": 1},
			{"promptFamily": "family.model", "partition": "holdout", "records": 1},
		},
	}
	encodedManifest, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, encodedManifest, 0o600); err != nil {
		t.Fatal(err)
	}

	actual, err := buildDifficultyDecisionAudit(datasetPath, manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if actual.TotalRecords != 3 || actual.SimpleSentinelRecords != 1 || actual.HardSentinelRecords != 1 || actual.ModelPathRecords != 1 {
		t.Fatalf("unexpected route counts: %#v", actual)
	}
	if actual.DecisionBoundaryVersion != "difficulty-decision-boundary.semantic-empty-combined-8.2026-07-15.v2" {
		t.Fatalf("decision boundary version = %q", actual.DecisionBoundaryVersion)
	}
	if actual.SemanticStatusRouteMismatches != 0 {
		t.Fatalf("semantic route mismatches = %d", actual.SemanticStatusRouteMismatches)
	}
	encoded, err := json.Marshal(actual)
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) == "" || containsAuditPromptMaterial(string(encoded)) {
		t.Fatalf("audit output leaked prompt material: %s", encoded)
	}
}

func TestBuildDifficultyDecisionAuditAllowsExplicitPendingSyntheticCandidate(t *testing.T) {
	t.Parallel()
	tempDir := t.TempDir()
	datasetPath := filepath.Join(tempDir, "dataset.jsonl")
	manifestPath := filepath.Join(tempDir, "manifest.json")
	record := auditTestRecord("pending", "family.pending", "Summarize this synthetic note.", "simple", "eligible")
	record["labelSource"] = "synthetic_fixture"
	record["reviewStatus"] = "pending"
	record["reviewerCount"] = 0
	encodedRecord, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	dataset := append(encodedRecord, '\n')
	if err := os.WriteFile(datasetPath, dataset, 0o600); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(dataset)
	manifest := map[string]any{
		"schemaVersion":       "gatelm.difficulty-label-dataset-manifest.v2",
		"datasetVersion":      "difficulty_audit_test_v1",
		"recordSchemaVersion": "gatelm.difficulty-label-record.v2",
		"datasetSha256":       hex.EncodeToString(hash[:]),
		"trainingEligible":    false,
		"families": []map[string]any{
			{"promptFamily": "family.pending", "partition": "train", "records": 1},
		},
	}
	encodedManifest, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, encodedManifest, 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := buildDifficultyDecisionAudit(datasetPath, manifestPath); err == nil {
		t.Fatal("approved-only audit accepted a pending candidate")
	}
	actual, err := buildDifficultyDecisionAuditWithOptions(datasetPath, manifestPath, true)
	if err != nil {
		t.Fatal(err)
	}
	if actual.TotalRecords != 1 || actual.ModelPathRecords != 1 {
		t.Fatalf("unexpected pending candidate audit: %#v", actual)
	}
}

func auditTestRecord(sampleID, familyID, prompt, difficulty, semanticStatus string) map[string]any {
	return map[string]any{
		"schemaVersion":       "gatelm.difficulty-label-record.v2",
		"datasetVersion":      "difficulty_audit_test_v1",
		"sampleId":            sampleID,
		"redactedPrompt":      prompt,
		"expectedCategory":    "general",
		"expectedDifficulty":  difficulty,
		"semanticInputStatus": semanticStatus,
		"promptFamily":        familyID,
		"language":            "en",
		"evaluationSlices":    []string{"english"},
		"labelSource":         "human_review",
		"reviewStatus":        "approved",
		"reviewerCount":       1,
	}
}

func containsAuditPromptMaterial(value string) bool {
	return strings.Contains(value, "payload only") || strings.Contains(value, "multiple services") || strings.Contains(value, "oauth")
}
