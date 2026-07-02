package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/routing"
)

const (
	defaultClassifierName    = "rule_based_category_classifier"
	defaultClassifierVersion = "rule_based_category_classifier_v1"
	defaultDatasetPath       = "docs/v2.1.0/fixtures/category-evaluation-dataset.fixture.jsonl"
)

type datasetRecord struct {
	SampleID         string  `json:"sampleId"`
	LegacyID         string  `json:"id"`
	RedactedPrompt   *string `json:"redactedPrompt"`
	Prompt           *string `json:"prompt"`
	ExpectedCategory string  `json:"expectedCategory"`
}

type report struct {
	DatasetPath       string                    `json:"datasetPath"`
	ClassifierName    string                    `json:"classifierName"`
	ClassifierVersion string                    `json:"classifierVersion"`
	TotalSamples      int                       `json:"totalSamples"`
	CorrectSamples    int                       `json:"correctSamples"`
	Accuracy          float64                   `json:"accuracy"`
	ByCategory        map[string]categoryStats  `json:"byCategory"`
	ConfusionMatrix   map[string]map[string]int `json:"confusionMatrix"`
	Failures          []classificationFailure   `json:"failures"`
}

type categoryStats struct {
	Correct  int     `json:"correct"`
	Total    int     `json:"total"`
	Accuracy float64 `json:"accuracy"`
}

type classificationFailure struct {
	SampleID         string `json:"sampleId"`
	ExpectedCategory string `json:"expectedCategory"`
	ActualCategory   string `json:"actualCategory"`
}

func main() {
	datasetPath := flag.String("dataset", defaultDatasetPath, "category evaluation dataset path (.jsonl or .json)")
	outputPath := flag.String("output", "", "optional report output path")
	classifierVersion := flag.String("classifier-version", defaultClassifierVersion, "classifier version label for the report")
	minAccuracy := flag.Float64("min-accuracy", 0, "optional minimum exact-match accuracy, from 0 to 1")
	pretty := flag.Bool("pretty", true, "pretty-print JSON report")
	flag.Parse()

	records, err := loadDataset(*datasetPath)
	if err != nil {
		exitWithError(err)
	}

	report := evaluate(*datasetPath, *classifierVersion, records)
	payload, err := marshalReport(report, *pretty)
	if err != nil {
		exitWithError(err)
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

	if *minAccuracy > 0 && report.Accuracy < *minAccuracy {
		exitWithError(fmt.Errorf("accuracy %.4f is below minimum %.4f", report.Accuracy, *minAccuracy))
	}
}

func loadDataset(datasetPath string) ([]datasetRecord, error) {
	payload, err := os.ReadFile(datasetPath)
	if err != nil {
		return nil, fmt.Errorf("read dataset %q: %w", datasetPath, err)
	}

	trimmed := strings.TrimSpace(string(payload))
	if trimmed == "" {
		return nil, fmt.Errorf("dataset %q is empty", datasetPath)
	}

	if strings.HasPrefix(trimmed, "[") {
		var records []datasetRecord
		if err := json.Unmarshal(payload, &records); err != nil {
			return nil, fmt.Errorf("decode JSON dataset %q: %w", datasetPath, err)
		}
		return validateRecords(records)
	}

	return loadJSONLDataset(datasetPath, trimmed)
}

func loadJSONLDataset(datasetPath string, payload string) ([]datasetRecord, error) {
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

	return validateRecords(records)
}

func validateRecords(records []datasetRecord) ([]datasetRecord, error) {
	if len(records) == 0 {
		return nil, fmt.Errorf("dataset has no records")
	}

	for index, record := range records {
		if strings.TrimSpace(record.expectedID()) == "" {
			return nil, fmt.Errorf("record %d: sampleId or id is required", index+1)
		}
		if strings.TrimSpace(record.ExpectedCategory) == "" {
			return nil, fmt.Errorf("record %d: expectedCategory is required", index+1)
		}
	}

	return records, nil
}

func evaluate(datasetPath string, classifierVersion string, records []datasetRecord) report {
	classifier := routing.NewRuleBasedCategoryClassifier()
	result := report{
		DatasetPath:       datasetPath,
		ClassifierName:    defaultClassifierName,
		ClassifierVersion: classifierVersion,
		TotalSamples:      len(records),
		ByCategory:        map[string]categoryStats{},
		ConfusionMatrix:   map[string]map[string]int{},
		Failures:          []classificationFailure{},
	}

	for _, record := range records {
		expected := strings.TrimSpace(record.ExpectedCategory)
		actual := classifier.Classify(record.promptText())

		stats := result.ByCategory[expected]
		stats.Total++
		if actual == expected {
			stats.Correct++
			result.CorrectSamples++
		} else {
			result.Failures = append(result.Failures, classificationFailure{
				SampleID:         record.expectedID(),
				ExpectedCategory: expected,
				ActualCategory:   actual,
			})
		}
		stats.Accuracy = ratio(stats.Correct, stats.Total)
		result.ByCategory[expected] = stats

		if _, ok := result.ConfusionMatrix[expected]; !ok {
			result.ConfusionMatrix[expected] = map[string]int{}
		}
		result.ConfusionMatrix[expected][actual]++
	}

	result.Accuracy = ratio(result.CorrectSamples, result.TotalSamples)
	sortFailures(result.Failures)
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
	value := float64(numerator) / float64(denominator)
	return math.Round(value*10000) / 10000
}

func marshalReport(report report, pretty bool) ([]byte, error) {
	if pretty {
		return json.MarshalIndent(report, "", "  ")
	}
	return json.Marshal(report)
}

func sortFailures(failures []classificationFailure) {
	sort.Slice(failures, func(i int, j int) bool {
		return failures[i].SampleID < failures[j].SampleID
	})
}

func exitWithError(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
