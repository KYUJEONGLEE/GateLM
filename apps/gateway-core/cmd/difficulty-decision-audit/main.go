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
	defaultDatasetPath  = "docs/v2.1.0/training/difficulty-training-candidate-expansion-2000.owner-approved.jsonl"
	defaultManifestPath = "docs/v2.1.0/training/difficulty-training-candidate-expansion-2000.owner-approved.manifest.json"
)

type auditDatasetRecord struct {
	SchemaVersion       string   `json:"schemaVersion"`
	DatasetVersion      string   `json:"datasetVersion"`
	SampleID            string   `json:"sampleId"`
	RedactedPrompt      string   `json:"redactedPrompt"`
	ExpectedCategory    string   `json:"expectedCategory"`
	ExpectedDifficulty  string   `json:"expectedDifficulty"`
	SemanticInputStatus string   `json:"semanticInputStatus"`
	PromptFamily        string   `json:"promptFamily"`
	Language            string   `json:"language"`
	EvaluationSlices    []string `json:"evaluationSlices"`
	LabelSource         string   `json:"labelSource"`
	ReviewStatus        string   `json:"reviewStatus"`
	ReviewerCount       int      `json:"reviewerCount"`
}

type auditManifest struct {
	SchemaVersion       string                `json:"schemaVersion"`
	DatasetVersion      string                `json:"datasetVersion"`
	RecordSchemaVersion string                `json:"recordSchemaVersion"`
	DatasetSHA256       string                `json:"datasetSha256"`
	TrainingEligible    bool                  `json:"trainingEligible"`
	Families            []auditManifestFamily `json:"families"`
}

type auditManifestFamily struct {
	PromptFamily string `json:"promptFamily"`
	Partition    string `json:"partition"`
	Records      int    `json:"records"`
}

type auditOutput struct {
	SchemaVersion                 string                `json:"schemaVersion"`
	DatasetVersion                string                `json:"datasetVersion"`
	DatasetSHA256                 string                `json:"datasetSha256"`
	DecisionBoundaryVersion       string                `json:"decisionBoundaryVersion"`
	TotalRecords                  int                   `json:"totalRecords"`
	SimpleSentinelRecords         int                   `json:"simpleSentinelRecords"`
	HardSentinelRecords           int                   `json:"hardSentinelRecords"`
	ModelPathRecords              int                   `json:"modelPathRecords"`
	SemanticStatusRouteMismatches int                   `json:"semanticStatusRouteMismatches"`
	EvidenceRecords               []auditEvidenceRecord `json:"evidenceRecords"`
}

type auditEvidenceRecord struct {
	SampleID              string   `json:"sampleId"`
	FamilyID              string   `json:"familyId"`
	Split                 string   `json:"split"`
	ExpectedCategory      string   `json:"expectedCategory"`
	ActualCategory        string   `json:"actualCategory"`
	ExpectedDifficulty    string   `json:"expectedDifficulty"`
	SemanticInputStatus   string   `json:"semanticInputStatus"`
	Language              string   `json:"language"`
	EvaluationSlices      []string `json:"evaluationSlices"`
	Route                 string   `json:"route"`
	CommonEvidenceScore   int      `json:"commonEvidenceScore"`
	CategoryEvidenceScore int      `json:"categoryEvidenceScore"`
}

func main() {
	datasetPath := flag.String("dataset", defaultDatasetPath, "approved difficulty label dataset JSONL")
	manifestPath := flag.String("manifest", defaultManifestPath, "approved difficulty label manifest")
	allowPending := flag.Bool("allow-pending", false, "allow a synthetic pending-review candidate without treating it as training eligible")
	flag.Parse()

	result, err := buildDifficultyDecisionAuditWithOptions(*datasetPath, *manifestPath, *allowPending)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, "encode difficulty decision audit:", err)
		os.Exit(1)
	}
}

func buildDifficultyDecisionAudit(datasetPath string, manifestPath string) (auditOutput, error) {
	return buildDifficultyDecisionAuditWithOptions(datasetPath, manifestPath, false)
}

func buildDifficultyDecisionAuditWithOptions(datasetPath string, manifestPath string, allowPending bool) (auditOutput, error) {
	datasetBytes, err := os.ReadFile(datasetPath)
	if err != nil {
		return auditOutput{}, fmt.Errorf("read difficulty audit dataset: %w", err)
	}
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		return auditOutput{}, fmt.Errorf("read difficulty audit manifest: %w", err)
	}
	var manifest auditManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return auditOutput{}, fmt.Errorf("decode difficulty audit manifest: %w", err)
	}
	if manifest.SchemaVersion != "gatelm.difficulty-label-dataset-manifest.v2" ||
		manifest.RecordSchemaVersion != "gatelm.difficulty-label-record.v2" || (!manifest.TrainingEligible && !allowPending) {
		return auditOutput{}, errors.New("difficulty decision audit requires an approved v2 training dataset")
	}
	hash := sha256.Sum256(datasetBytes)
	datasetSHA256 := hex.EncodeToString(hash[:])
	if manifest.DatasetSHA256 != datasetSHA256 {
		return auditOutput{}, errors.New("difficulty audit dataset hash does not match manifest")
	}

	partitions := make(map[string]string, len(manifest.Families))
	expectedRecords := make(map[string]int, len(manifest.Families))
	for _, family := range manifest.Families {
		if family.PromptFamily == "" || family.Records <= 0 || !validAuditPartition(family.Partition) {
			return auditOutput{}, errors.New("difficulty audit manifest contains an invalid family")
		}
		if _, exists := partitions[family.PromptFamily]; exists {
			return auditOutput{}, fmt.Errorf("difficulty audit manifest repeats family %q", family.PromptFamily)
		}
		partitions[family.PromptFamily] = family.Partition
		expectedRecords[family.PromptFamily] = family.Records
	}

	result := auditOutput{
		SchemaVersion:           "gatelm.difficulty-decision-audit.v1",
		DatasetVersion:          manifest.DatasetVersion,
		DatasetSHA256:           datasetSHA256,
		DecisionBoundaryVersion: routing.DifficultyDecisionBoundaryVersion,
		EvidenceRecords:         make([]auditEvidenceRecord, 0),
	}
	actualRecords := make(map[string]int, len(manifest.Families))
	categoryClassifier := routing.NewRuleBasedCategoryClassifier()
	scanner := bufio.NewScanner(bytes.NewReader(datasetBytes))
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for lineNumber := 1; scanner.Scan(); lineNumber++ {
		if strings.TrimSpace(scanner.Text()) == "" {
			continue
		}
		var record auditDatasetRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			return auditOutput{}, fmt.Errorf("decode difficulty audit record line %d: %w", lineNumber, err)
		}
		if record.SchemaVersion != manifest.RecordSchemaVersion || record.DatasetVersion != manifest.DatasetVersion {
			return auditOutput{}, fmt.Errorf("difficulty audit record line %d has an unsupported schema or dataset version", lineNumber)
		}
		partition, exists := partitions[record.PromptFamily]
		if !exists {
			return auditOutput{}, fmt.Errorf("difficulty audit record line %d has no manifest family", lineNumber)
		}
		if allowPending {
			pendingSynthetic := record.LabelSource == "synthetic_fixture" && record.ReviewStatus == "pending" && record.ReviewerCount == 0
			approvedHuman := record.LabelSource == "human_review" && record.ReviewStatus == "approved" && record.ReviewerCount >= 1
			if !pendingSynthetic && !approvedHuman {
				return auditOutput{}, fmt.Errorf("difficulty audit record line %d is neither a pending synthetic candidate nor human-approved", lineNumber)
			}
		} else if record.LabelSource != "human_review" || record.ReviewStatus != "approved" || record.ReviewerCount < 1 {
			return auditOutput{}, fmt.Errorf("difficulty audit record line %d is not human-approved", lineNumber)
		}
		if record.ExpectedDifficulty != routing.DifficultySimple && record.ExpectedDifficulty != routing.DifficultyComplex {
			return auditOutput{}, fmt.Errorf("difficulty audit record line %d has an unsupported difficulty label", lineNumber)
		}
		actualRecords[record.PromptFamily]++
		features := routing.ExtractPromptFeatures(record.RedactedPrompt)
		actualCategory := categoryClassifier.ClassifyFeatures(features).Category
		difficultyFeatures := routing.ExtractDifficultyFeatures(features, actualCategory)
		evidence := routing.DifficultyDecisionEvidenceForOffline(difficultyFeatures)
		switch evidence.Route {
		case routing.DifficultyDecisionRouteSimpleSentinel:
			result.SimpleSentinelRecords++
		case routing.DifficultyDecisionRouteHardSentinel:
			result.HardSentinelRecords++
		case routing.DifficultyDecisionRouteModel:
			result.ModelPathRecords++
		default:
			return auditOutput{}, fmt.Errorf("difficulty audit record line %d has an unsupported route", lineNumber)
		}
		if (record.SemanticInputStatus == "empty_instruction") != (evidence.Route == routing.DifficultyDecisionRouteSimpleSentinel) {
			result.SemanticStatusRouteMismatches++
		}
		result.EvidenceRecords = append(result.EvidenceRecords, auditEvidenceRecord{
			SampleID:              record.SampleID,
			FamilyID:              record.PromptFamily,
			Split:                 partition,
			ExpectedCategory:      record.ExpectedCategory,
			ActualCategory:        actualCategory,
			ExpectedDifficulty:    record.ExpectedDifficulty,
			SemanticInputStatus:   record.SemanticInputStatus,
			Language:              record.Language,
			EvaluationSlices:      append([]string(nil), record.EvaluationSlices...),
			Route:                 evidence.Route,
			CommonEvidenceScore:   evidence.CommonEvidenceScore,
			CategoryEvidenceScore: evidence.CategoryEvidenceScore,
		})
		result.TotalRecords++
	}
	if err := scanner.Err(); err != nil {
		return auditOutput{}, fmt.Errorf("read difficulty audit dataset: %w", err)
	}
	for familyID, expected := range expectedRecords {
		if actualRecords[familyID] != expected {
			return auditOutput{}, fmt.Errorf("difficulty audit family %q record count does not match manifest", familyID)
		}
	}
	return result, nil
}

func validAuditPartition(value string) bool {
	return value == "train" || value == "calibration" || value == "holdout"
}
