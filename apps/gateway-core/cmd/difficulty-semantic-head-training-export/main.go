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
	"sort"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/routing"
)

const (
	defaultLabelDatasetPath  = "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.owner-approved.jsonl"
	defaultLabelManifestPath = "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.owner-approved.manifest.json"
)

type semanticHeadDatasetRecord struct {
	SchemaVersion               string   `json:"schemaVersion"`
	DatasetVersion              string   `json:"datasetVersion"`
	SampleID                    string   `json:"sampleId"`
	RedactedPrompt              string   `json:"redactedPrompt"`
	ExpectedCategory            string   `json:"expectedCategory"`
	ExpectedDifficulty          string   `json:"expectedDifficulty"`
	SemanticInputStatus         string   `json:"semanticInputStatus"`
	TaskBucket                  string   `json:"taskBucket"`
	ConstraintBucket            string   `json:"constraintBucket"`
	ScopeBucket                 string   `json:"scopeBucket"`
	DependencyBucket            string   `json:"dependencyBucket"`
	PromptFamily                string   `json:"promptFamily"`
	Language                    string   `json:"language"`
	EvaluationSlices            []string `json:"evaluationSlices"`
	LabelSource                 string   `json:"labelSource"`
	ReviewStatus                string   `json:"reviewStatus"`
	ReviewerCount               int      `json:"reviewerCount"`
	CanonicalSchemaVersion      string   `json:"schema_version"`
	CanonicalDatasetVersion     string   `json:"dataset_version"`
	CanonicalSampleID           string   `json:"sample_id"`
	CanonicalRedactedPrompt     string   `json:"redacted_prompt"`
	CanonicalExpectedCategory   string   `json:"expected_category"`
	CanonicalLabel              string   `json:"label"`
	CanonicalHumanReviewed      bool     `json:"human_reviewed"`
	CanonicalReviewStatus       string   `json:"review_status"`
	CanonicalGroupID            string   `json:"group_id"`
	CanonicalSplit              string   `json:"split"`
	CanonicalLengthBucket       string   `json:"length_bucket"`
	CanonicalReasoningLevel     string   `json:"reasoning_level"`
	CanonicalTaskStepCount      int      `json:"task_step_count"`
	CanonicalConstraintCount    int      `json:"constraint_count"`
	CanonicalHasFile            bool     `json:"has_file"`
	CanonicalToolRequired       bool     `json:"tool_required"`
	CanonicalBoundaryCase       bool     `json:"boundary_case"`
	CanonicalCounterexampleType *string  `json:"counterexample_type"`
	CanonicalTaskType           string   `json:"task_type"`
	CanonicalServiceDomain      string   `json:"service_domain"`
}

type semanticHeadDatasetManifest struct {
	SchemaVersion                string                        `json:"schemaVersion"`
	DatasetVersion               string                        `json:"datasetVersion"`
	RecordSchemaVersion          string                        `json:"recordSchemaVersion"`
	DatasetSHA256                string                        `json:"datasetSha256"`
	DatasetPurpose               string                        `json:"datasetPurpose"`
	TrainingEligible             bool                          `json:"trainingEligible"`
	LabelCoverageStatus          string                        `json:"labelCoverageStatus"`
	FamilyPolicyVersion          string                        `json:"familyPolicyVersion"`
	SplitPolicyVersion           string                        `json:"splitPolicyVersion"`
	SplitSeed                    int                           `json:"splitSeed"`
	SplitCounts                  map[string]semanticSplitCount `json:"splitCounts"`
	TrainingGate                 semanticHeadTrainingGate      `json:"trainingGate"`
	Families                     []semanticHeadManifestFamily  `json:"families"`
	CanonicalSchemaVersion       string                        `json:"schema_version"`
	CanonicalDatasetVersion      string                        `json:"dataset_version"`
	CanonicalRecordSchemaVersion string                        `json:"record_schema_version"`
	CanonicalDatasetSHA256       string                        `json:"dataset_sha256"`
	CanonicalGenerationSeed      int                           `json:"generation_seed"`
	CanonicalScope               canonicalManifestScope        `json:"scope"`
	CanonicalReview              canonicalManifestReview       `json:"review"`
}

type canonicalManifestScope struct {
	TrainingEligible bool     `json:"training_eligible"`
	TrainingBlockers []string `json:"training_blockers"`
}

type canonicalManifestReview struct {
	HumanReviewed    bool `json:"human_reviewed"`
	ProductionGold   bool `json:"production_gold"`
	TrainingEligible bool `json:"training_eligible"`
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
	AccessPhase                   string                            `json:"accessPhase"`
	IncludedPartitions            []string                          `json:"includedPartitions"`
	HoldoutOutcomeAccessed        bool                              `json:"holdoutOutcomeAccessed"`
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
	phase := flag.String("phase", "all", "export phase: all, selection, or final-test")
	flag.Parse()

	includedPartitions, err := semanticHeadPartitionsForPhase(*phase)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	export, err := buildSemanticHeadTrainingInputForPhase(
		*datasetPath,
		*manifestPath,
		*phase,
		includedPartitions,
	)
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
	return buildSemanticHeadTrainingInputForPhase(
		datasetPath,
		manifestPath,
		"all",
		map[string]bool{"train": true, "calibration": true, "holdout": true},
	)
}

func semanticHeadPartitionsForPhase(phase string) (map[string]bool, error) {
	switch phase {
	case "all":
		return map[string]bool{"train": true, "calibration": true, "holdout": true}, nil
	case "selection":
		return map[string]bool{"train": true, "calibration": true}, nil
	case "final-test":
		return map[string]bool{"holdout": true}, nil
	default:
		return nil, errors.New("semantic head export phase must be all, selection, or final-test")
	}
}

func buildSemanticHeadTrainingInputForPhase(
	datasetPath string,
	manifestPath string,
	phase string,
	includedPartitions map[string]bool,
) (semanticHeadTrainingInput, error) {
	if len(includedPartitions) == 0 {
		return semanticHeadTrainingInput{}, errors.New("semantic head export requires at least one partition")
	}
	for partition := range includedPartitions {
		if !validPartition(partition) {
			return semanticHeadTrainingInput{}, errors.New("semantic head export contains an invalid partition")
		}
	}
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
	if err := normalizeCanonicalManifest(&manifest, datasetBytes); err != nil {
		return semanticHeadTrainingInput{}, err
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
		AccessPhase:             phase,
		IncludedPartitions:      orderedSemanticPartitions(includedPartitions),
		HoldoutOutcomeAccessed:  includedPartitions["holdout"],
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
		if err := normalizeCanonicalRecord(&record, manifest.DatasetVersion); err != nil {
			return semanticHeadTrainingInput{}, fmt.Errorf("semantic head record line %d: %w", lineNumber, err)
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
		if !includedPartitions[partition] {
			continue
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
		if includedPartitions[partition] && eligibleByPartition[partition] == 0 {
			return semanticHeadTrainingInput{}, fmt.Errorf("semantic head dataset has no eligible %s samples", partition)
		}
		if includedPartitions[partition] {
			result.SplitCounts[partition] = semanticSplitCount{
				Families: len(eligibleFamiliesByPartition[partition]),
				Records:  eligibleByPartition[partition],
			}
		}
	}
	return result, nil
}

func normalizeCanonicalManifest(manifest *semanticHeadDatasetManifest, datasetBytes []byte) error {
	if manifest.CanonicalSchemaVersion == "" {
		return nil
	}
	if manifest.CanonicalSchemaVersion != "gatelm.routing-difficulty-dataset-manifest.v1" ||
		manifest.CanonicalRecordSchemaVersion != "gatelm.routing-difficulty-dataset-record.v1" {
		return errors.New("unsupported canonical routing dataset manifest schema")
	}
	if !manifest.CanonicalScope.TrainingEligible || len(manifest.CanonicalScope.TrainingBlockers) != 0 ||
		!manifest.CanonicalReview.HumanReviewed || !manifest.CanonicalReview.ProductionGold ||
		!manifest.CanonicalReview.TrainingEligible {
		return errors.New("canonical routing dataset is not owner-approved training gold")
	}
	if strings.TrimSpace(manifest.CanonicalDatasetVersion) == "" || manifest.CanonicalGenerationSeed <= 0 {
		return errors.New("canonical routing dataset identity is incomplete")
	}

	type familyState struct {
		partition string
		records   int
	}
	families := make(map[string]familyState)
	scanner := bufio.NewScanner(bytes.NewReader(datasetBytes))
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for lineNumber := 1; scanner.Scan(); lineNumber++ {
		if strings.TrimSpace(scanner.Text()) == "" {
			continue
		}
		var record semanticHeadDatasetRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			return fmt.Errorf("decode canonical routing record line %d: %w", lineNumber, err)
		}
		if record.CanonicalSchemaVersion != "gatelm.routing-difficulty-dataset-record.v1" ||
			strings.TrimSpace(record.CanonicalGroupID) == "" {
			return fmt.Errorf("canonical routing record line %d has invalid schema or group", lineNumber)
		}
		partition, err := canonicalPartition(record.CanonicalSplit)
		if err != nil {
			return fmt.Errorf("canonical routing record line %d: %w", lineNumber, err)
		}
		state, exists := families[record.CanonicalGroupID]
		if exists && state.partition != partition {
			return fmt.Errorf("canonical routing group %q crosses splits", record.CanonicalGroupID)
		}
		state.partition = partition
		state.records++
		families[record.CanonicalGroupID] = state
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read canonical routing dataset: %w", err)
	}
	if len(families) == 0 {
		return errors.New("canonical routing dataset contains no groups")
	}

	ids := make([]string, 0, len(families))
	for id := range families {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	splitCounts := map[string]semanticSplitCount{
		"train": {}, "calibration": {}, "holdout": {},
	}
	manifest.Families = make([]semanticHeadManifestFamily, 0, len(ids))
	for _, id := range ids {
		state := families[id]
		manifest.Families = append(manifest.Families, semanticHeadManifestFamily{
			PromptFamily: id, ReviewStatus: "approved", HumanReviewed: true,
			Partition: state.partition, Records: state.records,
		})
		count := splitCounts[state.partition]
		count.Families++
		count.Records += state.records
		splitCounts[state.partition] = count
	}

	manifest.SchemaVersion = "gatelm.difficulty-label-dataset-manifest.v2"
	manifest.DatasetVersion = manifest.CanonicalDatasetVersion
	manifest.RecordSchemaVersion = "gatelm.difficulty-label-record.v2"
	manifest.DatasetSHA256 = manifest.CanonicalDatasetSHA256
	manifest.DatasetPurpose = "training_candidate"
	manifest.TrainingEligible = true
	manifest.LabelCoverageStatus = "complete"
	manifest.FamilyPolicyVersion = "routing-difficulty-group-id.v1"
	manifest.SplitPolicyVersion = "routing-difficulty-group-split.2026-07-21.v1"
	manifest.SplitSeed = manifest.CanonicalGenerationSeed
	manifest.SplitCounts = splitCounts
	manifest.TrainingGate = semanticHeadTrainingGate{
		MinimumFamilyPolicyStatus: "versioned",
		PolicyVersion:             "routing-difficulty-owner-approved-15000.v1",
	}
	return nil
}

func normalizeCanonicalRecord(record *semanticHeadDatasetRecord, datasetVersion string) error {
	if record.CanonicalSchemaVersion == "" {
		return nil
	}
	if record.CanonicalSchemaVersion != "gatelm.routing-difficulty-dataset-record.v1" ||
		!record.CanonicalHumanReviewed || record.CanonicalReviewStatus != "approved" {
		return errors.New("canonical routing record is not human-approved")
	}
	partition, err := canonicalPartition(record.CanonicalSplit)
	if err != nil {
		return err
	}
	if record.CanonicalLabel != routing.DifficultySimple && record.CanonicalLabel != routing.DifficultyComplex {
		return errors.New("canonical routing record has an unsupported difficulty label")
	}
	if strings.TrimSpace(record.CanonicalSampleID) == "" || strings.TrimSpace(record.CanonicalGroupID) == "" ||
		strings.TrimSpace(record.CanonicalRedactedPrompt) == "" {
		return errors.New("canonical routing record identity is incomplete")
	}

	record.SchemaVersion = "gatelm.difficulty-label-record.v2"
	record.DatasetVersion = datasetVersion
	record.SampleID = record.CanonicalSampleID
	record.RedactedPrompt = record.CanonicalRedactedPrompt
	record.ExpectedCategory = record.CanonicalExpectedCategory
	record.ExpectedDifficulty = record.CanonicalLabel
	record.SemanticInputStatus = "eligible"
	record.TaskBucket = countBucket(record.CanonicalTaskStepCount, 1)
	record.ConstraintBucket = countBucket(record.CanonicalConstraintCount, 0)
	scopeCount := record.CanonicalTaskStepCount
	if record.CanonicalHasFile {
		scopeCount++
	}
	if record.CanonicalToolRequired {
		scopeCount++
	}
	record.ScopeBucket = scopeBucket(scopeCount)
	record.DependencyBucket = dependencyBucket(record.CanonicalReasoningLevel)
	record.PromptFamily = record.CanonicalGroupID
	record.EvaluationSlices = canonicalEvaluationSlices(record)
	record.LabelSource = "human_review"
	record.ReviewStatus = "approved"
	record.ReviewerCount = 1
	_ = partition // family-derived partition remains authoritative in the normalized manifest.
	return nil
}

func canonicalPartition(value string) (string, error) {
	switch value {
	case "train":
		return "train", nil
	case "validation":
		return "calibration", nil
	case "test":
		return "holdout", nil
	default:
		return "", errors.New("canonical routing record has an invalid split")
	}
}

func countBucket(value int, zeroFloor int) string {
	if zeroFloor == 0 {
		if value <= 1 {
			return "count_0_to_1"
		}
		if value == 2 {
			return "count_2"
		}
		return "count_3_plus"
	}
	if value <= 1 {
		return "count_1"
	}
	if value == 2 {
		return "count_2"
	}
	return "count_3_plus"
}

func scopeBucket(value int) string {
	if value <= 1 {
		return "count_1"
	}
	if value <= 3 {
		return "count_2_to_3"
	}
	return "count_4_plus"
}

func dependencyBucket(value string) string {
	switch value {
	case "low":
		return "depth_0_to_1"
	case "medium":
		return "depth_2"
	case "high":
		return "depth_3_plus"
	default:
		return ""
	}
}

func canonicalEvaluationSlices(record *semanticHeadDatasetRecord) []string {
	slices := []string{
		"language_" + record.Language,
		"length_" + record.CanonicalLengthBucket,
		"task_" + record.CanonicalTaskType,
		"domain_" + record.CanonicalServiceDomain,
	}
	if record.CanonicalLengthBucket == "long" && record.CanonicalLabel == routing.DifficultySimple {
		slices = append(slices, "long_simple")
	}
	if record.CanonicalLengthBucket == "short" && record.CanonicalLabel == routing.DifficultyComplex {
		slices = append(slices, "short_complex")
	}
	if record.CanonicalBoundaryCase {
		slices = append(slices, "boundary_case")
	}
	if record.CanonicalCounterexampleType != nil && strings.TrimSpace(*record.CanonicalCounterexampleType) != "" {
		slices = append(slices, "counterexample_"+*record.CanonicalCounterexampleType)
	}
	return slices
}

func orderedSemanticPartitions(included map[string]bool) []string {
	partitions := make([]string, 0, len(included))
	for _, partition := range []string{"train", "calibration", "holdout"} {
		if included[partition] {
			partitions = append(partitions, partition)
		}
	}
	return partitions
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
	if (manifest.FamilyPolicyVersion != "difficulty-prompt-family.v1" &&
		manifest.FamilyPolicyVersion != "routing-difficulty-group-id.v1") ||
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
