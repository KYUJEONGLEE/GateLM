package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/routing"
)

const (
	defaultClassifierName              = "rule_based_category_classifier"
	defaultClassifierVersion           = "rule_based_category_classifier_v1"
	defaultDifficultyClassifierName    = "rule_based_category_aware_difficulty_classifier"
	defaultDifficultyClassifierVersion = "rule_based_difficulty_classifier_v2"
	defaultDatasetPath                 = "docs/v2.1.0/fixtures/category-evaluation-dataset.fixture.jsonl"
	defaultDifficultyDatasetPath       = "docs/v2.1.0/fixtures/difficulty-evaluation-dataset.fixture.jsonl"
	defaultProbeDatasetPath            = "docs/v2.1.0/fixtures/routing-random-probe.fixture.jsonl"
	defaultLatencyIterations           = 20
	categoryRecordV2                   = "gatelm.category-evaluation-record.v2"
	difficultyRecordV1                 = "gatelm.difficulty-evaluation-record.v1"

	modeEvaluate = "evaluate"
	modeProbe    = "probe"

	evaluationScopeCategory   = "category"
	evaluationScopeDifficulty = "difficulty"
)

type datasetRecord struct {
	SchemaVersion      string  `json:"schemaVersion"`
	SampleID           string  `json:"sampleId"`
	LegacyID           string  `json:"id"`
	RedactedPrompt     *string `json:"redactedPrompt"`
	Prompt             *string `json:"prompt"`
	ExpectedCategory   string  `json:"expectedCategory"`
	ExpectedDifficulty string  `json:"expectedDifficulty"`
	Language           string  `json:"language"`
	ExpectedTier       *string `json:"expectedTier"`
}

type report struct {
	SummaryKo         evaluationSummaryKo       `json:"한글요약"`
	DatasetPath       string                    `json:"datasetPath"`
	ClassifierName    string                    `json:"classifierName"`
	ClassifierVersion string                    `json:"classifierVersion"`
	TotalSamples      int                       `json:"totalSamples"`
	CorrectSamples    int                       `json:"correctSamples"`
	IncorrectSamples  int                       `json:"incorrectSamples"`
	Accuracy          float64                   `json:"accuracy"`
	ErrorRate         float64                   `json:"errorRate"`
	ByCategory        map[string]categoryStats  `json:"byCategory"`
	ConfusionMatrix   map[string]map[string]int `json:"confusionMatrix"`
	Latency           latencyStats              `json:"latency"`
	Failures          []evaluationFailure       `json:"failures"`
	Samples           []evaluationSample        `json:"samples"`
}

type categoryStats struct {
	LabelKo       string  `json:"labelKo,omitempty"`
	Correct       int     `json:"correct"`
	Incorrect     int     `json:"incorrect"`
	Total         int     `json:"total"`
	Accuracy      float64 `json:"accuracy"`
	IncorrectRate float64 `json:"incorrectRate"`
}

type latencyStats struct {
	Iterations int     `json:"iterations"`
	Samples    int     `json:"samples"`
	AvgMicros  float64 `json:"avgMicros"`
	P50Micros  float64 `json:"p50Micros"`
	P95Micros  float64 `json:"p95Micros"`
	MaxMicros  float64 `json:"maxMicros"`
}

type difficultyReport struct {
	DatasetPath           string                     `json:"datasetPath"`
	ClassifierName        string                     `json:"classifierName"`
	ClassifierVersion     string                     `json:"classifierVersion"`
	ScorePolicyVersion    string                     `json:"scorePolicyVersion"`
	ComplexityThreshold   float64                    `json:"complexityThreshold"`
	Split                 difficultySplitSummary     `json:"split"`
	FullDataset           difficultyEvaluationPair   `json:"fullDataset"`
	Calibration           difficultyEvaluationPair   `json:"calibration"`
	Holdout               difficultyEvaluationPair   `json:"holdout"`
	ClassificationLatency classificationLatencyStats `json:"classificationLatency"`
}

type difficultyEvaluationPair struct {
	OracleCategory difficultyEvaluationResult `json:"oracleCategory"`
	EndToEnd       difficultyEvaluationResult `json:"endToEnd"`
}

type difficultyEvaluationResult struct {
	TotalSamples              int                                 `json:"totalSamples"`
	CorrectSamples            int                                 `json:"correctSamples"`
	IncorrectSamples          int                                 `json:"incorrectSamples"`
	Accuracy                  float64                             `json:"accuracy"`
	ErrorRate                 float64                             `json:"errorRate"`
	ByCategoryDifficulty      map[string]map[string]categoryStats `json:"byCategoryDifficulty"`
	DirectionalErrors         directionalErrorStats               `json:"directionalErrors"`
	ScoreBuckets              map[string]int                      `json:"scoreBuckets"`
	ByExpectedDifficultyScore map[string]scoreDistributionStats   `json:"byExpectedDifficultyScore"`
	Failures                  []difficultyEvaluationFailure       `json:"failures"`
	Samples                   []difficultyEvaluationSample        `json:"samples"`
}

type difficultySplitSummary struct {
	Algorithm           string `json:"algorithm"`
	FamilyKeyRule       string `json:"familyKeyRule"`
	CalibrationSamples  int    `json:"calibrationSamples"`
	HoldoutSamples      int    `json:"holdoutSamples"`
	CalibrationFamilies int    `json:"calibrationFamilies"`
	HoldoutFamilies     int    `json:"holdoutFamilies"`
}

type scoreDistributionStats struct {
	Count int     `json:"count"`
	Min   float64 `json:"min"`
	Avg   float64 `json:"avg"`
	P50   float64 `json:"p50"`
	P95   float64 `json:"p95"`
	Max   float64 `json:"max"`
}

type directionalErrorStats struct {
	SimpleExpectedSamples  int     `json:"simpleExpectedSamples"`
	SimpleToComplexCount   int     `json:"simpleToComplexCount"`
	SimpleToComplexRate    float64 `json:"simpleToComplexRate"`
	ComplexExpectedSamples int     `json:"complexExpectedSamples"`
	ComplexToSimpleCount   int     `json:"complexToSimpleCount"`
	ComplexToSimpleRate    float64 `json:"complexToSimpleRate"`
}

type classificationLatencyStats struct {
	Unit       string       `json:"unit"`
	Category   latencyStats `json:"category"`
	Difficulty latencyStats `json:"difficulty"`
	Total      latencyStats `json:"total"`
}

type difficultyEvaluationFailure struct {
	SampleID           string  `json:"sampleId"`
	RedactedPrompt     string  `json:"redactedPrompt,omitempty"`
	ExpectedCategory   string  `json:"expectedCategory"`
	ActualCategory     string  `json:"actualCategory"`
	ExpectedDifficulty string  `json:"expectedDifficulty"`
	ActualDifficulty   string  `json:"actualDifficulty"`
	ComplexityScore    float64 `json:"complexityScore"`
}

type difficultyEvaluationSample struct {
	SampleID           string  `json:"sampleId"`
	RedactedPrompt     string  `json:"redactedPrompt"`
	ExpectedCategory   string  `json:"expectedCategory"`
	ActualCategory     string  `json:"actualCategory"`
	ExpectedDifficulty string  `json:"expectedDifficulty"`
	ActualDifficulty   string  `json:"actualDifficulty"`
	ComplexityScore    float64 `json:"complexityScore"`
	CategoryMatched    bool    `json:"categoryMatched"`
	Matched            bool    `json:"matched"`
}

type evaluationFailure struct {
	SampleID         string `json:"sampleId"`
	RedactedPrompt   string `json:"redactedPrompt,omitempty"`
	ExpectedCategory string `json:"expectedCategory"`
	ActualCategory   string `json:"actualCategory"`
}

type evaluationSample struct {
	SampleID            string                      `json:"sampleId"`
	RedactedPrompt      string                      `json:"redactedPrompt"`
	ExpectedCategory    string                      `json:"expectedCategory"`
	ExpectedCategoryKo  string                      `json:"expectedCategoryKo"`
	ActualCategory      string                      `json:"actualCategory"`
	ActualCategoryKo    string                      `json:"actualCategoryKo"`
	CategoryDiagnostics routing.CategoryDiagnostics `json:"categoryDiagnostics,omitempty"`
	Matched             bool                        `json:"matched"`
}

type probeReport struct {
	SummaryKo         probeSummaryKo       `json:"한글요약"`
	Mode              string               `json:"mode"`
	DatasetPath       string               `json:"datasetPath"`
	ClassifierName    string               `json:"classifierName"`
	ClassifierVersion string               `json:"classifierVersion"`
	TotalSamples      int                  `json:"totalSamples"`
	ByCategory        map[string]probeStat `json:"byCategory"`
	Latency           latencyStats         `json:"latency"`
	Samples           []probeSample        `json:"samples"`
}

type probeStat struct {
	LabelKo string  `json:"labelKo,omitempty"`
	Total   int     `json:"total"`
	Rate    float64 `json:"rate"`
}

type probeSample struct {
	SampleID            string                      `json:"sampleId"`
	RedactedPrompt      string                      `json:"redactedPrompt"`
	Category            string                      `json:"category"`
	CategoryKo          string                      `json:"categoryKo"`
	CategoryDiagnostics routing.CategoryDiagnostics `json:"categoryDiagnostics,omitempty"`
}

type evaluationSummaryKo struct {
	Title                string              `json:"제목"`
	Purpose              string              `json:"목적"`
	DatasetPath          string              `json:"데이터셋"`
	TotalSamples         int                 `json:"전체샘플수"`
	CategoryAccuracy     float64             `json:"카테고리정확도"`
	CategoryErrorRate    float64             `json:"카테고리오답률"`
	AvgLatencyMicros     float64             `json:"평균지연시간Micros"`
	P95LatencyMicros     float64             `json:"P95지연시간Micros"`
	FailureCount         int                 `json:"실패수"`
	CategoryDistribution []koreanStatSummary `json:"카테고리별결과"`
	HowToRead            string              `json:"읽는법"`
}

type probeSummaryKo struct {
	Title                string              `json:"제목"`
	Purpose              string              `json:"목적"`
	DatasetPath          string              `json:"데이터셋"`
	TotalSamples         int                 `json:"전체샘플수"`
	AvgLatencyMicros     float64             `json:"평균지연시간Micros"`
	P95LatencyMicros     float64             `json:"P95지연시간Micros"`
	CategoryDistribution []koreanStatSummary `json:"카테고리분포"`
	HowToRead            string              `json:"읽는법"`
}

type koreanStatSummary struct {
	Key       string  `json:"값"`
	LabelKo   string  `json:"표시명"`
	Total     int     `json:"전체"`
	Correct   int     `json:"정답,omitempty"`
	Incorrect int     `json:"오답,omitempty"`
	Accuracy  float64 `json:"정확도,omitempty"`
	Rate      float64 `json:"비율,omitempty"`
}

func main() {
	datasetPath := flag.String("dataset", defaultDatasetPath, "category evaluation dataset path (.jsonl or .json)")
	evaluationScope := flag.String("evaluation-scope", evaluationScopeCategory, "evaluation scope: category or difficulty")
	mode := flag.String("mode", modeEvaluate, "routing report mode: evaluate or probe")
	outputPath := flag.String("output", "", "optional report output path")
	classifierVersion := flag.String("classifier-version", defaultClassifierVersion, "classifier version label for the report")
	minAccuracy := flag.Float64("min-accuracy", 0, "optional minimum exact-match accuracy, from 0 to 1")
	latencyIterations := flag.Int("latency-iterations", defaultLatencyIterations, "routing decision iterations per sample for latency measurement")
	pretty := flag.Bool("pretty", true, "pretty-print JSON report")
	flag.Parse()

	reportMode := strings.TrimSpace(*mode)
	if reportMode == "" {
		reportMode = modeEvaluate
	}
	if *datasetPath == defaultDatasetPath && reportMode == modeProbe {
		*datasetPath = defaultProbeDatasetPath
	}
	reportScope := strings.TrimSpace(*evaluationScope)
	if reportScope == "" {
		reportScope = evaluationScopeCategory
	}
	if *datasetPath == defaultDatasetPath && reportScope == evaluationScopeDifficulty {
		*datasetPath = defaultDifficultyDatasetPath
	}

	var records []datasetRecord
	var err error
	switch reportScope {
	case evaluationScopeCategory:
		requireExpectedLabels := reportMode != modeProbe
		records, err = loadDataset(*datasetPath, requireExpectedLabels)
	case evaluationScopeDifficulty:
		if reportMode != modeEvaluate {
			exitWithError(fmt.Errorf("difficulty evaluation supports mode %q only", modeEvaluate))
		}
		records, err = loadDifficultyDataset(*datasetPath)
	default:
		exitWithError(fmt.Errorf("unsupported evaluation scope %q; expected %q or %q", reportScope, evaluationScopeCategory, evaluationScopeDifficulty))
	}
	if err != nil {
		exitWithError(err)
	}

	var payload []byte
	switch reportMode {
	case modeEvaluate:
		if reportScope == evaluationScopeDifficulty {
			version := *classifierVersion
			if version == defaultClassifierVersion {
				version = defaultDifficultyClassifierVersion
			}
			evalReport := evaluateDifficulty(*datasetPath, version, records, *latencyIterations)
			payload, err = marshalDifficultyReport(evalReport, *pretty)
			if err != nil {
				exitWithError(err)
			}
			if *minAccuracy > 0 && evalReport.FullDataset.EndToEnd.Accuracy < *minAccuracy {
				exitWithError(fmt.Errorf("difficulty accuracy %.4f is below minimum %.4f", evalReport.FullDataset.EndToEnd.Accuracy, *minAccuracy))
			}
		} else {
			evalReport := evaluate(*datasetPath, *classifierVersion, records, *latencyIterations)
			payload, err = marshalReport(evalReport, *pretty)
			if err != nil {
				exitWithError(err)
			}
			if *minAccuracy > 0 && evalReport.Accuracy < *minAccuracy {
				exitWithError(fmt.Errorf("accuracy %.4f is below minimum %.4f", evalReport.Accuracy, *minAccuracy))
			}
		}
	case modeProbe:
		probeReport := probe(*datasetPath, *classifierVersion, records, *latencyIterations)
		payload, err = marshalProbeReport(probeReport, *pretty)
		if err != nil {
			exitWithError(err)
		}
	default:
		exitWithError(fmt.Errorf("unsupported mode %q; expected %q or %q", reportMode, modeEvaluate, modeProbe))
	}

	if *outputPath != "" {
		if err := os.MkdirAll(filepath.Dir(*outputPath), 0o755); err != nil {
			exitWithError(fmt.Errorf("create report directory: %w", err))
		}
		if err := os.WriteFile(*outputPath, payload, 0o644); err != nil {
			exitWithError(fmt.Errorf("write report: %w", err))
		}
	} else {
		fmt.Println(string(payload))
	}
}

func loadDataset(datasetPath string, requireExpectedLabels bool) ([]datasetRecord, error) {
	payload, err := os.ReadFile(datasetPath)
	if err != nil {
		return nil, fmt.Errorf("read dataset %q: %w", datasetPath, err)
	}

	trimmed := strings.TrimPrefix(strings.TrimSpace(string(payload)), "\ufeff")
	if trimmed == "" {
		return nil, fmt.Errorf("dataset %q is empty", datasetPath)
	}

	if strings.HasPrefix(trimmed, "[") {
		var records []datasetRecord
		if err := json.Unmarshal([]byte(trimmed), &records); err != nil {
			return nil, fmt.Errorf("decode JSON dataset %q: %w", datasetPath, err)
		}
		return validateRecords(records, requireExpectedLabels)
	}

	return loadJSONLDataset(datasetPath, trimmed, requireExpectedLabels)
}

func loadDifficultyDataset(datasetPath string) ([]datasetRecord, error) {
	payload, err := os.ReadFile(datasetPath)
	if err != nil {
		return nil, fmt.Errorf("read difficulty dataset %q: %w", datasetPath, err)
	}

	trimmed := strings.TrimPrefix(strings.TrimSpace(string(payload)), "\ufeff")
	if trimmed == "" {
		return nil, fmt.Errorf("difficulty dataset %q is empty", datasetPath)
	}

	if strings.HasPrefix(trimmed, "[") {
		var records []datasetRecord
		if err := json.Unmarshal([]byte(trimmed), &records); err != nil {
			return nil, fmt.Errorf("decode difficulty JSON dataset %q: %w", datasetPath, err)
		}
		return validateDifficultyRecords(records)
	}

	scanner := bufio.NewScanner(strings.NewReader(trimmed))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	records := []datasetRecord{}
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var record datasetRecord
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			return nil, fmt.Errorf("decode difficulty JSONL dataset %q line %d: %w", datasetPath, lineNumber, err)
		}
		records = append(records, record)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read difficulty JSONL dataset %q: %w", datasetPath, err)
	}
	return validateDifficultyRecords(records)
}

func validateDifficultyRecords(records []datasetRecord) ([]datasetRecord, error) {
	if len(records) == 0 {
		return nil, fmt.Errorf("difficulty dataset has no records")
	}

	for index, record := range records {
		if strings.TrimSpace(record.SampleID) == "" {
			return nil, fmt.Errorf("record %d: sampleId is required", index+1)
		}
		if record.RedactedPrompt == nil {
			return nil, fmt.Errorf("record %d: redactedPrompt is required; legacy prompt is not allowed", index+1)
		}
		if strings.TrimSpace(record.LegacyID) != "" || record.Prompt != nil {
			return nil, fmt.Errorf("record %d: legacy id/prompt is not allowed", index+1)
		}
		if strings.TrimSpace(record.SchemaVersion) != difficultyRecordV1 {
			return nil, fmt.Errorf("record %d: unsupported schemaVersion %q", index+1, record.SchemaVersion)
		}
		if !isV2Category(record.ExpectedCategory) {
			return nil, fmt.Errorf("record %d: unsupported expectedCategory %q", index+1, record.ExpectedCategory)
		}
		switch strings.TrimSpace(record.ExpectedDifficulty) {
		case routing.DifficultySimple, routing.DifficultyComplex:
		default:
			return nil, fmt.Errorf("record %d: unsupported expectedDifficulty %q", index+1, record.ExpectedDifficulty)
		}
		if strings.TrimSpace(record.Language) == "" {
			return nil, fmt.Errorf("record %d: language is required", index+1)
		}
		if record.ExpectedTier != nil {
			return nil, fmt.Errorf("record %d: expectedTier is not allowed for %s", index+1, difficultyRecordV1)
		}
	}
	return records, nil
}

func loadJSONLDataset(datasetPath string, payload string, requireExpectedLabels bool) ([]datasetRecord, error) {
	scanner := bufio.NewScanner(strings.NewReader(payload))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	records := []datasetRecord{}
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var record datasetRecord
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			return nil, fmt.Errorf("decode JSONL dataset %q line %d: %w", datasetPath, lineNumber, err)
		}
		records = append(records, record)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read JSONL dataset %q: %w", datasetPath, err)
	}

	return validateRecords(records, requireExpectedLabels)
}

func validateRecords(records []datasetRecord, requireExpectedLabels bool) ([]datasetRecord, error) {
	if len(records) == 0 {
		return nil, fmt.Errorf("dataset has no records")
	}

	for index, record := range records {
		if requireExpectedLabels {
			if strings.TrimSpace(record.SampleID) == "" {
				return nil, fmt.Errorf("record %d: sampleId is required", index+1)
			}
			if record.RedactedPrompt == nil {
				return nil, fmt.Errorf("record %d: redactedPrompt is required; legacy prompt is not allowed", index+1)
			}
			if strings.TrimSpace(record.LegacyID) != "" {
				return nil, fmt.Errorf("record %d: legacy id is not allowed", index+1)
			}
			if record.Prompt != nil {
				return nil, fmt.Errorf("record %d: legacy prompt is not allowed; use redactedPrompt", index+1)
			}
		}
		if strings.TrimSpace(record.expectedID()) == "" {
			return nil, fmt.Errorf("record %d: sampleId or id is required", index+1)
		}
		if requireExpectedLabels {
			schemaVersion := strings.TrimSpace(record.SchemaVersion)
			if schemaVersion == "" {
				return nil, fmt.Errorf("record %d: schemaVersion is required", index+1)
			}
			if schemaVersion != categoryRecordV2 {
				return nil, fmt.Errorf("record %d: unsupported schemaVersion %q", index+1, schemaVersion)
			}
		}
		if requireExpectedLabels && strings.TrimSpace(record.ExpectedCategory) == "" {
			return nil, fmt.Errorf("record %d: expectedCategory is required", index+1)
		}
		if requireExpectedLabels && record.ExpectedTier != nil {
			return nil, fmt.Errorf("record %d: expectedTier is not allowed for %s", index+1, categoryRecordV2)
		}
		if requireExpectedLabels && strings.TrimSpace(record.ExpectedDifficulty) != "" {
			return nil, fmt.Errorf("record %d: expectedDifficulty is not allowed for %s", index+1, categoryRecordV2)
		}
		if requireExpectedLabels && !isV2Category(record.ExpectedCategory) {
			return nil, fmt.Errorf("record %d: unsupported expectedCategory %q", index+1, record.ExpectedCategory)
		}
	}

	return records, nil
}

func isV2Category(category string) bool {
	switch strings.TrimSpace(category) {
	case routing.CategoryGeneral, routing.CategoryCode, routing.CategoryTranslation, routing.CategorySummarization, routing.CategoryReasoning:
		return true
	default:
		return false
	}
}

func evaluate(datasetPath string, classifierVersion string, records []datasetRecord, latencyIterations int) report {
	if latencyIterations <= 0 {
		latencyIterations = 1
	}
	classifier := routing.NewRuleBasedCategoryClassifier()
	result := report{
		DatasetPath:       datasetPath,
		ClassifierName:    defaultClassifierName,
		ClassifierVersion: classifierVersion,
		TotalSamples:      len(records),
		ByCategory:        map[string]categoryStats{},
		ConfusionMatrix:   map[string]map[string]int{},
		Failures:          []evaluationFailure{},
	}

	latencies := []float64{}
	for _, record := range records {
		expected := strings.TrimSpace(record.ExpectedCategory)
		categoryResult, sampleLatencies := classifyCategoryWithLatency(classifier, record.promptText(), latencyIterations)
		actual := categoryResult.Category
		latencies = append(latencies, sampleLatencies...)
		result.Samples = append(result.Samples, evaluationSample{
			SampleID:            record.expectedID(),
			RedactedPrompt:      record.promptText(),
			ExpectedCategory:    expected,
			ExpectedCategoryKo:  categoryLabelKo(expected),
			ActualCategory:      actual,
			ActualCategoryKo:    categoryLabelKo(actual),
			CategoryDiagnostics: categoryResult.Diagnostics.WithSelectedCategory(actual),
			Matched:             actual == expected,
		})

		stats := result.ByCategory[expected]
		stats.LabelKo = categoryLabelKo(expected)
		stats.Total++
		if actual == expected {
			stats.Correct++
			result.CorrectSamples++
		} else {
			result.Failures = append(result.Failures, evaluationFailure{
				SampleID:         record.expectedID(),
				RedactedPrompt:   record.promptText(),
				ExpectedCategory: expected,
				ActualCategory:   actual,
			})
		}
		stats.Incorrect = stats.Total - stats.Correct
		stats.Accuracy = ratio(stats.Correct, stats.Total)
		stats.IncorrectRate = ratio(stats.Incorrect, stats.Total)
		result.ByCategory[expected] = stats

		if _, ok := result.ConfusionMatrix[expected]; !ok {
			result.ConfusionMatrix[expected] = map[string]int{}
		}
		result.ConfusionMatrix[expected][actual]++
	}

	result.IncorrectSamples = result.TotalSamples - result.CorrectSamples
	result.Accuracy = ratio(result.CorrectSamples, result.TotalSamples)
	result.ErrorRate = ratio(result.IncorrectSamples, result.TotalSamples)
	result.Latency = summarizeLatency(latencies, latencyIterations)
	sortFailures(result.Failures)
	result.SummaryKo = buildEvaluationSummaryKo(result)
	return result
}

func evaluateDifficulty(datasetPath string, classifierVersion string, records []datasetRecord, latencyIterations int) difficultyReport {
	if latencyIterations <= 0 {
		latencyIterations = 1
	}
	calibrationRecords, holdoutRecords, split := splitDifficultyRecords(records)
	result := difficultyReport{
		DatasetPath:         datasetPath,
		ClassifierName:      defaultDifficultyClassifierName,
		ClassifierVersion:   classifierVersion,
		ScorePolicyVersion:  routing.DifficultyScorePolicyVersion(),
		ComplexityThreshold: routing.DifficultyScoreThreshold(),
		Split:               split,
		FullDataset:         evaluateDifficultyPair(records, true),
		Calibration:         evaluateDifficultyPair(calibrationRecords, false),
		Holdout:             evaluateDifficultyPair(holdoutRecords, false),
	}
	result.ClassificationLatency = measureDifficultyLatency(records, latencyIterations)
	return result
}

func evaluateDifficultyPair(records []datasetRecord, includeSamples bool) difficultyEvaluationPair {
	return difficultyEvaluationPair{
		OracleCategory: evaluateDifficultyRecords(records, true, includeSamples),
		EndToEnd:       evaluateDifficultyRecords(records, false, includeSamples),
	}
}

func evaluateDifficultyRecords(records []datasetRecord, oracleCategory bool, includeSamples bool) difficultyEvaluationResult {
	categoryClassifier := routing.NewRuleBasedCategoryClassifier()
	difficultyClassifier := routing.NewRuleBasedDifficultyClassifier()
	result := difficultyEvaluationResult{
		TotalSamples:              len(records),
		ByCategoryDifficulty:      map[string]map[string]categoryStats{},
		ScoreBuckets:              emptyDifficultyScoreBuckets(),
		ByExpectedDifficultyScore: map[string]scoreDistributionStats{},
		Failures:                  []difficultyEvaluationFailure{},
		Samples:                   []difficultyEvaluationSample{},
	}
	scoresByExpectedDifficulty := map[string][]float64{}

	for _, record := range records {
		expectedCategory := strings.TrimSpace(record.ExpectedCategory)
		expectedDifficulty := strings.TrimSpace(record.ExpectedDifficulty)
		prompt := record.promptText()

		features := routing.ExtractPromptFeatures(prompt)
		actualCategory := categoryClassifier.ClassifyFeatures(features).Category
		difficultyCategory := actualCategory
		if oracleCategory {
			difficultyCategory = expectedCategory
		}
		difficultyFeatures := routing.ExtractDifficultyFeatures(features, difficultyCategory)
		difficultyResult := difficultyClassifier.ClassifyFeatures(difficultyFeatures)
		actualDifficulty := difficultyResult.Difficulty
		complexityScore := round4(difficultyResult.ComplexityScore)
		scoresByExpectedDifficulty[expectedDifficulty] = append(scoresByExpectedDifficulty[expectedDifficulty], complexityScore)
		result.ScoreBuckets[difficultyScoreBucket(complexityScore)]++

		matched := actualDifficulty == expectedDifficulty
		if includeSamples {
			result.Samples = append(result.Samples, difficultyEvaluationSample{
				SampleID:           record.expectedID(),
				RedactedPrompt:     prompt,
				ExpectedCategory:   expectedCategory,
				ActualCategory:     actualCategory,
				ExpectedDifficulty: expectedDifficulty,
				ActualDifficulty:   actualDifficulty,
				ComplexityScore:    complexityScore,
				CategoryMatched:    actualCategory == expectedCategory,
				Matched:            matched,
			})
		}

		if _, ok := result.ByCategoryDifficulty[expectedCategory]; !ok {
			result.ByCategoryDifficulty[expectedCategory] = map[string]categoryStats{}
		}
		stats := result.ByCategoryDifficulty[expectedCategory][expectedDifficulty]
		stats.Total++
		if matched {
			stats.Correct++
			result.CorrectSamples++
		} else {
			result.Failures = append(result.Failures, difficultyEvaluationFailure{
				SampleID:           record.expectedID(),
				RedactedPrompt:     prompt,
				ExpectedCategory:   expectedCategory,
				ActualCategory:     actualCategory,
				ExpectedDifficulty: expectedDifficulty,
				ActualDifficulty:   actualDifficulty,
				ComplexityScore:    complexityScore,
			})
		}
		stats.Incorrect = stats.Total - stats.Correct
		stats.Accuracy = ratio(stats.Correct, stats.Total)
		stats.IncorrectRate = ratio(stats.Incorrect, stats.Total)
		result.ByCategoryDifficulty[expectedCategory][expectedDifficulty] = stats

		switch expectedDifficulty {
		case routing.DifficultySimple:
			result.DirectionalErrors.SimpleExpectedSamples++
			if actualDifficulty == routing.DifficultyComplex {
				result.DirectionalErrors.SimpleToComplexCount++
			}
		case routing.DifficultyComplex:
			result.DirectionalErrors.ComplexExpectedSamples++
			if actualDifficulty == routing.DifficultySimple {
				result.DirectionalErrors.ComplexToSimpleCount++
			}
		}
	}

	result.IncorrectSamples = result.TotalSamples - result.CorrectSamples
	result.Accuracy = ratio(result.CorrectSamples, result.TotalSamples)
	result.ErrorRate = ratio(result.IncorrectSamples, result.TotalSamples)
	result.DirectionalErrors.SimpleToComplexRate = ratio(
		result.DirectionalErrors.SimpleToComplexCount,
		result.DirectionalErrors.SimpleExpectedSamples,
	)
	result.DirectionalErrors.ComplexToSimpleRate = ratio(
		result.DirectionalErrors.ComplexToSimpleCount,
		result.DirectionalErrors.ComplexExpectedSamples,
	)
	for _, difficulty := range []string{routing.DifficultySimple, routing.DifficultyComplex} {
		result.ByExpectedDifficultyScore[difficulty] = summarizeScores(scoresByExpectedDifficulty[difficulty])
	}
	sort.Slice(result.Failures, func(left int, right int) bool {
		return result.Failures[left].SampleID < result.Failures[right].SampleID
	})
	return result
}

func measureDifficultyLatency(records []datasetRecord, latencyIterations int) classificationLatencyStats {
	categoryClassifier := routing.NewRuleBasedCategoryClassifier()
	difficultyClassifier := routing.NewRuleBasedDifficultyClassifier()
	promptClassifier := routing.NewRuleBasedPromptClassifier()
	categoryLatencies := []float64{}
	difficultyLatencies := []float64{}
	totalLatencies := []float64{}
	for _, record := range records {
		prompt := record.promptText()
		categoryResult, sampleCategoryLatencies := classifyCategoryWithLatency(categoryClassifier, prompt, latencyIterations)
		features := routing.ExtractPromptFeatures(prompt)
		_, sampleDifficultyLatencies := classifyDifficultyWithLatency(difficultyClassifier, features, categoryResult.Category, latencyIterations)
		sampleTotalLatencies := classifyTotalWithLatency(promptClassifier, prompt, latencyIterations)
		categoryLatencies = append(categoryLatencies, sampleCategoryLatencies...)
		difficultyLatencies = append(difficultyLatencies, sampleDifficultyLatencies...)
		totalLatencies = append(totalLatencies, sampleTotalLatencies...)
	}
	return classificationLatencyStats{
		Unit:       "microseconds",
		Category:   summarizeLatency(categoryLatencies, latencyIterations),
		Difficulty: summarizeLatency(difficultyLatencies, latencyIterations),
		Total:      summarizeLatency(totalLatencies, latencyIterations),
	}
}

func classifyDifficultyWithLatency(classifier routing.RuleBasedDifficultyClassifier, features routing.PromptFeatures, category string, iterations int) (routing.DifficultyResult, []float64) {
	latencies := make([]float64, 0, iterations)
	var actual routing.DifficultyResult
	for i := 0; i < iterations; i++ {
		start := time.Now()
		difficultyFeatures := routing.ExtractDifficultyFeatures(features, category)
		actual = classifier.ClassifyFeatures(difficultyFeatures)
		latencies = append(latencies, durationMicros(time.Since(start)))
	}
	return actual, latencies
}

func splitDifficultyRecords(records []datasetRecord) ([]datasetRecord, []datasetRecord, difficultySplitSummary) {
	familiesByCell := map[string]map[string]bool{}
	for _, record := range records {
		cell := strings.TrimSpace(record.ExpectedCategory) + "/" + strings.TrimSpace(record.ExpectedDifficulty)
		if familiesByCell[cell] == nil {
			familiesByCell[cell] = map[string]bool{}
		}
		familiesByCell[cell][difficultyFamilyKey(record.expectedID())] = true
	}

	holdoutFamilies := map[string]bool{}
	allFamilies := map[string]bool{}
	for _, familySet := range familiesByCell {
		families := make([]string, 0, len(familySet))
		for family := range familySet {
			families = append(families, family)
			allFamilies[family] = true
		}
		sort.Slice(families, func(left int, right int) bool {
			leftHash := sha256.Sum256([]byte(families[left]))
			rightHash := sha256.Sum256([]byte(families[right]))
			return string(leftHash[:]) < string(rightHash[:])
		})
		holdoutCount := 0
		if len(families) >= 5 {
			holdoutCount = len(families) / 5
		}
		for index := 0; index < holdoutCount; index++ {
			holdoutFamilies[families[index]] = true
		}
	}

	calibration := make([]datasetRecord, 0, len(records))
	holdout := make([]datasetRecord, 0, len(records)/5)
	calibrationFamilies := map[string]bool{}
	for _, record := range records {
		family := difficultyFamilyKey(record.expectedID())
		if holdoutFamilies[family] {
			holdout = append(holdout, record)
		} else {
			calibration = append(calibration, record)
			calibrationFamilies[family] = true
		}
	}
	return calibration, holdout, difficultySplitSummary{
		Algorithm:           "sha256-lowest-20-percent-per-category-difficulty-cell-v1",
		FamilyKeyRule:       "expectedCategory/expectedDifficulty/fNN; vNN variants stay together",
		CalibrationSamples:  len(calibration),
		HoldoutSamples:      len(holdout),
		CalibrationFamilies: len(calibrationFamilies),
		HoldoutFamilies:     len(allFamilies) - len(calibrationFamilies),
	}
}

func difficultyFamilyKey(sampleID string) string {
	parts := strings.Split(sampleID, "_")
	if len(parts) >= 7 {
		return strings.Join([]string{parts[1], parts[2], parts[len(parts)-2]}, "/")
	}
	if index := strings.LastIndex(sampleID, "_v"); index >= 0 {
		return sampleID[:index]
	}
	return sampleID
}

func emptyDifficultyScoreBuckets() map[string]int {
	return map[string]int{
		"0.0-0.2": 0,
		"0.2-0.4": 0,
		"0.4-0.6": 0,
		"0.6-0.8": 0,
		"0.8-1.0": 0,
	}
}

func difficultyScoreBucket(score float64) string {
	switch {
	case score < 0.2:
		return "0.0-0.2"
	case score < 0.4:
		return "0.2-0.4"
	case score < 0.6:
		return "0.4-0.6"
	case score < 0.8:
		return "0.6-0.8"
	default:
		return "0.8-1.0"
	}
}

func summarizeScores(scores []float64) scoreDistributionStats {
	if len(scores) == 0 {
		return scoreDistributionStats{}
	}
	values := append([]float64(nil), scores...)
	sort.Float64s(values)
	total := 0.0
	for _, score := range values {
		total += score
	}
	return scoreDistributionStats{
		Count: len(values),
		Min:   round4(values[0]),
		Avg:   round4(total / float64(len(values))),
		P50:   round4(percentile(values, 0.50)),
		P95:   round4(percentile(values, 0.95)),
		Max:   round4(values[len(values)-1]),
	}
}

func classifyTotalWithLatency(classifier routing.RuleBasedPromptClassifier, prompt string, iterations int) []float64 {
	latencies := make([]float64, 0, iterations)
	for i := 0; i < iterations; i++ {
		start := time.Now()
		_ = classifier.Classify(prompt)
		latencies = append(latencies, durationMicros(time.Since(start)))
	}
	return latencies
}

func marshalDifficultyReport(result difficultyReport, pretty bool) ([]byte, error) {
	if pretty {
		return json.MarshalIndent(result, "", "  ")
	}
	return json.Marshal(result)
}

func classifyCategoryWithLatency(classifier routing.RuleBasedCategoryClassifier, prompt string, iterations int) (routing.CategoryResult, []float64) {
	latencies := make([]float64, 0, iterations)
	var result routing.CategoryResult
	for i := 0; i < iterations; i++ {
		start := time.Now()
		features := routing.ExtractPromptFeatures(prompt)
		result = classifier.ClassifyFeatures(features)
		latencies = append(latencies, durationMicros(time.Since(start)))
	}
	return result, latencies
}

func probe(datasetPath string, classifierVersion string, records []datasetRecord, latencyIterations int) probeReport {
	if latencyIterations <= 0 {
		latencyIterations = 1
	}
	classifier := routing.NewRuleBasedCategoryClassifier()
	result := probeReport{
		Mode:              modeProbe,
		DatasetPath:       datasetPath,
		ClassifierName:    defaultClassifierName,
		ClassifierVersion: classifierVersion,
		TotalSamples:      len(records),
		ByCategory:        map[string]probeStat{},
		Samples:           []probeSample{},
	}

	latencies := []float64{}
	for _, record := range records {
		categoryResult, sampleLatencies := classifyCategoryWithLatency(classifier, record.promptText(), latencyIterations)
		category := categoryResult.Category
		latencies = append(latencies, sampleLatencies...)

		categoryStat := result.ByCategory[category]
		categoryStat.LabelKo = categoryLabelKo(category)
		categoryStat.Total++
		result.ByCategory[category] = categoryStat

		result.Samples = append(result.Samples, probeSample{
			SampleID:            record.expectedID(),
			RedactedPrompt:      record.promptText(),
			Category:            category,
			CategoryKo:          categoryLabelKo(category),
			CategoryDiagnostics: categoryResult.Diagnostics.WithSelectedCategory(category),
		})
	}

	result.ByCategory = finalizeProbeStats(result.ByCategory, result.TotalSamples)
	result.Latency = summarizeLatency(latencies, latencyIterations)
	sortProbeSamples(result.Samples)
	result.SummaryKo = buildProbeSummaryKo(result)
	return result
}

func (r datasetRecord) expectedID() string {
	if strings.TrimSpace(r.SampleID) != "" {
		return strings.TrimSpace(r.SampleID)
	}
	return strings.TrimSpace(r.LegacyID)
}

func (r datasetRecord) promptText() string {
	if r.RedactedPrompt != nil {
		return *r.RedactedPrompt
	}
	if r.Prompt != nil {
		return *r.Prompt
	}
	return ""
}

func ratio(numerator int, denominator int) float64 {
	if denominator <= 0 {
		return 0
	}
	return ratioFloat(float64(numerator), float64(denominator))
}

func ratioFloat(numerator float64, denominator float64) float64 {
	if denominator <= 0 {
		return 0
	}
	return round4(numerator / denominator)
}

func round4(value float64) float64 {
	return math.Round(value*10000) / 10000
}

func summarizeLatency(latencies []float64, iterations int) latencyStats {
	if len(latencies) == 0 {
		return latencyStats{Iterations: iterations}
	}
	totalMicros := 0.0
	for _, latency := range latencies {
		totalMicros += latency
	}
	sort.Float64s(latencies)
	return latencyStats{
		Iterations: iterations,
		Samples:    len(latencies),
		AvgMicros:  round4(totalMicros / float64(len(latencies))),
		P50Micros:  round4(percentile(latencies, 0.50)),
		P95Micros:  round4(percentile(latencies, 0.95)),
		MaxMicros:  round4(latencies[len(latencies)-1]),
	}
}

func durationMicros(duration time.Duration) float64 {
	micros := float64(duration.Nanoseconds()) / 1000
	if micros <= 0 {
		return 0.001
	}
	return micros
}

func percentile(sortedValues []float64, p float64) float64 {
	if len(sortedValues) == 0 {
		return 0
	}
	if p <= 0 {
		return sortedValues[0]
	}
	if p >= 1 {
		return sortedValues[len(sortedValues)-1]
	}
	index := int(math.Ceil(float64(len(sortedValues))*p)) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(sortedValues) {
		index = len(sortedValues) - 1
	}
	return sortedValues[index]
}

func buildEvaluationSummaryKo(result report) evaluationSummaryKo {
	return evaluationSummaryKo{
		Title:                "카테고리 분류 정답 평가 리포트",
		Purpose:              "정답이 있는 평가셋으로 category 분류가 기대대로 맞는지 확인한다.",
		DatasetPath:          result.DatasetPath,
		TotalSamples:         result.TotalSamples,
		CategoryAccuracy:     result.Accuracy,
		CategoryErrorRate:    result.ErrorRate,
		AvgLatencyMicros:     result.Latency.AvgMicros,
		P95LatencyMicros:     result.Latency.P95Micros,
		FailureCount:         len(result.Failures),
		CategoryDistribution: summarizeCategoryStatsKo(result.ByCategory),
		HowToRead:            "정확도는 정답 category와 분류 결과가 일치한 비율이고, 실패수는 사람이 분류 규칙 또는 평가셋을 보정해야 할 후보 수다.",
	}
}

func buildProbeSummaryKo(result probeReport) probeSummaryKo {
	return probeSummaryKo{
		Title:                "카테고리 분포 관찰 리포트",
		Purpose:              "정답이 없는 샘플이 현재 분류 규칙에서 어떤 category로 분산되는지 확인한다.",
		DatasetPath:          result.DatasetPath,
		TotalSamples:         result.TotalSamples,
		AvgLatencyMicros:     result.Latency.AvgMicros,
		P95LatencyMicros:     result.Latency.P95Micros,
		CategoryDistribution: summarizeProbeStatsKo(result.ByCategory),
		HowToRead:            "정답률을 보는 리포트가 아니라 category 분포와 general 쏠림을 관찰하는 리포트다.",
	}
}

func summarizeCategoryStatsKo(stats map[string]categoryStats) []koreanStatSummary {
	keys := make([]string, 0, len(stats))
	for key := range stats {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	summaries := make([]koreanStatSummary, 0, len(keys))
	for _, key := range keys {
		stat := stats[key]
		label := stat.LabelKo
		if label == "" {
			label = categoryLabelKo(key)
		}
		summaries = append(summaries, koreanStatSummary{
			Key:       key,
			LabelKo:   label,
			Total:     stat.Total,
			Correct:   stat.Correct,
			Incorrect: stat.Incorrect,
			Accuracy:  stat.Accuracy,
		})
	}
	return summaries
}

func summarizeProbeStatsKo(stats map[string]probeStat) []koreanStatSummary {
	keys := make([]string, 0, len(stats))
	for key := range stats {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	summaries := make([]koreanStatSummary, 0, len(keys))
	for _, key := range keys {
		stat := stats[key]
		label := stat.LabelKo
		if label == "" {
			label = categoryLabelKo(key)
		}
		summaries = append(summaries, koreanStatSummary{
			Key:     key,
			LabelKo: label,
			Total:   stat.Total,
			Rate:    stat.Rate,
		})
	}
	return summaries
}

func categoryLabelKo(category string) string {
	switch category {
	case routing.CategoryGeneral:
		return "일반 요청"
	case routing.CategoryCode:
		return "코드/개발"
	case routing.CategoryTranslation:
		return "번역"
	case routing.CategorySummarization:
		return "요약"
	case routing.CategoryReasoning:
		return "비교/판단/추론"
	default:
		return category
	}
}

func marshalReport(report report, pretty bool) ([]byte, error) {
	if pretty {
		return json.MarshalIndent(report, "", "  ")
	}
	return json.Marshal(report)
}

func marshalProbeReport(report probeReport, pretty bool) ([]byte, error) {
	if pretty {
		return json.MarshalIndent(report, "", "  ")
	}
	return json.Marshal(report)
}

func sortFailures(failures []evaluationFailure) {
	sort.Slice(failures, func(i int, j int) bool {
		return failures[i].SampleID < failures[j].SampleID
	})
}

func finalizeProbeStats(stats map[string]probeStat, total int) map[string]probeStat {
	for key, stat := range stats {
		stat.Rate = ratio(stat.Total, total)
		stats[key] = stat
	}
	return stats
}

func sortProbeSamples(samples []probeSample) {
	sort.Slice(samples, func(i int, j int) bool {
		return samples[i].SampleID < samples[j].SampleID
	})
}

func exitWithError(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
