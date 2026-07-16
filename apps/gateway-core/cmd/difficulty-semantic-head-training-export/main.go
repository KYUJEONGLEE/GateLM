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
	"strings"

	"gatelm/apps/gateway-core/internal/domain/routing"
)

const (
	defaultLabelDatasetPath  = "docs/v2.1.0/fixtures/difficulty-label-contract-smoke.fixture.jsonl"
	defaultLabelManifestPath = "docs/v2.1.0/fixtures/difficulty-label-contract-smoke.manifest.json"
)

type semanticHeadDatasetRecord struct {
	SchemaVersion       string   `json:"schemaVersion"`
	DatasetVersion      string   `json:"datasetVersion"`
	SampleID            string   `json:"sampleId"`
	RedactedPrompt      string   `json:"redactedPrompt"`
	ExpectedCategory    string   `json:"expectedCategory"`
	ExpectedDifficulty  string   `json:"expectedDifficulty"`
	SemanticInputStatus string   `json:"semanticInputStatus"`
	TaskBucket          string   `json:"taskBucket"`
	ConstraintBucket    string   `json:"constraintBucket"`
	ScopeBucket         string   `json:"scopeBucket"`
	DependencyBucket    string   `json:"dependencyBucket"`
	PromptFamily        string   `json:"promptFamily"`
	Language            string   `json:"language"`
	EvaluationSlices    []string `json:"evaluationSlices"`
	LabelSource         string   `json:"labelSource"`
	ReviewStatus        string   `json:"reviewStatus"`
	ReviewerCount       int      `json:"reviewerCount"`
}

type semanticHeadDatasetManifest struct {
	SchemaVersion       string                        `json:"schemaVersion"`
	DatasetVersion      string                        `json:"datasetVersion"`
	RecordSchemaVersion string                        `json:"recordSchemaVersion"`
	DatasetSHA256       string                        `json:"datasetSha256"`
	DatasetPurpose      string                        `json:"datasetPurpose"`
	TrainingEligible    bool                          `json:"trainingEligible"`
	LabelCoverageStatus string                        `json:"labelCoverageStatus"`
	FamilyPolicyVersion string                        `json:"familyPolicyVersion"`
	SplitPolicyVersion  string                        `json:"splitPolicyVersion"`
	SplitSeed           int                           `json:"splitSeed"`
	SplitCounts         map[string]semanticSplitCount `json:"splitCounts"`
	TrainingGate        semanticHeadTrainingGate      `json:"trainingGate"`
	Families            []semanticHeadManifestFamily  `json:"families"`
}

type semanticSplitCount struct {
	Families int `json:"families"`
	Records  int `json:"records"`
}

type semanticHeadTrainingGate struct {
	MinimumFamilyPolicyStatus string `json:"minimumFamilyPolicyStatus"`
	PolicyVersion             string `json:"policyVersion"`
}

type semanticHeadManifestFamily struct {
	PromptFamily  string `json:"promptFamily"`
	ReviewStatus  string `json:"reviewStatus"`
	HumanReviewed bool   `json:"humanReviewed"`
	Partition     string `json:"partition"`
	Records       int    `json:"records"`
}

type semanticHeadSpec struct {
	Name    string   `json:"name"`
	Classes []string `json:"classes"`
}

type semanticHeadTrainingInput struct {
	SchemaVersion                 string                            `json:"schemaVersion"`
	DatasetVersion                string                            `json:"datasetVersion"`
	DatasetSHA256                 string                            `json:"datasetSha256"`
	ManifestSHA256                string                            `json:"manifestSha256"`
	FamilyPolicyVersion           string                            `json:"familyPolicyVersion"`
	FamilyPolicy                  string                            `json:"familyPolicy"`
	SplitPolicyVersion            string                            `json:"splitPolicyVersion"`
	SplitSeed                     int                               `json:"splitSeed"`
	SourceSplitCounts             map[string]semanticSplitCount     `json:"sourceSplitCounts"`
	SplitCounts                   map[string]semanticSplitCount     `json:"splitCounts"`
	FeatureVersion                string                            `json:"featureVersion"`
	FeatureNames                  []string                          `json:"featureNames"`
	DecisionBoundaryVersion       string                            `json:"decisionBoundaryVersion"`
	CategorySource                string                            `json:"categorySource"`
	SemanticHeads                 []semanticHeadSpec                `json:"semanticHeads"`
	ExcludedEmptyInstructionCount int                               `json:"excludedEmptyInstructionCount"`
	Samples                       []semanticHeadTrainingInputSample `json:"samples"`
}

type semanticHeadTrainingInputSample struct {
	SampleID           string    `json:"sampleId"`
	FamilyID           string    `json:"familyId"`
	Split              string    `json:"split"`
	Label              int       `json:"label"`
	ExpectedCategory   string    `json:"expectedCategory"`
	ActualCategory     string    `json:"actualCategory"`
	VectorCategory     string    `json:"vectorCategory"`
	ExpectedDifficulty string    `json:"expectedDifficulty"`
	RuleDifficulty     string    `json:"ruleDifficulty"`
	ModelPath          bool      `json:"modelPath"`
	RuleVectorV1       []float64 `json:"ruleVectorV1"`
	Language           string    `json:"language"`
	EvaluationSlices   []string  `json:"evaluationSlices"`
	InstructionText    string    `json:"instructionText"`
	TaskBucket         string    `json:"taskBucket"`
	ConstraintBucket   string    `json:"constraintBucket"`
	ScopeBucket        string    `json:"scopeBucket"`
	DependencyBucket   string    `json:"dependencyBucket"`
}

var fixedSemanticHeadSpecs = []semanticHeadSpec{
	{Name: "semanticTaskBucket", Classes: []string{"count_1", "count_2", "count_3_plus"}},
	{Name: "semanticConstraintBucket", Classes: []string{"count_0_to_1", "count_2", "count_3_plus"}},
	{Name: "semanticScopeBucket", Classes: []string{"count_1", "count_2_to_3", "count_4_plus"}},
	{Name: "semanticDependencyBucket", Classes: []string{"depth_0_to_1", "depth_2", "depth_3_plus"}},
}

func main() {
	datasetPath := flag.String("dataset", defaultLabelDatasetPath, "approved difficulty label dataset JSONL")
	manifestPath := flag.String("manifest", defaultLabelManifestPath, "training-eligible difficulty label manifest")
	flag.Parse()

	export, err := buildSemanticHeadTrainingInput(*datasetPath, *manifestPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(export); err != nil {
		fmt.Fprintln(os.Stderr, "encode semantic head training input:", err)
		os.Exit(1)
	}
}

func buildSemanticHeadTrainingInput(datasetPath string, manifestPath string) (semanticHeadTrainingInput, error) {
	datasetBytes, err := os.ReadFile(datasetPath)
	if err != nil {
		return semanticHeadTrainingInput{}, fmt.Errorf("read semantic head dataset: %w", err)
	}
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		return semanticHeadTrainingInput{}, fmt.Errorf("read semantic head manifest: %w", err)
	}
	var manifest semanticHeadDatasetManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return semanticHeadTrainingInput{}, fmt.Errorf("decode semantic head manifest: %w", err)
	}
	if err := validateSemanticHeadManifest(manifest); err != nil {
		return semanticHeadTrainingInput{}, err
	}
	hash := sha256.Sum256(datasetBytes)
	datasetSHA256 := hex.EncodeToString(hash[:])
	if manifest.DatasetSHA256 != datasetSHA256 {
		return semanticHeadTrainingInput{}, errors.New("semantic head dataset hash does not match manifest")
	}
	manifestHash := sha256.Sum256(manifestBytes)
	manifestSHA256 := hex.EncodeToString(manifestHash[:])

	partitions := make(map[string]string, len(manifest.Families))
	expectedRecords := make(map[string]int, len(manifest.Families))
	for _, family := range manifest.Families {
		if family.PromptFamily == "" || family.Records <= 0 || !validPartition(family.Partition) {
			return semanticHeadTrainingInput{}, errors.New("semantic head manifest contains an invalid family")
		}
		if family.ReviewStatus != "approved" || !family.HumanReviewed {
			return semanticHeadTrainingInput{}, fmt.Errorf("semantic head manifest family %q is not human-approved", family.PromptFamily)
		}
		if _, exists := partitions[family.PromptFamily]; exists {
			return semanticHeadTrainingInput{}, fmt.Errorf("semantic head manifest repeats family %q across partitions", family.PromptFamily)
		}
		partitions[family.PromptFamily] = family.Partition
		expectedRecords[family.PromptFamily] = family.Records
	}

	result := semanticHeadTrainingInput{
		SchemaVersion:           "gatelm.difficulty-semantic-head-training-input.v1",
		DatasetVersion:          manifest.DatasetVersion,
		DatasetSHA256:           datasetSHA256,
		ManifestSHA256:          manifestSHA256,
		FamilyPolicyVersion:     manifest.FamilyPolicyVersion,
		FamilyPolicy:            manifest.TrainingGate.PolicyVersion,
		SplitPolicyVersion:      manifest.SplitPolicyVersion,
		SplitSeed:               manifest.SplitSeed,
		SourceSplitCounts:       cloneSemanticSplitCounts(manifest.SplitCounts),
		SplitCounts:             make(map[string]semanticSplitCount, len(manifest.SplitCounts)),
		FeatureVersion:          routing.DifficultyFeatureVectorVersionV1,
		FeatureNames:            routing.DifficultyFeatureNamesV1(),
		DecisionBoundaryVersion: routing.DifficultyDecisionBoundaryVersion,
		CategorySource:          "actual",
		SemanticHeads:           fixedSemanticHeadSpecs,
		Samples:                 make([]semanticHeadTrainingInputSample, 0),
	}
	actualRecords := make(map[string]int, len(manifest.Families))
	rawByPartition := map[string]int{"train": 0, "calibration": 0, "holdout": 0}
	eligibleByPartition := map[string]int{"train": 0, "calibration": 0, "holdout": 0}
	eligibleFamiliesByPartition := map[string]map[string]struct{}{
		"train":       {},
		"calibration": {},
		"holdout":     {},
	}
	categoryClassifier := routing.NewRuleBasedCategoryClassifier()
	difficultyClassifier := routing.NewRuleBasedDifficultyClassifier()
	scanner := bufio.NewScanner(bytes.NewReader(datasetBytes))
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for lineNumber := 1; scanner.Scan(); lineNumber++ {
		if strings.TrimSpace(scanner.Text()) == "" {
			continue
		}
		var record semanticHeadDatasetRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			return semanticHeadTrainingInput{}, fmt.Errorf("decode semantic head record line %d: %w", lineNumber, err)
		}
		if record.SchemaVersion != "gatelm.difficulty-label-record.v2" || record.DatasetVersion != manifest.DatasetVersion {
			return semanticHeadTrainingInput{}, fmt.Errorf("semantic head record line %d has an unsupported schema or dataset version", lineNumber)
		}
		partition, exists := partitions[record.PromptFamily]
		if !exists {
			return semanticHeadTrainingInput{}, fmt.Errorf("semantic head record line %d has no manifest family", lineNumber)
		}
		actualRecords[record.PromptFamily]++
		rawByPartition[partition]++
		if record.LabelSource != "human_review" || record.ReviewStatus != "approved" || record.ReviewerCount < 1 {
			return semanticHeadTrainingInput{}, fmt.Errorf("semantic head record line %d is not human-approved", lineNumber)
		}
		if !validLanguage(record.Language) || len(record.EvaluationSlices) == 0 {
			return semanticHeadTrainingInput{}, fmt.Errorf("semantic head record line %d has invalid evaluation metadata", lineNumber)
		}
		features := routing.ExtractPromptFeatures(record.RedactedPrompt)
		instructionText, semanticInputAvailable := routing.DifficultySemanticInputForOffline(features)
		switch record.SemanticInputStatus {
		case "empty_instruction":
			if record.TaskBucket != "not_applicable" || record.ConstraintBucket != "not_applicable" ||
				record.ScopeBucket != "not_applicable" || record.DependencyBucket != "not_applicable" {
				return semanticHeadTrainingInput{}, fmt.Errorf("semantic head record line %d has invalid empty-instruction labels", lineNumber)
			}
			if semanticInputAvailable {
				return semanticHeadTrainingInput{}, fmt.Errorf("semantic head record line %d declares empty instruction but extraction found semantic input", lineNumber)
			}
			actualCategory := categoryClassifier.ClassifyFeatures(features).Category
			difficultyFeatures := routing.ExtractDifficultyFeatures(features, actualCategory)
			if evidence := routing.DifficultyDecisionEvidenceForOffline(difficultyFeatures); evidence.Route != routing.DifficultyDecisionRouteSimpleSentinel {
				return semanticHeadTrainingInput{}, fmt.Errorf("semantic head record line %d does not use the simple sentinel", lineNumber)
			}
			result.ExcludedEmptyInstructionCount++
			continue
		case "eligible":
			if !validHeadLabel(record.TaskBucket, fixedSemanticHeadSpecs[0].Classes) ||
				!validHeadLabel(record.ConstraintBucket, fixedSemanticHeadSpecs[1].Classes) ||
				!validHeadLabel(record.ScopeBucket, fixedSemanticHeadSpecs[2].Classes) ||
				!validHeadLabel(record.DependencyBucket, fixedSemanticHeadSpecs[3].Classes) {
				return semanticHeadTrainingInput{}, fmt.Errorf("semantic head record line %d has an unsupported semantic head label", lineNumber)
			}
		default:
			return semanticHeadTrainingInput{}, fmt.Errorf("semantic head record line %d has an unsupported semantic input status", lineNumber)
		}

		if !semanticInputAvailable {
			return semanticHeadTrainingInput{}, fmt.Errorf("semantic head record line %d has no semantic instruction input", lineNumber)
		}
		actualCategory := categoryClassifier.ClassifyFeatures(features).Category
		difficultyFeatures := routing.ExtractDifficultyFeatures(features, actualCategory)
		label := 0
		if record.ExpectedDifficulty == routing.DifficultyComplex {
			label = 1
		} else if record.ExpectedDifficulty != routing.DifficultySimple {
			return semanticHeadTrainingInput{}, fmt.Errorf("semantic head record line %d has an unsupported difficulty label", lineNumber)
		}
		result.Samples = append(result.Samples, semanticHeadTrainingInputSample{
			SampleID:           record.SampleID,
			FamilyID:           record.PromptFamily,
			Split:              partition,
			Label:              label,
			ExpectedCategory:   record.ExpectedCategory,
			ActualCategory:     actualCategory,
			VectorCategory:     actualCategory,
			ExpectedDifficulty: record.ExpectedDifficulty,
			RuleDifficulty:     difficultyClassifier.ClassifyFeatures(difficultyFeatures).Difficulty,
			ModelPath:          routing.UsesDifficultyModelPath(difficultyFeatures),
			RuleVectorV1:       routing.VectorizeDifficultyFeaturesV1(difficultyFeatures),
			Language:           record.Language,
			EvaluationSlices:   append([]string(nil), record.EvaluationSlices...),
			InstructionText:    instructionText,
			TaskBucket:         record.TaskBucket,
			ConstraintBucket:   record.ConstraintBucket,
			ScopeBucket:        record.ScopeBucket,
			DependencyBucket:   record.DependencyBucket,
		})
		eligibleByPartition[partition]++
		eligibleFamiliesByPartition[partition][record.PromptFamily] = struct{}{}
	}
	if err := scanner.Err(); err != nil {
		return semanticHeadTrainingInput{}, fmt.Errorf("read semantic head dataset: %w", err)
	}
	for familyID, expected := range expectedRecords {
		if actualRecords[familyID] != expected {
			return semanticHeadTrainingInput{}, fmt.Errorf("semantic head family %q record count does not match manifest", familyID)
		}
	}
	for _, partition := range []string{"train", "calibration", "holdout"} {
		declared := manifest.SplitCounts[partition]
		if rawByPartition[partition] != declared.Records {
			return semanticHeadTrainingInput{}, fmt.Errorf("semantic head %s record count does not match manifest", partition)
		}
		familyCount := 0
		for _, family := range manifest.Families {
			if family.Partition == partition {
				familyCount++
			}
		}
		if familyCount != declared.Families {
			return semanticHeadTrainingInput{}, fmt.Errorf("semantic head %s family count does not match manifest", partition)
		}
		if eligibleByPartition[partition] == 0 {
			return semanticHeadTrainingInput{}, fmt.Errorf("semantic head dataset has no eligible %s samples", partition)
		}
		result.SplitCounts[partition] = semanticSplitCount{
			Families: len(eligibleFamiliesByPartition[partition]),
			Records:  eligibleByPartition[partition],
		}
	}
	return result, nil
}

func cloneSemanticSplitCounts(source map[string]semanticSplitCount) map[string]semanticSplitCount {
	clone := make(map[string]semanticSplitCount, len(source))
	for partition, count := range source {
		clone[partition] = count
	}
	return clone
}

func validateSemanticHeadManifest(manifest semanticHeadDatasetManifest) error {
	if manifest.SchemaVersion != "gatelm.difficulty-label-dataset-manifest.v2" ||
		manifest.RecordSchemaVersion != "gatelm.difficulty-label-record.v2" {
		return errors.New("unsupported semantic head dataset manifest schema")
	}
	if !manifest.TrainingEligible {
		return errors.New("semantic head training requires manifest trainingEligible=true")
	}
	if manifest.DatasetPurpose != "training_candidate" || manifest.LabelCoverageStatus != "complete" {
		return errors.New("semantic head training requires a complete training_candidate dataset")
	}
	if manifest.FamilyPolicyVersion != "difficulty-prompt-family.v1" ||
		manifest.TrainingGate.MinimumFamilyPolicyStatus != "versioned" ||
		strings.TrimSpace(manifest.TrainingGate.PolicyVersion) == "" {
		return errors.New("semantic head training requires a versioned family coverage policy")
	}
	if strings.TrimSpace(manifest.SplitPolicyVersion) == "" || manifest.SplitSeed <= 0 {
		return errors.New("semantic head training requires a versioned deterministic split policy")
	}
	if len(manifest.SplitCounts) != 3 {
		return errors.New("semantic head training requires train, calibration, and holdout split counts")
	}
	for _, partition := range []string{"train", "calibration", "holdout"} {
		count, ok := manifest.SplitCounts[partition]
		if !ok || count.Families <= 0 || count.Records <= 0 {
			return errors.New("semantic head training manifest contains invalid split counts")
		}
	}
	if manifest.DatasetVersion == "" || len(manifest.Families) == 0 {
		return errors.New("semantic head manifest is missing dataset or family material")
	}
	return nil
}

func validPartition(value string) bool {
	return value == "train" || value == "calibration" || value == "holdout"
}

func validLanguage(value string) bool {
	return value == "ko" || value == "en" || value == "mixed" || value == "unknown"
}

func validHeadLabel(value string, classes []string) bool {
	for _, className := range classes {
		if value == className {
			return true
		}
	}
	return false
}
