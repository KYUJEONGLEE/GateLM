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

func TestBuildSemanticHeadTrainingInputUsesApprovedFamiliesAndInstructionOnly(t *testing.T) {
	t.Parallel()
	records := []map[string]any{
		semanticHeadRecord("sample-train", "family.train", "train", "Summarize this source. ```text\nTranslate the payload.\n```"),
		semanticHeadRecord("sample-calibration", "family.calibration", "calibration", "Explain two constraints."),
		semanticHeadRecord("sample-holdout", "family.holdout", "holdout", "Plan three dependent steps."),
	}
	datasetPath, manifestPath := writeSemanticHeadDataset(t, records, true, false)

	actual, err := buildSemanticHeadTrainingInput(datasetPath, manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if actual.SchemaVersion != "gatelm.difficulty-semantic-head-training-input.v1" {
		t.Fatalf("schemaVersion = %q", actual.SchemaVersion)
	}
	if len(actual.Samples) != 3 || actual.ExcludedEmptyInstructionCount != 0 {
		t.Fatalf("unexpected sample counts: %+v", actual)
	}
	first := actual.Samples[0]
	if first.InstructionText != "summarize this source." {
		t.Fatalf("instructionText = %q", first.InstructionText)
	}
	if strings.Contains(first.InstructionText, "payload") || strings.Contains(first.InstructionText, "translate") {
		t.Fatalf("payload leaked into semantic head input: %q", first.InstructionText)
	}
	if first.TaskBucket != "count_1" || first.ConstraintBucket != "count_0_to_1" ||
		first.ScopeBucket != "count_1" || first.DependencyBucket != "depth_0_to_1" {
		t.Fatalf("semantic head labels changed: %+v", first)
	}
	if first.FamilyID != "family.train" || first.Split != "train" || first.Language != "en" {
		t.Fatalf("safe evaluation metadata missing: %+v", first)
	}
	if actual.SplitPolicyVersion != "difficulty-family-constrained-split.test-v1" || actual.SplitSeed != 1729 {
		t.Fatalf("split provenance missing: %+v", actual)
	}
	if actual.FeatureVersion != "difficulty-feature-vector.v1" || len(actual.FeatureNames) != 42 || len(first.RuleVectorV1) != 42 {
		t.Fatalf("exact 42D candidate material missing: %+v", first)
	}
	if actual.DecisionBoundaryVersion != "difficulty-decision-boundary.semantic-empty-combined-8.2026-07-15.v2" {
		t.Fatalf("decision boundary version = %q", actual.DecisionBoundaryVersion)
	}
	if first.Label != 0 || first.ActualCategory == "" || first.VectorCategory != first.ActualCategory || first.RuleDifficulty == "" {
		t.Fatalf("candidate training metadata missing: %+v", first)
	}
}

func TestBuildSemanticHeadTrainingInputExcludesContractualEmptyInstruction(t *testing.T) {
	t.Parallel()
	records := []map[string]any{
		semanticHeadRecord("sample-train", "family.train", "train", "Explain the result."),
		semanticHeadRecord("sample-calibration", "family.calibration", "calibration", "Compare two options."),
		semanticHeadRecord("sample-holdout", "family.holdout", "holdout", "Summarize one source."),
	}
	empty := semanticHeadRecord("sample-empty", "family.train", "train", "```text\npayload only\n```")
	empty["semanticInputStatus"] = "empty_instruction"
	empty["taskBucket"] = "not_applicable"
	empty["constraintBucket"] = "not_applicable"
	empty["scopeBucket"] = "not_applicable"
	empty["dependencyBucket"] = "not_applicable"
	records = append(records, empty)
	datasetPath, manifestPath := writeSemanticHeadDataset(t, records, true, false)

	actual, err := buildSemanticHeadTrainingInput(datasetPath, manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(actual.Samples) != 3 || actual.ExcludedEmptyInstructionCount != 1 {
		t.Fatalf("empty instruction handling = samples %d excluded %d", len(actual.Samples), actual.ExcludedEmptyInstructionCount)
	}
	if actual.SourceSplitCounts["train"].Records != 2 || actual.SplitCounts["train"].Records != 1 {
		t.Fatalf("source/eligible split counts = %#v / %#v", actual.SourceSplitCounts, actual.SplitCounts)
	}
}

func TestBuildSemanticHeadTrainingInputRejectsUnapprovedDatasetAndSplitLeakage(t *testing.T) {
	t.Parallel()
	records := []map[string]any{
		semanticHeadRecord("sample-train", "family.train", "train", "Explain the result."),
		semanticHeadRecord("sample-calibration", "family.calibration", "calibration", "Compare two options."),
		semanticHeadRecord("sample-holdout", "family.holdout", "holdout", "Summarize one source."),
	}
	datasetPath, manifestPath := writeSemanticHeadDataset(t, records, false, false)
	if _, err := buildSemanticHeadTrainingInput(datasetPath, manifestPath); err == nil || !strings.Contains(err.Error(), "trainingEligible=true") {
		t.Fatalf("unapproved dataset error = %v", err)
	}

	datasetPath, manifestPath = writeSemanticHeadDataset(t, records, true, true)
	if _, err := buildSemanticHeadTrainingInput(datasetPath, manifestPath); err == nil || !strings.Contains(err.Error(), "repeats family") {
		t.Fatalf("split leakage error = %v", err)
	}
}

func TestBuildSemanticHeadTrainingInputRejectsInvalidHeadLabelWithoutFallback(t *testing.T) {
	t.Parallel()
	records := []map[string]any{
		semanticHeadRecord("sample-train", "family.train", "train", "Explain the result."),
		semanticHeadRecord("sample-calibration", "family.calibration", "calibration", "Compare two options."),
		semanticHeadRecord("sample-holdout", "family.holdout", "holdout", "Summarize one source."),
	}
	records[0]["taskBucket"] = "count_0"
	datasetPath, manifestPath := writeSemanticHeadDataset(t, records, true, false)
	if _, err := buildSemanticHeadTrainingInput(datasetPath, manifestPath); err == nil || !strings.Contains(err.Error(), "unsupported semantic head label") {
		t.Fatalf("invalid label error = %v", err)
	}
}

func semanticHeadRecord(sampleID, familyID, _ string, prompt string) map[string]any {
	return map[string]any{
		"schemaVersion":       "gatelm.difficulty-label-record.v2",
		"datasetVersion":      "semantic_head_test_v1",
		"sampleId":            sampleID,
		"redactedPrompt":      prompt,
		"expectedCategory":    "general",
		"expectedDifficulty":  "simple",
		"semanticInputStatus": "eligible",
		"taskBucket":          "count_1",
		"constraintBucket":    "count_0_to_1",
		"scopeBucket":         "count_1",
		"dependencyBucket":    "depth_0_to_1",
		"promptFamily":        familyID,
		"language":            "en",
		"evaluationSlices":    []string{"english"},
		"labelSource":         "human_review",
		"reviewStatus":        "approved",
		"reviewerCount":       1,
	}
}

func writeSemanticHeadDataset(t *testing.T, records []map[string]any, trainingEligible, repeatFamily bool) (string, string) {
	t.Helper()
	tempDir := t.TempDir()
	datasetPath := filepath.Join(tempDir, "dataset.jsonl")
	manifestPath := filepath.Join(tempDir, "manifest.json")
	var dataset []byte
	counts := map[string]int{}
	for _, record := range records {
		encoded, err := json.Marshal(record)
		if err != nil {
			t.Fatal(err)
		}
		dataset = append(dataset, encoded...)
		dataset = append(dataset, '\n')
		counts[record["promptFamily"].(string)]++
	}
	if err := os.WriteFile(datasetPath, dataset, 0o600); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(dataset)
	families := []map[string]any{
		semanticHeadFamily("family.train", "train", counts["family.train"]),
		semanticHeadFamily("family.calibration", "calibration", counts["family.calibration"]),
		semanticHeadFamily("family.holdout", "holdout", counts["family.holdout"]),
	}
	if repeatFamily {
		families = append(families, semanticHeadFamily("family.train", "holdout", 1))
	}
	manifest := map[string]any{
		"schemaVersion":       "gatelm.difficulty-label-dataset-manifest.v2",
		"datasetVersion":      "semantic_head_test_v1",
		"recordSchemaVersion": "gatelm.difficulty-label-record.v2",
		"datasetSha256":       hex.EncodeToString(hash[:]),
		"datasetPurpose":      "training_candidate",
		"trainingEligible":    trainingEligible,
		"labelCoverageStatus": "complete",
		"familyPolicyVersion": "difficulty-prompt-family.v1",
		"splitPolicyVersion":  "difficulty-family-constrained-split.test-v1",
		"splitSeed":           1729,
		"splitCounts": map[string]any{
			"train":       map[string]any{"families": 1, "records": counts["family.train"]},
			"calibration": map[string]any{"families": 1, "records": counts["family.calibration"]},
			"holdout":     map[string]any{"families": 1, "records": counts["family.holdout"]},
		},
		"trainingGate": map[string]any{"minimumFamilyPolicyStatus": "versioned", "policyVersion": "test-policy-v1"},
		"families":     families,
	}
	encodedManifest, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, encodedManifest, 0o600); err != nil {
		t.Fatal(err)
	}
	return datasetPath, manifestPath
}

func semanticHeadFamily(familyID, partition string, records int) map[string]any {
	return map[string]any{
		"promptFamily":          familyID,
		"expectedCategory":      "general",
		"expectedSemanticLabel": "general_explanation",
		"reviewStatus":          "approved",
		"humanReviewed":         true,
		"partition":             partition,
		"records":               records,
	}
}
