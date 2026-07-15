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

const promotionHoldoutInputSchema = "gatelm.difficulty-promotion-holdout-input.v1"

type promotionFreeze struct {
	SchemaVersion string `json:"schemaVersion"`
	Status        string `json:"status"`
	Source        struct {
		DatasetVersion   string `json:"datasetVersion"`
		DatasetSHA256    string `json:"datasetSha256"`
		ManifestSHA256   string `json:"manifestSha256"`
		SplitPolicy      string `json:"splitPolicyVersion"`
		SplitSeed        int    `json:"splitSeed"`
		SourceFamilies   int    `json:"sourceHoldoutFamilies"`
		SourceRecords    int    `json:"sourceHoldoutRecords"`
		PreviousOverlap  int    `json:"overlapWithPreviouslyObservedDatasetFamilies"`
		ConsumedOverlap  int    `json:"overlapWithConsumedHoldoutFamilies"`
		ExcludedConsumed int    `json:"excludedConsumedFamilies"`
	} `json:"source"`
	Selection struct {
		PolicyVersion    string `json:"policyVersion"`
		ScoreIndependent bool   `json:"scoreIndependent"`
		SelectedFamilies int    `json:"selectedFamilies"`
		SelectedRecords  int    `json:"selectedRecords"`
		MembershipHash   string `json:"membershipHash"`
	} `json:"selection"`
	Artifact struct {
		ArtifactVersion        string  `json:"artifactVersion"`
		BundleVersion          string  `json:"bundleVersion,omitempty"`
		BundleHash             string  `json:"bundleHash"`
		ContentHash            string  `json:"contentHash"`
		ArtifactFileSHA256     string  `json:"artifactFileSha256,omitempty"`
		ThresholdPolicyVersion string  `json:"thresholdPolicyVersion"`
		Threshold              float64 `json:"threshold"`
		TotalDimension         int     `json:"totalDimension"`
	} `json:"artifact"`
	Gates struct {
		MinimumAccuracy             float64 `json:"minimumAccuracy"`
		MaximumComplexToSimpleCount int     `json:"maximumComplexToSimpleCount"`
		CategoryPolicy              string  `json:"categoryDirectionalErrorPolicy"`
	} `json:"gatesFrozenBeforeEvaluation"`
	SelectedFamilies []struct {
		PromptFamily     string `json:"promptFamily"`
		ExpectedCategory string `json:"expectedCategory"`
		Records          int    `json:"records"`
	} `json:"selectedFamilies"`
	Samples []promotionFreezeSample `json:"samples"`
}

type promotionFreezeSample struct {
	SampleID           string `json:"sampleId"`
	PromptFamily       string `json:"promptFamily"`
	ExpectedCategory   string `json:"expectedCategory"`
	ExpectedDifficulty string `json:"expectedDifficulty"`
}

type promotionDatasetManifest struct {
	SchemaVersion       string `json:"schemaVersion"`
	RecordSchemaVersion string `json:"recordSchemaVersion"`
	DatasetVersion      string `json:"datasetVersion"`
	DatasetSHA256       string `json:"datasetSha256"`
	TrainingEligible    bool   `json:"trainingEligible"`
	SplitPolicyVersion  string `json:"splitPolicyVersion"`
	SplitSeed           int    `json:"splitSeed"`
	SplitCounts         map[string]struct {
		Families int `json:"families"`
		Records  int `json:"records"`
	} `json:"splitCounts"`
	Families []struct {
		PromptFamily  string `json:"promptFamily"`
		ReviewStatus  string `json:"reviewStatus"`
		HumanReviewed bool   `json:"humanReviewed"`
		Partition     string `json:"partition"`
		Records       int    `json:"records"`
	} `json:"families"`
}

type promotionDatasetRecord struct {
	SchemaVersion       string `json:"schemaVersion"`
	DatasetVersion      string `json:"datasetVersion"`
	SampleID            string `json:"sampleId"`
	RedactedPrompt      string `json:"redactedPrompt"`
	ExpectedCategory    string `json:"expectedCategory"`
	ExpectedDifficulty  string `json:"expectedDifficulty"`
	SemanticInputStatus string `json:"semanticInputStatus"`
	PromptFamily        string `json:"promptFamily"`
	LabelSource         string `json:"labelSource"`
	ReviewStatus        string `json:"reviewStatus"`
	ReviewerCount       int    `json:"reviewerCount"`
}

type promotionHoldoutInput struct {
	SchemaVersion           string                        `json:"schemaVersion"`
	DatasetVersion          string                        `json:"datasetVersion"`
	DatasetSHA256           string                        `json:"datasetSha256"`
	ManifestSHA256          string                        `json:"manifestSha256"`
	FreezeSHA256            string                        `json:"freezeSha256"`
	SplitPolicyVersion      string                        `json:"splitPolicyVersion"`
	SplitSeed               int                           `json:"splitSeed"`
	SelectionPolicy         string                        `json:"selectionPolicyVersion"`
	MembershipHash          string                        `json:"membershipHash"`
	Artifact                any                           `json:"artifact"`
	Gates                   any                           `json:"gatesFrozenBeforeEvaluation"`
	HoldoutRecords          int                           `json:"holdoutRecords"`
	HoldoutFamilies         int                           `json:"holdoutFamilies"`
	ModelPathRecords        int                           `json:"modelPathRecords"`
	EmptyInstructionRecords int                           `json:"emptyInstructionRecords"`
	Samples                 []promotionHoldoutInputSample `json:"samples"`
}

type promotionHoldoutInputSample struct {
	SampleID           string    `json:"sampleId"`
	PromptFamily       string    `json:"promptFamily"`
	ExpectedCategory   string    `json:"expectedCategory"`
	ActualCategory     string    `json:"actualCategory"`
	ExpectedDifficulty string    `json:"expectedDifficulty"`
	RuleDifficulty     string    `json:"ruleDifficulty"`
	ModelPath          bool      `json:"modelPath"`
	SentinelDifficulty string    `json:"sentinelDifficulty,omitempty"`
	RuleVectorV1       []float64 `json:"ruleVectorV1,omitempty"`
	InstructionText    string    `json:"instructionText,omitempty"`
}

func main() {
	datasetPath := flag.String("dataset", "", "owner-approved promotion dataset JSONL")
	manifestPath := flag.String("manifest", "", "owner-approved promotion dataset manifest")
	freezePath := flag.String("freeze", "", "score-independent frozen promotion holdout membership")
	flag.Parse()
	if strings.TrimSpace(*datasetPath) == "" || strings.TrimSpace(*manifestPath) == "" || strings.TrimSpace(*freezePath) == "" {
		fmt.Fprintln(os.Stderr, "dataset, manifest, and freeze paths are required")
		os.Exit(2)
	}

	result, err := buildPromotionHoldoutInput(*datasetPath, *manifestPath, *freezePath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, "encode promotion holdout input")
		os.Exit(1)
	}
}

func buildPromotionHoldoutInput(datasetPath, manifestPath, freezePath string) (promotionHoldoutInput, error) {
	datasetBytes, err := os.ReadFile(datasetPath)
	if err != nil {
		return promotionHoldoutInput{}, fmt.Errorf("read promotion dataset: %w", err)
	}
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		return promotionHoldoutInput{}, fmt.Errorf("read promotion manifest: %w", err)
	}
	freezeBytes, err := os.ReadFile(freezePath)
	if err != nil {
		return promotionHoldoutInput{}, fmt.Errorf("read promotion freeze: %w", err)
	}

	var manifest promotionDatasetManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return promotionHoldoutInput{}, errors.New("decode promotion manifest")
	}
	var freeze promotionFreeze
	if err := json.Unmarshal(freezeBytes, &freeze); err != nil {
		return promotionHoldoutInput{}, errors.New("decode promotion freeze")
	}
	datasetHash := sha256.Sum256(datasetBytes)
	manifestHash := sha256.Sum256(manifestBytes)
	freezeHash := sha256.Sum256(freezeBytes)
	datasetSHA256 := hex.EncodeToString(datasetHash[:])
	manifestSHA256 := hex.EncodeToString(manifestHash[:])

	validFreezeSchema := freeze.SchemaVersion == "gatelm.difficulty-promotion-holdout-freeze.v1" ||
		freeze.SchemaVersion == "gatelm.difficulty-promotion-holdout-freeze.v2"
	validConsumedBoundary := freeze.SchemaVersion != "gatelm.difficulty-promotion-holdout-freeze.v2" ||
		(freeze.Source.ConsumedOverlap == 0 && freeze.Source.ExcludedConsumed == 10)
	if !validFreezeSchema || !validConsumedBoundary || freeze.Status != "frozen_before_first_score_access" ||
		!freeze.Selection.ScoreIndependent || freeze.Selection.SelectedFamilies != 10 || freeze.Selection.SelectedRecords != 100 ||
		freeze.Source.PreviousOverlap != 0 {
		return promotionHoldoutInput{}, errors.New("promotion freeze identity or score-independent membership gate is invalid")
	}
	if freeze.Source.DatasetVersion != manifest.DatasetVersion || freeze.Source.DatasetSHA256 != datasetSHA256 ||
		freeze.Source.ManifestSHA256 != manifestSHA256 || manifest.DatasetSHA256 != datasetSHA256 ||
		freeze.Source.SplitPolicy != manifest.SplitPolicyVersion || freeze.Source.SplitSeed != manifest.SplitSeed {
		return promotionHoldoutInput{}, errors.New("promotion source identity differs from the frozen holdout")
	}
	if manifest.SchemaVersion != "gatelm.difficulty-label-dataset-manifest.v2" ||
		manifest.RecordSchemaVersion != "gatelm.difficulty-label-record.v2" || !manifest.TrainingEligible {
		return promotionHoldoutInput{}, errors.New("promotion source manifest is not an approved v2 dataset")
	}
	holdoutCount := manifest.SplitCounts["holdout"]
	if holdoutCount.Families != freeze.Source.SourceFamilies || holdoutCount.Records != freeze.Source.SourceRecords ||
		holdoutCount.Families != 40 || holdoutCount.Records != 400 {
		return promotionHoldoutInput{}, errors.New("promotion source holdout partition drifted")
	}

	holdoutFamilies := make(map[string]int, holdoutCount.Families)
	for _, family := range manifest.Families {
		if family.Partition != "holdout" {
			continue
		}
		if family.ReviewStatus != "approved" || !family.HumanReviewed || family.Records <= 0 {
			return promotionHoldoutInput{}, fmt.Errorf("promotion holdout family %q is not approved", family.PromptFamily)
		}
		holdoutFamilies[family.PromptFamily] = family.Records
	}

	selectedFamilies := make(map[string]int, len(freeze.SelectedFamilies))
	for _, family := range freeze.SelectedFamilies {
		if holdoutFamilies[family.PromptFamily] != family.Records || family.Records != 10 {
			return promotionHoldoutInput{}, fmt.Errorf("selected family %q is not a frozen holdout family", family.PromptFamily)
		}
		selectedFamilies[family.PromptFamily] = family.Records
	}
	if len(selectedFamilies) != 10 || len(freeze.Samples) != 100 {
		return promotionHoldoutInput{}, errors.New("promotion freeze must select ten whole families and 100 records")
	}

	selectedSampleFreeze := make(map[string]promotionFreezeSample, len(freeze.Samples))
	for _, sample := range freeze.Samples {
		if _, duplicate := selectedSampleFreeze[sample.SampleID]; duplicate {
			return promotionHoldoutInput{}, fmt.Errorf("promotion freeze repeats sample %q", sample.SampleID)
		}
		if _, selected := selectedFamilies[sample.PromptFamily]; !selected {
			return promotionHoldoutInput{}, fmt.Errorf("promotion sample %q does not belong to a selected family", sample.SampleID)
		}
		selectedSampleFreeze[sample.SampleID] = sample
	}

	recordsByID := make(map[string]promotionDatasetRecord, len(freeze.Samples))
	scanner := bufio.NewScanner(bytes.NewReader(datasetBytes))
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for lineNumber := 1; scanner.Scan(); lineNumber++ {
		if strings.TrimSpace(scanner.Text()) == "" {
			continue
		}
		var record promotionDatasetRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			return promotionHoldoutInput{}, fmt.Errorf("decode promotion record line %d", lineNumber)
		}
		frozenSample, selected := selectedSampleFreeze[record.SampleID]
		if !selected {
			continue
		}
		if record.SchemaVersion != "gatelm.difficulty-label-record.v2" || record.DatasetVersion != manifest.DatasetVersion ||
			record.PromptFamily != frozenSample.PromptFamily || record.ExpectedCategory != frozenSample.ExpectedCategory ||
			record.ExpectedDifficulty != frozenSample.ExpectedDifficulty {
			return promotionHoldoutInput{}, fmt.Errorf("promotion sample %q identity or label drifted", record.SampleID)
		}
		if record.LabelSource != "human_review" || record.ReviewStatus != "approved" || record.ReviewerCount < 1 {
			return promotionHoldoutInput{}, fmt.Errorf("promotion sample %q is not owner-approved", record.SampleID)
		}
		recordsByID[record.SampleID] = record
	}
	if err := scanner.Err(); err != nil {
		return promotionHoldoutInput{}, fmt.Errorf("scan promotion dataset: %w", err)
	}
	if len(recordsByID) != 100 {
		return promotionHoldoutInput{}, errors.New("promotion dataset does not contain the frozen 100-record membership")
	}

	result := promotionHoldoutInput{
		SchemaVersion:      promotionHoldoutInputSchema,
		DatasetVersion:     manifest.DatasetVersion,
		DatasetSHA256:      datasetSHA256,
		ManifestSHA256:     manifestSHA256,
		FreezeSHA256:       hex.EncodeToString(freezeHash[:]),
		SplitPolicyVersion: manifest.SplitPolicyVersion,
		SplitSeed:          manifest.SplitSeed,
		SelectionPolicy:    freeze.Selection.PolicyVersion,
		MembershipHash:     freeze.Selection.MembershipHash,
		Artifact:           freeze.Artifact,
		Gates:              freeze.Gates,
		HoldoutRecords:     100,
		HoldoutFamilies:    10,
		Samples:            make([]promotionHoldoutInputSample, 0, 100),
	}
	categoryClassifier := routing.NewRuleBasedCategoryClassifier()
	difficultyClassifier := routing.NewRuleBasedDifficultyClassifier()
	for _, frozenSample := range freeze.Samples {
		record := recordsByID[frozenSample.SampleID]
		features := routing.ExtractPromptFeatures(record.RedactedPrompt)
		actualCategory := categoryClassifier.ClassifyFeatures(features).Category
		difficultyFeatures := routing.ExtractDifficultyFeatures(features, actualCategory)
		ruleDifficulty := difficultyClassifier.ClassifyFeatures(difficultyFeatures).Difficulty
		instructionText, instructionAvailable := routing.DifficultySemanticInputForOffline(features)
		modelPath := instructionAvailable && routing.UsesDifficultyModelPath(difficultyFeatures)
		if !instructionAvailable {
			if record.SemanticInputStatus != "empty_instruction" {
				return promotionHoldoutInput{}, fmt.Errorf("promotion sample %q unexpectedly lacks semantic input", record.SampleID)
			}
			result.EmptyInstructionRecords++
		}
		sample := promotionHoldoutInputSample{
			SampleID: record.SampleID, PromptFamily: record.PromptFamily,
			ExpectedCategory: record.ExpectedCategory, ActualCategory: actualCategory,
			ExpectedDifficulty: record.ExpectedDifficulty, RuleDifficulty: ruleDifficulty,
			ModelPath: modelPath,
		}
		if modelPath {
			sample.RuleVectorV1 = routing.VectorizeDifficultyFeaturesV1(difficultyFeatures)
			sample.InstructionText = instructionText
			result.ModelPathRecords++
		} else if !instructionAvailable {
			sample.SentinelDifficulty = routing.DifficultySimple
		} else {
			sample.SentinelDifficulty = ruleDifficulty
		}
		result.Samples = append(result.Samples, sample)
	}
	return result, nil
}
