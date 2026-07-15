package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"regexp"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/routing"
)

const (
	defaultDatasetPath   = "docs/v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl"
	defaultManifestPath  = "docs/v2.1.0/fixtures/difficulty-training-split-manifest.v1.json"
	categorySourceActual = "actual"
	categorySourceOracle = "oracle"
)

var sampleFamilyPattern = regexp.MustCompile(`^difficulty_(general|code|translation|summarization|reasoning)_(?:simple|complex)_.+_(f\d{2})_v\d{2}$`)

type datasetRecord struct {
	DatasetVersion     string `json:"datasetVersion"`
	SampleID           string `json:"sampleId"`
	RedactedPrompt     string `json:"redactedPrompt"`
	ExpectedCategory   string `json:"expectedCategory"`
	ExpectedDifficulty string `json:"expectedDifficulty"`
}

type splitManifest struct {
	SchemaVersion      string             `json:"schemaVersion"`
	DatasetVersion     string             `json:"datasetVersion"`
	DatasetSHA256      string             `json:"datasetSha256"`
	SplitPolicyVersion string             `json:"splitPolicyVersion"`
	FamilyRuleVersion  string             `json:"familyRuleVersion"`
	Families           []familyAssignment `json:"families"`
}

type familyAssignment struct {
	FamilyID string `json:"familyId"`
	Split    string `json:"split"`
}

type vectorExport struct {
	SchemaVersion           string               `json:"schemaVersion"`
	DatasetVersion          string               `json:"datasetVersion"`
	DatasetSHA256           string               `json:"datasetSha256"`
	SplitPolicyVersion      string               `json:"splitPolicyVersion"`
	FamilyRuleVersion       string               `json:"familyRuleVersion"`
	FeatureVersion          string               `json:"featureVersion"`
	FeatureNames            []string             `json:"featureNames"`
	DecisionBoundaryVersion string               `json:"decisionBoundaryVersion"`
	CategorySource          string               `json:"categorySource"`
	Samples                 []vectorExportSample `json:"samples"`
}

type vectorExportSample struct {
	SampleID           string    `json:"sampleId"`
	FamilyID           string    `json:"familyId"`
	Split              string    `json:"split"`
	Label              int       `json:"label"`
	ExpectedCategory   string    `json:"expectedCategory"`
	ActualCategory     string    `json:"actualCategory"`
	VectorCategory     string    `json:"vectorCategory"`
	ExpectedDifficulty string    `json:"expectedDifficulty"`
	ModelPath          bool      `json:"modelPath"`
	Vector             []float64 `json:"vector"`
}

func main() {
	datasetPath := flag.String("dataset", defaultDatasetPath, "approved redacted difficulty JSONL dataset")
	manifestPath := flag.String("split-manifest", defaultManifestPath, "versioned family split manifest")
	categorySource := flag.String("category-source", categorySourceActual, "vector category source: actual or oracle")
	flag.Parse()

	export, err := buildVectorExport(*datasetPath, *manifestPath, *categorySource)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(export); err != nil {
		fmt.Fprintln(os.Stderr, "encode vector export:", err)
		os.Exit(1)
	}
}

func buildVectorExport(datasetPath string, manifestPath string, categorySource string) (vectorExport, error) {
	if categorySource != categorySourceActual && categorySource != categorySourceOracle {
		return vectorExport{}, fmt.Errorf("unsupported category source %q", categorySource)
	}
	datasetBytes, err := os.ReadFile(datasetPath)
	if err != nil {
		return vectorExport{}, fmt.Errorf("read difficulty dataset: %w", err)
	}
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		return vectorExport{}, fmt.Errorf("read split manifest: %w", err)
	}
	var manifest splitManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return vectorExport{}, fmt.Errorf("decode split manifest: %w", err)
	}
	if manifest.SchemaVersion != "gatelm.difficulty-training-split-manifest.v1" {
		return vectorExport{}, fmt.Errorf("unsupported split manifest schema %q", manifest.SchemaVersion)
	}
	datasetHash := sha256.Sum256(datasetBytes)
	datasetSHA256 := hex.EncodeToString(datasetHash[:])
	if manifest.DatasetSHA256 != datasetSHA256 {
		return vectorExport{}, errors.New("difficulty dataset hash does not match split manifest")
	}
	assignments := make(map[string]string, len(manifest.Families))
	for _, assignment := range manifest.Families {
		if assignment.FamilyID == "" || (assignment.Split != "train" && assignment.Split != "calibration" && assignment.Split != "holdout") {
			return vectorExport{}, errors.New("split manifest contains an invalid family assignment")
		}
		if _, exists := assignments[assignment.FamilyID]; exists {
			return vectorExport{}, fmt.Errorf("split manifest repeats family %q", assignment.FamilyID)
		}
		assignments[assignment.FamilyID] = assignment.Split
	}

	result := vectorExport{
		SchemaVersion:           "gatelm.difficulty-training-vector-export.v1",
		DatasetVersion:          manifest.DatasetVersion,
		DatasetSHA256:           datasetSHA256,
		SplitPolicyVersion:      manifest.SplitPolicyVersion,
		FamilyRuleVersion:       manifest.FamilyRuleVersion,
		FeatureVersion:          routing.DifficultyFeatureVectorVersionV1,
		FeatureNames:            routing.DifficultyFeatureNamesV1(),
		DecisionBoundaryVersion: routing.DifficultyDecisionBoundaryVersion,
		CategorySource:          categorySource,
		Samples:                 make([]vectorExportSample, 0, 500),
	}
	categoryClassifier := routing.NewRuleBasedCategoryClassifier()
	scanner := bufio.NewScanner(bytes.NewReader(datasetBytes))
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	seenFamilies := map[string]bool{}
	for lineNumber := 1; scanner.Scan(); lineNumber++ {
		if strings.TrimSpace(scanner.Text()) == "" {
			continue
		}
		var record datasetRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			return vectorExport{}, fmt.Errorf("decode difficulty record line %d: %w", lineNumber, err)
		}
		if record.DatasetVersion != manifest.DatasetVersion {
			return vectorExport{}, fmt.Errorf("record line %d has an unexpected dataset version", lineNumber)
		}
		label := -1
		switch record.ExpectedDifficulty {
		case routing.DifficultySimple:
			label = 0
		case routing.DifficultyComplex:
			label = 1
		default:
			return vectorExport{}, fmt.Errorf("record line %d has an unsupported difficulty label", lineNumber)
		}
		familyID, err := difficultyFamilyID(record.SampleID)
		if err != nil {
			return vectorExport{}, fmt.Errorf("record line %d: %w", lineNumber, err)
		}
		split, ok := assignments[familyID]
		if !ok {
			return vectorExport{}, fmt.Errorf("record line %d has no split assignment", lineNumber)
		}
		seenFamilies[familyID] = true
		promptFeatures := routing.ExtractPromptFeatures(record.RedactedPrompt)
		actualCategory := categoryClassifier.ClassifyFeatures(promptFeatures).Category
		vectorCategory := actualCategory
		if categorySource == categorySourceOracle {
			vectorCategory = record.ExpectedCategory
		}
		difficultyFeatures := routing.ExtractDifficultyFeatures(promptFeatures, vectorCategory)
		result.Samples = append(result.Samples, vectorExportSample{
			SampleID:           record.SampleID,
			FamilyID:           familyID,
			Split:              split,
			Label:              label,
			ExpectedCategory:   record.ExpectedCategory,
			ActualCategory:     actualCategory,
			VectorCategory:     vectorCategory,
			ExpectedDifficulty: record.ExpectedDifficulty,
			ModelPath:          routing.UsesDifficultyModelPath(difficultyFeatures),
			Vector:             routing.VectorizeDifficultyFeaturesV1(difficultyFeatures),
		})
	}
	if err := scanner.Err(); err != nil {
		return vectorExport{}, fmt.Errorf("read difficulty dataset: %w", err)
	}
	if len(result.Samples) == 0 {
		return vectorExport{}, errors.New("difficulty dataset is empty")
	}
	for familyID := range assignments {
		if !seenFamilies[familyID] {
			return vectorExport{}, fmt.Errorf("split manifest family %q has no dataset samples", familyID)
		}
	}
	return result, nil
}

func difficultyFamilyID(sampleID string) (string, error) {
	match := sampleFamilyPattern.FindStringSubmatch(sampleID)
	if len(match) != 3 {
		return "", errors.New("sampleId does not match difficulty family contract")
	}
	return match[1] + "/" + match[2], nil
}
