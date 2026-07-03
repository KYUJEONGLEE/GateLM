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
	defaultProbeDatasetPath  = "docs/v2.1.0/fixtures/routing-random-probe.fixture.jsonl"
	defaultLatencyIterations = 20

	tierCostLowCost     = 1
	tierCostBalanced    = 3
	tierCostHighQuality = 10

	modeEvaluate = "evaluate"
	modeProbe    = "probe"
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
	SummaryKo            evaluationSummaryKo       `json:"한글요약"`
	DatasetPath          string                    `json:"datasetPath"`
	ClassifierName       string                    `json:"classifierName"`
	ClassifierVersion    string                    `json:"classifierVersion"`
	TotalSamples         int                       `json:"totalSamples"`
	CorrectSamples       int                       `json:"correctSamples"`
	IncorrectSamples     int                       `json:"incorrectSamples"`
	Accuracy             float64                   `json:"accuracy"`
	ErrorRate            float64                   `json:"errorRate"`
	TierLabeledSamples   int                       `json:"tierLabeledSamples"`
	TierCorrectSamples   int                       `json:"tierCorrectSamples"`
	TierIncorrectSamples int                       `json:"tierIncorrectSamples"`
	TierAccuracy         float64                   `json:"tierAccuracy"`
	TierErrorRate        float64                   `json:"tierErrorRate"`
	ByCategory           map[string]categoryStats  `json:"byCategory"`
	ByTier               map[string]categoryStats  `json:"byTier"`
	ConfusionMatrix      map[string]map[string]int `json:"confusionMatrix"`
	Latency              latencyStats              `json:"latency"`
	CostEstimate         costEstimate              `json:"costEstimate"`
	Failures             []evaluationFailure       `json:"failures"`
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

type probeReport struct {
	SummaryKo         probeSummaryKo       `json:"한글요약"`
	Mode              string               `json:"mode"`
	DatasetPath       string               `json:"datasetPath"`
	ClassifierName    string               `json:"classifierName"`
	ClassifierVersion string               `json:"classifierVersion"`
	TotalSamples      int                  `json:"totalSamples"`
	ByCategory        map[string]probeStat `json:"byCategory"`
	ByTier            map[string]probeStat `json:"byTier"`
	RoutingReasons    map[string]int       `json:"routingReasons"`
	Latency           latencyStats         `json:"latency"`
	CostEstimate      costEstimate         `json:"costEstimate"`
	Samples           []probeSample        `json:"samples"`
}

type probeStat struct {
	LabelKo string  `json:"labelKo,omitempty"`
	Total   int     `json:"total"`
	Rate    float64 `json:"rate"`
}

type probeSample struct {
	SampleID      string `json:"sampleId"`
	Category      string `json:"category"`
	Tier          string `json:"tier"`
	RoutingReason string `json:"routingReason"`
}

type evaluationSummaryKo struct {
	Title                string              `json:"제목"`
	Purpose              string              `json:"목적"`
	DatasetPath          string              `json:"데이터셋"`
	TotalSamples         int                 `json:"전체샘플수"`
	CategoryAccuracy     float64             `json:"카테고리정확도"`
	CategoryErrorRate    float64             `json:"카테고리오답률"`
	TierAccuracy         float64             `json:"티어정확도"`
	TierErrorRate        float64             `json:"티어오답률"`
	AvgLatencyMicros     float64             `json:"평균지연시간Micros"`
	P95LatencyMicros     float64             `json:"P95지연시간Micros"`
	CostSavingRate       float64             `json:"예상비용절감률"`
	FailureCount         int                 `json:"실패수"`
	CategoryDistribution []koreanStatSummary `json:"카테고리별결과"`
	TierDistribution     []koreanStatSummary `json:"티어별결과"`
	HowToRead            string              `json:"읽는법"`
}

type probeSummaryKo struct {
	Title                string              `json:"제목"`
	Purpose              string              `json:"목적"`
	DatasetPath          string              `json:"데이터셋"`
	TotalSamples         int                 `json:"전체샘플수"`
	AvgLatencyMicros     float64             `json:"평균지연시간Micros"`
	P95LatencyMicros     float64             `json:"P95지연시간Micros"`
	CostSavingRate       float64             `json:"예상비용절감률"`
	CategoryDistribution []koreanStatSummary `json:"카테고리분포"`
	TierDistribution     []koreanStatSummary `json:"티어분포"`
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
	mode := flag.String("mode", modeEvaluate, "routing report mode: evaluate or probe")
	outputPath := flag.String("output", "", "optional report output path")
	classifierVersion := flag.String("classifier-version", defaultClassifierVersion, "classifier version label for the report")
	minAccuracy := flag.Float64("min-accuracy", 0, "optional minimum exact-match accuracy, from 0 to 1")
	minTierAccuracy := flag.Float64("min-tier-accuracy", 0, "optional minimum tier exact-match accuracy, from 0 to 1")
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

	requireExpectedLabels := reportMode != modeProbe
	records, err := loadDataset(*datasetPath, requireExpectedLabels)
	if err != nil {
		exitWithError(err)
	}

	var payload []byte
	switch reportMode {
	case modeEvaluate:
		evalReport := evaluate(*datasetPath, *classifierVersion, records, *latencyIterations)
		payload, err = marshalReport(evalReport, *pretty)
		if err != nil {
			exitWithError(err)
		}
		if *minAccuracy > 0 && evalReport.Accuracy < *minAccuracy {
			exitWithError(fmt.Errorf("accuracy %.4f is below minimum %.4f", evalReport.Accuracy, *minAccuracy))
		}
		if *minTierAccuracy > 0 && evalReport.TierLabeledSamples > 0 && evalReport.TierAccuracy < *minTierAccuracy {
			exitWithError(fmt.Errorf("tier accuracy %.4f is below minimum %.4f", evalReport.TierAccuracy, *minTierAccuracy))
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
		if strings.TrimSpace(record.expectedID()) == "" {
			return nil, fmt.Errorf("record %d: sampleId or id is required", index+1)
		}
		if requireExpectedLabels && strings.TrimSpace(record.ExpectedCategory) == "" {
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
		stats.LabelKo = categoryLabelKo(expected)
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
		stats.Incorrect = stats.Total - stats.Correct
		stats.Accuracy = ratio(stats.Correct, stats.Total)
		stats.IncorrectRate = ratio(stats.Incorrect, stats.Total)
		result.ByCategory[expected] = stats

		if expectedTier != "" {
			tierStats := result.ByTier[expectedTier]
			tierStats.LabelKo = tierLabelKo(expectedTier)
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
			tierStats.Incorrect = tierStats.Total - tierStats.Correct
			tierStats.Accuracy = ratio(tierStats.Correct, tierStats.Total)
			tierStats.IncorrectRate = ratio(tierStats.Incorrect, tierStats.Total)
			result.ByTier[expectedTier] = tierStats
		}

		if _, ok := result.ConfusionMatrix[expected]; !ok {
			result.ConfusionMatrix[expected] = map[string]int{}
		}
		result.ConfusionMatrix[expected][actual]++

		result.CostEstimate.BaselineCostUnits += tierCostUnit(routing.TierHighQuality)
		result.CostEstimate.ActualCostUnits += tierCostUnit(actualTier)
	}

	result.IncorrectSamples = result.TotalSamples - result.CorrectSamples
	result.Accuracy = ratio(result.CorrectSamples, result.TotalSamples)
	result.ErrorRate = ratio(result.IncorrectSamples, result.TotalSamples)
	result.TierIncorrectSamples = result.TierLabeledSamples - result.TierCorrectSamples
	result.TierAccuracy = ratio(result.TierCorrectSamples, result.TierLabeledSamples)
	result.TierErrorRate = ratio(result.TierIncorrectSamples, result.TierLabeledSamples)
	result.Latency = summarizeLatency(latencies, latencyIterations)
	result.CostEstimate.BaselineCostUnits = round4(result.CostEstimate.BaselineCostUnits)
	result.CostEstimate.ActualCostUnits = round4(result.CostEstimate.ActualCostUnits)
	result.CostEstimate.SavedCostUnits = round4(result.CostEstimate.BaselineCostUnits - result.CostEstimate.ActualCostUnits)
	result.CostEstimate.SavingRate = ratioFloat(result.CostEstimate.SavedCostUnits, result.CostEstimate.BaselineCostUnits)
	sortFailures(result.Failures)
	result.SummaryKo = buildEvaluationSummaryKo(result)
	return result
}

func probe(datasetPath string, classifierVersion string, records []datasetRecord, latencyIterations int) probeReport {
	if latencyIterations <= 0 {
		latencyIterations = 1
	}
	router := routing.NewSimpleRouter(routing.SimpleRouterConfig{})
	result := probeReport{
		Mode:              modeProbe,
		DatasetPath:       datasetPath,
		ClassifierName:    defaultClassifierName,
		ClassifierVersion: classifierVersion,
		TotalSamples:      len(records),
		ByCategory:        map[string]probeStat{},
		ByTier:            map[string]probeStat{},
		RoutingReasons:    map[string]int{},
		Samples:           []probeSample{},
		CostEstimate: costEstimate{
			BaselineTier: routing.TierHighQuality,
			UnitRates:    tierCostUnits(),
		},
	}

	latencies := []float64{}
	for _, record := range records {
		decision, sampleLatencies := decideWithLatency(router, record.promptText(), latencyIterations)
		category := decision.RoutingDecisionMaterial.Category
		tier := decision.RoutingDecisionMaterial.Tier
		latencies = append(latencies, sampleLatencies...)

		categoryStat := result.ByCategory[category]
		categoryStat.LabelKo = categoryLabelKo(category)
		categoryStat.Total++
		result.ByCategory[category] = categoryStat

		tierStat := result.ByTier[tier]
		tierStat.LabelKo = tierLabelKo(tier)
		tierStat.Total++
		result.ByTier[tier] = tierStat

		result.RoutingReasons[decision.RoutingReason]++
		result.CostEstimate.BaselineCostUnits += tierCostUnit(routing.TierHighQuality)
		result.CostEstimate.ActualCostUnits += tierCostUnit(tier)
		result.Samples = append(result.Samples, probeSample{
			SampleID:      record.expectedID(),
			Category:      category,
			Tier:          tier,
			RoutingReason: decision.RoutingReason,
		})
	}

	result.ByCategory = finalizeProbeStats(result.ByCategory, result.TotalSamples)
	result.ByTier = finalizeProbeStats(result.ByTier, result.TotalSamples)
	result.Latency = summarizeLatency(latencies, latencyIterations)
	result.CostEstimate.BaselineCostUnits = round4(result.CostEstimate.BaselineCostUnits)
	result.CostEstimate.ActualCostUnits = round4(result.CostEstimate.ActualCostUnits)
	result.CostEstimate.SavedCostUnits = round4(result.CostEstimate.BaselineCostUnits - result.CostEstimate.ActualCostUnits)
	result.CostEstimate.SavingRate = ratioFloat(result.CostEstimate.SavedCostUnits, result.CostEstimate.BaselineCostUnits)
	sortProbeSamples(result.Samples)
	result.SummaryKo = buildProbeSummaryKo(result)
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

func buildEvaluationSummaryKo(result report) evaluationSummaryKo {
	return evaluationSummaryKo{
		Title:                "라우팅 정답 평가 리포트",
		Purpose:              "정답이 있는 한국어 평가셋으로 category와 tier가 기대대로 맞는지 확인한다.",
		DatasetPath:          result.DatasetPath,
		TotalSamples:         result.TotalSamples,
		CategoryAccuracy:     result.Accuracy,
		CategoryErrorRate:    result.ErrorRate,
		TierAccuracy:         result.TierAccuracy,
		TierErrorRate:        result.TierErrorRate,
		AvgLatencyMicros:     result.Latency.AvgMicros,
		P95LatencyMicros:     result.Latency.P95Micros,
		CostSavingRate:       result.CostEstimate.SavingRate,
		FailureCount:         len(result.Failures),
		CategoryDistribution: summarizeCategoryStatsKo(result.ByCategory),
		TierDistribution:     summarizeCategoryStatsKo(result.ByTier),
		HowToRead:            "정확도는 정답 라벨과 라우팅 결과가 일치한 비율이고, 실패수는 사람이 룰 또는 평가셋을 보정해야 할 후보 수다.",
	}
}

func buildProbeSummaryKo(result probeReport) probeSummaryKo {
	return probeSummaryKo{
		Title:                "라우팅 분포 관찰 리포트",
		Purpose:              "정답이 없는 한국어 샘플이 현재 룰에서 어떤 category와 tier로 분산되는지 확인한다.",
		DatasetPath:          result.DatasetPath,
		TotalSamples:         result.TotalSamples,
		AvgLatencyMicros:     result.Latency.AvgMicros,
		P95LatencyMicros:     result.Latency.P95Micros,
		CostSavingRate:       result.CostEstimate.SavingRate,
		CategoryDistribution: summarizeProbeStatsKo(result.ByCategory),
		TierDistribution:     summarizeProbeStatsKo(result.ByTier),
		HowToRead:            "정답률을 보는 리포트가 아니라 general 쏠림, high_quality 과다 사용, 비용 절감 방향을 관찰하는 리포트다.",
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
			label = labelKoForRoutingValue(key)
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
			label = labelKoForRoutingValue(key)
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

func labelKoForRoutingValue(value string) string {
	if label := categoryLabelKo(value); label != value {
		return label
	}
	return tierLabelKo(value)
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
	case routing.CategoryExtractionJSON:
		return "정보 추출/JSON"
	case routing.CategorySupportRefund:
		return "환불/결제/고객지원"
	case routing.CategoryReasoning:
		return "비교/판단/추론"
	case routing.CategoryUnknown:
		return "분류 불가"
	default:
		return category
	}
}

func tierLabelKo(tier string) string {
	switch tier {
	case routing.TierLowCost:
		return "저비용"
	case routing.TierBalanced:
		return "균형"
	case routing.TierHighQuality:
		return "고품질"
	default:
		return tier
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
