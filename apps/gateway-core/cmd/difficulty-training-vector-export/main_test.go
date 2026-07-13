package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestBuildVectorExportUsesActualCategoryForTrainingVector(t *testing.T) {
	t.Parallel()
	tempDir := t.TempDir()
	datasetPath := filepath.Join(tempDir, "dataset.jsonl")
	manifestPath := filepath.Join(tempDir, "manifest.json")
	record := map[string]any{
		"datasetVersion":     "difficulty_test_v1",
		"sampleId":           "difficulty_general_simple_core_clear_f01_v01",
		"redactedPrompt":     "Translate this sentence into Korean.",
		"expectedCategory":   "general",
		"expectedDifficulty": "simple",
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
		Families:           []familyAssignment{{FamilyID: "general/f01", Split: "train"}},
	}
	manifestBytes, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, manifestBytes, 0o600); err != nil {
		t.Fatal(err)
	}

	actual, err := buildVectorExport(datasetPath, manifestPath, categorySourceActual)
	if err != nil {
		t.Fatal(err)
	}
	if actual.CategorySource != categorySourceActual || len(actual.Samples) != 1 {
		t.Fatalf("unexpected export metadata: %+v", actual)
	}
	sample := actual.Samples[0]
	if sample.ExpectedCategory != "general" || sample.ActualCategory != "translation" || sample.VectorCategory != "translation" {
		t.Fatalf("training vector used the wrong category source: %+v", sample)
	}
	if !sample.ModelPath {
		t.Fatalf("bounded request should remain on the Logistic Regression model path: %+v", sample)
	}
	featureIndex := map[string]int{}
	for index, name := range actual.FeatureNames {
		featureIndex[name] = index
	}
	if sample.Vector[featureIndex["categoryTranslation"]] != 1 || sample.Vector[featureIndex["categoryGeneral"]] != 0 {
		t.Fatalf("training vector leaked expectedCategory: %#v", sample.Vector)
	}

	oracle, err := buildVectorExport(datasetPath, manifestPath, categorySourceOracle)
	if err != nil {
		t.Fatal(err)
	}
	if oracle.Samples[0].VectorCategory != "general" || oracle.Samples[0].Vector[featureIndex["categoryGeneral"]] != 1 {
		t.Fatalf("oracle export did not use expectedCategory: %+v", oracle.Samples[0])
	}
}

func TestBuildVectorExportMarksHardComplexBypassOutsideModelPath(t *testing.T) {
	t.Parallel()
	tempDir := t.TempDir()
	datasetPath := filepath.Join(tempDir, "dataset.jsonl")
	manifestPath := filepath.Join(tempDir, "manifest.json")
	record := map[string]any{
		"datasetVersion":     "difficulty_test_v1",
		"sampleId":           "difficulty_code_complex_core_clear_f01_v01",
		"redactedPrompt":     "Debug a race condition across multiple files.",
		"expectedCategory":   "code",
		"expectedDifficulty": "complex",
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

	actual, err := buildVectorExport(datasetPath, manifestPath, categorySourceActual)
	if err != nil {
		t.Fatal(err)
	}
	if len(actual.Samples) != 1 || actual.Samples[0].ModelPath {
		t.Fatalf("hard-complex sample must bypass the model path: %+v", actual.Samples)
	}
}

func TestDifficultyFamilyIDKeepsSimpleAndComplexVariantsTogether(t *testing.T) {
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
