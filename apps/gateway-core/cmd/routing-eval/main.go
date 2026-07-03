package main

import (
	"bufio"
	"context"
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
	defaultClassifierName    = "rule_based_category_classifier"
	defaultClassifierVersion = "rule_based_category_classifier_v1"
	defaultDatasetPath       = "docs/v2.1.0/fixtures/category-evaluation-dataset.fixture.jsonl"
	defaultLatencyIterations = 20

	tierCostLowCost     = 1
	tierCostBalanced    = 3
	tierCostHighQuality = 10
)

type datasetRecord struct {
	SampleID         string  `json:"sampleId"`
	LegacyID         string  `json:"id"`
	RedactedPrompt   *string `json:"redactedPrompt"`
	Prompt           *string `json:"prompt"`
	ExpectedCategory string  `json:"expectedCategory"`
	ExpectedTier     string  `json:"expectedTier"`
}

type report struct {
	DatasetPath        string                    `json:"datasetPath"`
	ClassifierName     string                    `json:"classifierName"`
	ClassifierVersion  string                    `json:"classifierVersion"`
	TotalSamples       int                       `json:"totalSamples"`
	CorrectSamples     int                       `json:"correctSamples"`
	Accuracy           float64                   `json:"accuracy"`
	TierLabeledSamples int                       `json:"tierLabeledSamples"`
	TierCorrectSamples int                       `json:"tierCorrectSamples"`
	TierAccuracy       float64                   `json:"tierAccuracy"`
	ByCategory         map[string]categoryStats  `json:"byCategory"`
	ByTier             map[string]categoryStats  `json:"byTier"`
	ConfusionMatrix    map[string]map[string]int `json:"confusionMatrix"`
	Latency            latencyStats              `json:"latency"`
	CostEstimate       costEstimate              `json:"costEstimate"`
	Failures           []evaluationFailure       `json:"failures"`
}

type categoryStats struct {
	Correct  int     `json:"correct"`
	Total    int     `json:"total"`
	Accuracy float64 `json:"accuracy"`
}

type latencyStats struct {
	Iterations int     `json:"iterations"`
	Samples    int     `json:"samples"`
	P50Micros  float64 `json:"p50Micros"`
	P95Micros  float64 `json:"p95Micros"`
	MaxMicros  float64 `json:"maxMicros"`
}

type costEstimate struct {
	BaselineTier      string             `json:"baselineTier"`
	BaselineCostUnits float64            `json:"baselineCostUnits"`
	ActualCostUnits   float64            `json:"actualCostUnits"`
	SavedCostUnits    float64            `json:"savedCostUnits"`
	SavingRate        float64            `json:"savingRate"`
	UnitRates         map[string]float64 `json:"unitRates"`
}

type evaluationFailure struct {
	SampleID         string `json:"sampleId"`
	ExpectedCategory string `json:"expectedCategory"`
	ActualCategory   string `json:"actualCategory"`
	ExpectedTier     string `json:"expectedTier,omitempty"`
	ActualTier       string `json:"actualTier,omitempty"`
}

func main() {
	datasetPath := flag.String("dataset", defaultDatasetPath, "category evaluation dataset path (.jsonl or .json)")
	outputPath := flag.String("output", "", "optional report output path")
	classifierVersion := flag.String("classifier-version", defaultClassifierVersion, "classifier version label for the report")
	minAccuracy := flag.Float64("min-accuracy", 0, "optional minimum exact-match accuracy, from 0 to 1")
	minTierAccuracy := flag.Float64("min-tier-accuracy", 0, "optional minimum tier exact-match accuracy, from 0 to 1")
	latencyIterations := flag.Int("latency-iterations", defaultLatencyIterations, "routing decision iterations per sample for latency measurement")
	pretty := flag.Bool("pretty", true, "pretty-print JSON report")
	flag.Parse()

	records, err := loadDataset(*datasetPath)
	if err != nil {
		exitWithError(err)
	}

	evalReport := evaluate(*datasetPath, *classifierVersion, records, *latencyIterations)
	payload, err := marshalReport(evalReport, *pretty)
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

	if *minAccuracy > 0 && evalReport.Accuracy < *minAccuracy {
		exitWithError(fmt.Errorf("accuracy %.4f is below minimum %.4f", evalReport.Accuracy, *minAccuracy))
	}
	if *minTierAccuracy > 0 && evalReport.TierLabeledSamples > 0 && evalReport.TierAccuracy < *minTierAccuracy {
		exitWithError(fmt.Errorf("tier accuracy %.4f is below minimum %.4f", evalReport.TierAccuracy, *minTierAccuracy))
	}
}

func loadDataset(datasetPath string) ([]datasetRecord, error) {
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

func evaluate(datasetPath string, classifierVersion string, records []datasetRecord, latencyIterations int) report {
	if latencyIterations <= 0 {
		latencyIterations = 1
	}
	router := routing.NewSimpleRouter(routing.SimpleRouterConfig{})
	result := report{
		DatasetPath:       datasetPath,
		ClassifierName:    defaultClassifierName,
		ClassifierVersion: classifierVersion,
		TotalSamples:      len(records),
		ByCategory:        map[string]categoryStats{},
		ByTier:            map[string]categoryStats{},
		ConfusionMatrix:   map[string]map[string]int{},
		Failures:          []evaluationFailure{},
		CostEstimate: costEstimate{
			BaselineTier: routing.TierHighQuality,
			UnitRates:    tierCostUnits(),
		},
	}

	latencies := []float64{}
	for _, record := range records {
		expected := strings.TrimSpace(record.ExpectedCategory)
		expectedTier := strings.TrimSpace(record.ExpectedTier)
		decision, sampleLatencies := decideWithLatency(router, record.promptText(), latencyIterations)
		actual := decision.RoutingDecisionMaterial.Category
		actualTier := decision.RoutingDecisionMaterial.Tier
		latencies = append(latencies, sampleLatencies...)

		stats := result.ByCategory[expected]
		stats.Total++
		if actual == expected {
			stats.Correct++
			result.CorrectSamples++
		} else {
			result.Failures = append(result.Failures, evaluationFailure{
				SampleID:         record.expectedID(),
				ExpectedCategory: expected,
				ActualCategory:   actual,
				ExpectedTier:     expectedTier,
				ActualTier:       actualTier,
			})
		}
		stats.Accuracy = ratio(stats.Correct, stats.Total)
		result.ByCategory[expected] = stats

		if expectedTier != "" {
			tierStats := result.ByTier[expectedTier]
			tierStats.Total++
			result.TierLabeledSamples++
			if actualTier == expectedTier {
				tierStats.Correct++
				result.TierCorrectSamples++
			} else if actual == expected {
				result.Failures = append(result.Failures, evaluationFailure{
					SampleID:         record.expectedID(),
					ExpectedCategory: expected,
					ActualCategory:   actual,
					ExpectedTier:     expectedTier,
					ActualTier:       actualTier,
				})
			}
			tierStats.Accuracy = ratio(tierStats.Correct, tierStats.Total)
			result.ByTier[expectedTier] = tierStats
		}

		if _, ok := result.ConfusionMatrix[expected]; !ok {
			result.ConfusionMatrix[expected] = map[string]int{}
		}
		result.ConfusionMatrix[expected][actual]++

		result.CostEstimate.BaselineCostUnits += tierCostUnit(routing.TierHighQuality)
		result.CostEstimate.ActualCostUnits += tierCostUnit(actualTier)
	}

	result.Accuracy = ratio(result.CorrectSamples, result.TotalSamples)
	result.TierAccuracy = ratio(result.TierCorrectSamples, result.TierLabeledSamples)
	result.Latency = summarizeLatency(latencies, latencyIterations)
	result.CostEstimate.BaselineCostUnits = round4(result.CostEstimate.BaselineCostUnits)
	result.CostEstimate.ActualCostUnits = round4(result.CostEstimate.ActualCostUnits)
	result.CostEstimate.SavedCostUnits = round4(result.CostEstimate.BaselineCostUnits - result.CostEstimate.ActualCostUnits)
	result.CostEstimate.SavingRate = ratioFloat(result.CostEstimate.SavedCostUnits, result.CostEstimate.BaselineCostUnits)
	sortFailures(result.Failures)
	return result
}

func decideWithLatency(router *routing.SimpleRouter, prompt string, iterations int) (routing.Decision, []float64) {
	latencies := make([]float64, 0, iterations)
	var decision routing.Decision
	for i := 0; i < iterations; i++ {
		start := time.Now()
		nextDecision, err := router.DecideRoute(context.Background(), routing.Request{
			RequestedModel: "auto",
			PromptText:     prompt,
		})
		elapsed := time.Since(start)
		latencies = append(latencies, durationMicros(elapsed))
		if err == nil {
			decision = nextDecision
		}
	}
	return decision, latencies
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
	sort.Float64s(latencies)
	return latencyStats{
		Iterations: iterations,
		Samples:    len(latencies),
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

func tierCostUnits() map[string]float64 {
	return map[string]float64{
		routing.TierLowCost:     tierCostLowCost,
		routing.TierBalanced:    tierCostBalanced,
		routing.TierHighQuality: tierCostHighQuality,
	}
}

func tierCostUnit(tier string) float64 {
	switch tier {
	case routing.TierLowCost:
		return tierCostLowCost
	case routing.TierBalanced:
		return tierCostBalanced
	case routing.TierHighQuality:
		return tierCostHighQuality
	default:
		return tierCostBalanced
	}
}

func marshalReport(report report, pretty bool) ([]byte, error) {
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

func exitWithError(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
