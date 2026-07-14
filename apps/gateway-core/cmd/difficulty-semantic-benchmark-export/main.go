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
	defaultDatasetPath  = "docs/v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl"
	defaultManifestPath = "docs/v2.1.0/fixtures/difficulty-training-split-manifest.v1.json"
)

var sampleFamilyPattern = regexp.MustCompile(`^difficulty_(general|code|translation|summarization|reasoning)_(?:simple|complex)_.+_(f\d{2})_v\d{2}$`)

type datasetRecord struct {
	DatasetVersion     string `json:"datasetVersion"`
	SampleID           string `json:"sampleId"`
	RedactedPrompt     string `json:"redactedPrompt"`
	ExpectedCategory   string `json:"expectedCategory"`
	ExpectedDifficulty string `json:"expectedDifficulty"`
	Language           string `json:"language"`
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

type benchmarkInput struct {
	SchemaVersion      string                 `json:"schemaVersion"`
	DatasetVersion     string                 `json:"datasetVersion"`
	DatasetSHA256      string                 `json:"datasetSha256"`
	SplitPolicyVersion string                 `json:"splitPolicyVersion"`
	FamilyRuleVersion  string                 `json:"familyRuleVersion"`
	Samples            []benchmarkInputSample `json:"samples"`
}

type benchmarkInputSample struct {
	SampleID           string `json:"sampleId"`
	FamilyID           string `json:"familyId"`
	Split              string `json:"split"`
	Label              int    `json:"label"`
	ExpectedCategory   string `json:"expectedCategory"`
	ExpectedDifficulty string `json:"expectedDifficulty"`
	ActualCategory     string `json:"actualCategory"`
	RuleDifficulty     string `json:"ruleDifficulty"`
	Language           string `json:"language"`
	InstructionText    string `json:"instructionText"`
}

func main() {
	datasetPath := flag.String("dataset", defaultDatasetPath, "synthetic or approved redacted difficulty JSONL dataset")
	manifestPath := flag.String("split-manifest", defaultManifestPath, "versioned family split manifest")
	flag.Parse()

	export, err := buildBenchmarkInput(*datasetPath, *manifestPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(export); err != nil {
		fmt.Fprintln(os.Stderr, "encode semantic benchmark input:", err)
		os.Exit(1)
	}
}

func buildBenchmarkInput(datasetPath string, manifestPath string) (benchmarkInput, error) {
	datasetBytes, err := os.ReadFile(datasetPath)
	if err != nil {
		return benchmarkInput{}, fmt.Errorf("read difficulty dataset: %w", err)
	}
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		return benchmarkInput{}, fmt.Errorf("read split manifest: %w", err)
	}
	var manifest splitManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return benchmarkInput{}, fmt.Errorf("decode split manifest: %w", err)
	}
	if manifest.SchemaVersion != "gatelm.difficulty-training-split-manifest.v1" {
		return benchmarkInput{}, fmt.Errorf("unsupported split manifest schema %q", manifest.SchemaVersion)
	}
	hash := sha256.Sum256(datasetBytes)
	datasetSHA256 := hex.EncodeToString(hash[:])
	if manifest.DatasetSHA256 != datasetSHA256 {
		return benchmarkInput{}, errors.New("difficulty dataset hash does not match split manifest")
	}
	assignments := make(map[string]string, len(manifest.Families))
	for _, assignment := range manifest.Families {
		if assignment.FamilyID == "" || (assignment.Split != "train" && assignment.Split != "calibration" && assignment.Split != "holdout") {
			return benchmarkInput{}, errors.New("split manifest contains an invalid family assignment")
		}
		if _, exists := assignments[assignment.FamilyID]; exists {
			return benchmarkInput{}, fmt.Errorf("split manifest repeats family %q", assignment.FamilyID)
		}
		assignments[assignment.FamilyID] = assignment.Split
	}

	result := benchmarkInput{
		SchemaVersion:      "gatelm.difficulty-semantic-benchmark-input.v1",
		DatasetVersion:     manifest.DatasetVersion,
		DatasetSHA256:      datasetSHA256,
		SplitPolicyVersion: manifest.SplitPolicyVersion,
		FamilyRuleVersion:  manifest.FamilyRuleVersion,
		Samples:            make([]benchmarkInputSample, 0, 500),
	}
	categoryClassifier := routing.NewRuleBasedCategoryClassifier()
	difficultyClassifier := routing.NewRuleBasedDifficultyClassifier()
	seenFamilies := make(map[string]bool, len(assignments))
	scanner := bufio.NewScanner(bytes.NewReader(datasetBytes))
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for lineNumber := 1; scanner.Scan(); lineNumber++ {
		if strings.TrimSpace(scanner.Text()) == "" {
			continue
		}
		var record datasetRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			return benchmarkInput{}, fmt.Errorf("decode difficulty record line %d: %w", lineNumber, err)
		}
		if record.DatasetVersion != manifest.DatasetVersion {
			return benchmarkInput{}, fmt.Errorf("record line %d has an unexpected dataset version", lineNumber)
		}
		familyID, err := difficultyFamilyID(record.SampleID)
		if err != nil {
			return benchmarkInput{}, fmt.Errorf("record line %d: %w", lineNumber, err)
		}
		split, ok := assignments[familyID]
		if !ok {
			return benchmarkInput{}, fmt.Errorf("record line %d has no split assignment", lineNumber)
		}
		label := -1
		switch record.ExpectedDifficulty {
		case routing.DifficultySimple:
			label = 0
		case routing.DifficultyComplex:
			label = 1
		default:
			return benchmarkInput{}, fmt.Errorf("record line %d has an unsupported difficulty label", lineNumber)
		}
		features := routing.ExtractPromptFeatures(record.RedactedPrompt)
		instructionText, available := routing.DifficultySemanticInputForOffline(features)
		if !available {
			return benchmarkInput{}, fmt.Errorf("record line %d has no semantic instruction input", lineNumber)
		}
		actualCategory := categoryClassifier.ClassifyFeatures(features).Category
		difficultyFeatures := routing.ExtractDifficultyFeatures(features, actualCategory)
		result.Samples = append(result.Samples, benchmarkInputSample{
			SampleID:           record.SampleID,
			FamilyID:           familyID,
			Split:              split,
			Label:              label,
			ExpectedCategory:   record.ExpectedCategory,
			ExpectedDifficulty: record.ExpectedDifficulty,
			ActualCategory:     actualCategory,
			RuleDifficulty:     difficultyClassifier.ClassifyFeatures(difficultyFeatures).Difficulty,
			Language:           record.Language,
			InstructionText:    instructionText,
		})
		seenFamilies[familyID] = true
	}
	if err := scanner.Err(); err != nil {
		return benchmarkInput{}, fmt.Errorf("read difficulty dataset: %w", err)
	}
	if len(result.Samples) == 0 {
		return benchmarkInput{}, errors.New("difficulty dataset is empty")
	}
	for familyID := range assignments {
		if !seenFamilies[familyID] {
			return benchmarkInput{}, fmt.Errorf("split manifest family %q has no dataset samples", familyID)
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
