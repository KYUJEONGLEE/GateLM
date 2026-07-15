package e5onnx

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"reflect"
	"runtime"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/tools/difficultymodel"
)

const (
	holdoutReferenceSchema = "gatelm.difficulty-gateway-holdout-reference.v2"
	holdoutRunSchema       = "gatelm.difficulty-gateway-holdout-replay-run.v2"
	holdoutDatasetVersion  = "difficulty_training_2026_07_15_owner_approved_500_v2"
	holdoutDatasetSHA256   = "4f4b00a783ef6372a2d23baf77b0c793670a72f03f4636c6674c8e911662189f"
	holdoutSplitPolicy     = "difficulty-family-constrained-split.2026-07-15.v1"
	holdoutSplitSeed       = 20260715
	holdoutExecutionShape  = "difficulty-e5-single-request-execution.2026-07-15.v1"
	holdoutRecordCount     = 100
	holdoutFamilyCount     = 18
	holdoutModelPathCount  = 64
	holdoutScoreTolerance  = 1e-5
	holdoutWarmupCycles    = 1
	holdoutMeasureCycles   = 5
	requestShadowTimeout   = 100 * time.Millisecond
)

type gatewayHoldoutReference struct {
	SchemaVersion               string                          `json:"schemaVersion"`
	DatasetVersion              string                          `json:"datasetVersion"`
	DatasetSHA256               string                          `json:"datasetSha256"`
	SplitPolicyVersion          string                          `json:"splitPolicyVersion"`
	SplitSeed                   int                             `json:"splitSeed"`
	HoldoutRecords              int                             `json:"holdoutRecords"`
	HoldoutFamilies             int                             `json:"holdoutFamilies"`
	ModelPathRecords            int                             `json:"modelPathRecords"`
	ArtifactVersion             string                          `json:"artifactVersion"`
	BundleHash                  string                          `json:"bundleHash"`
	ContentHash                 string                          `json:"contentHash"`
	ThresholdPolicyVersion      string                          `json:"thresholdPolicyVersion"`
	Threshold                   float64                         `json:"threshold"`
	ExecutionShapePolicyVersion string                          `json:"executionShapePolicyVersion"`
	OfflineSingleClassification holdoutClassificationSummary    `json:"offlineSingleRequestClassification"`
	GatewaySingleClassification holdoutClassificationSummary    `json:"gatewaySingleClassification"`
	RuleBaselineClassification  holdoutClassificationSummary    `json:"ruleBaselineClassification"`
	Samples                     []gatewayHoldoutReferenceSample `json:"samples"`
}

type gatewayHoldoutReferenceSample struct {
	SampleID                     string  `json:"sampleId"`
	ExpectedCategory             string  `json:"expectedCategory"`
	ActualCategory               string  `json:"actualCategory"`
	ExpectedDifficulty           string  `json:"expectedDifficulty"`
	RuleDifficulty               string  `json:"ruleDifficulty"`
	ModelPath                    bool    `json:"modelPath"`
	PythonOfflineComplexityScore float64 `json:"pythonOfflineComplexityScore"`
	PythonOfflineDifficulty      string  `json:"pythonOfflineDifficulty"`
	PythonGatewayComplexityScore float64 `json:"pythonGatewayComplexityScore"`
	PythonGatewayDifficulty      string  `json:"pythonGatewayDifficulty"`
}

type gatewayHoldoutManifest struct {
	DatasetVersion     string                              `json:"datasetVersion"`
	DatasetSHA256      string                              `json:"datasetSha256"`
	SplitPolicyVersion string                              `json:"splitPolicyVersion"`
	SplitSeed          int                                 `json:"splitSeed"`
	SplitCounts        map[string]gatewayHoldoutSplitCount `json:"splitCounts"`
	Families           []gatewayHoldoutManifestFamily      `json:"families"`
}

type gatewayHoldoutSplitCount struct {
	Records  int `json:"records"`
	Families int `json:"families"`
}

type gatewayHoldoutManifestFamily struct {
	PromptFamily string `json:"promptFamily"`
	Partition    string `json:"partition"`
	Records      int    `json:"records"`
}

type gatewayHoldoutDatasetRecord struct {
	SchemaVersion      string `json:"schemaVersion"`
	DatasetVersion     string `json:"datasetVersion"`
	SampleID           string `json:"sampleId"`
	RedactedPrompt     string `json:"redactedPrompt"`
	ExpectedCategory   string `json:"expectedCategory"`
	ExpectedDifficulty string `json:"expectedDifficulty"`
	PromptFamily       string `json:"promptFamily"`
}

type gatewayHoldoutObservedSample struct {
	ExpectedDifficulty string
	RuleDifficulty     string
	GoDifficulty       string
}

type holdoutClassificationSummary struct {
	Samples         int     `json:"samples"`
	Correct         int     `json:"correct"`
	Accuracy        float64 `json:"accuracy"`
	SimpleExpected  int     `json:"simpleExpectedSamples"`
	SimpleToComplex int     `json:"simpleToComplexCount"`
	ComplexExpected int     `json:"complexExpectedSamples"`
	ComplexToSimple int     `json:"complexToSimpleCount"`
}

type holdoutLatencySummary struct {
	Samples int     `json:"samples"`
	P50     float64 `json:"p50"`
	P95     float64 `json:"p95"`
	P99     float64 `json:"p99"`
	Max     float64 `json:"max"`
}

type holdoutMemorySnapshot struct {
	RSS           int64  `json:"rss"`
	HWM           int64  `json:"hwm"`
	CgroupCurrent int64  `json:"cgroupCurrent"`
	CgroupPeak    int64  `json:"cgroupPeak"`
	GoHeapAlloc   uint64 `json:"goHeapAlloc"`
	GoHeapSys     uint64 `json:"goHeapSys"`
	GoSys         uint64 `json:"goSys"`
	GoNumGC       uint32 `json:"goNumGC"`
	Threads       int64  `json:"threads"`
}

type gatewayHoldoutReplayRun struct {
	SchemaVersion               string                              `json:"schemaVersion"`
	Status                      string                              `json:"status"`
	MeasuredAt                  string                              `json:"measuredAt"`
	Environment                 map[string]string                   `json:"environment"`
	DatasetVersion              string                              `json:"datasetVersion"`
	DatasetSHA256               string                              `json:"datasetSha256"`
	HoldoutRecords              int                                 `json:"holdoutRecords"`
	HoldoutFamilies             int                                 `json:"holdoutFamilies"`
	ArtifactVersion             string                              `json:"artifactVersion"`
	BundleHash                  string                              `json:"bundleHash"`
	ContentHash                 string                              `json:"contentHash"`
	ThresholdPolicyVersion      string                              `json:"thresholdPolicyVersion"`
	Threshold                   float64                             `json:"threshold"`
	ExecutionShapePolicyVersion string                              `json:"executionShapePolicyVersion"`
	Parity                      gatewayHoldoutParity                `json:"parity"`
	RoutingInvariance           gatewayHoldoutRoutingInvariance     `json:"routingInvariance"`
	SelectedClassification      holdoutClassificationSummary        `json:"selectedClassification"`
	OfflineSingleClassification holdoutClassificationSummary        `json:"offlineSingleRequestClassification"`
	OfflineAggregateReproduced  bool                                `json:"offlineAggregateReproduced"`
	RuleBaselineClassification  holdoutClassificationSummary        `json:"ruleBaselineClassification"`
	LatencyMicros               map[string]holdoutLatencySummary    `json:"latencyMicros"`
	MemoryBytes                 map[string]holdoutMemorySnapshot    `json:"memoryBytes"`
	ShadowStatuses              map[string]int                      `json:"shadowStatuses"`
	BusySaturation              gatewayHoldoutBusySaturation        `json:"busySaturation"`
	NativeTimeoutRecovery       gatewayHoldoutNativeTimeoutRecovery `json:"nativeTimeoutRecovery"`
}

type gatewayHoldoutParity struct {
	LabelMatches               int      `json:"labelMatches"`
	LabelMismatches            int      `json:"labelMismatches"`
	MismatchSampleIDs          []string `json:"mismatchSampleIds,omitempty"`
	OfflineLabelMatches        int      `json:"offlineLabelMatches"`
	OfflineLabelMismatches     int      `json:"offlineLabelMismatches"`
	OfflineMismatchSampleIDs   []string `json:"offlineMismatchSampleIds,omitempty"`
	MaxAbsoluteScoreDelta      float64  `json:"maxAbsoluteScoreDelta"`
	P50AbsoluteScoreDelta      float64  `json:"p50AbsoluteScoreDelta"`
	P95AbsoluteScoreDelta      float64  `json:"p95AbsoluteScoreDelta"`
	MaxOfflineSingleScoreDelta float64  `json:"maxOfflineSingleRequestScoreDelta"`
	AbsoluteTolerance          float64  `json:"absoluteTolerance"`
	RelativeTolerance          float64  `json:"relativeTolerance"`
}

type gatewayHoldoutRoutingInvariance struct {
	Matched           int      `json:"matched"`
	Mismatched        int      `json:"mismatched"`
	MismatchSampleIDs []string `json:"mismatchSampleIds,omitempty"`
}

type gatewayHoldoutBusySaturation struct {
	Attempts        int                   `json:"attempts"`
	Accepted        int                   `json:"accepted"`
	RejectedBusy    int                   `json:"rejectedBusy"`
	RejectedLatency holdoutLatencySummary `json:"rejectedLatencyMicros"`
}

type gatewayHoldoutNativeTimeoutRecovery struct {
	Status                       string  `json:"status"`
	DeadlineObserved             bool    `json:"deadlineObserved"`
	ElapsedMicros                float64 `json:"elapsedMicros"`
	SubsequentInferenceSucceeded bool    `json:"subsequentInferenceSucceeded"`
	InterruptsInFlightONNXRun    string  `json:"interruptsInFlightONNXRun"`
}

func TestNativeGatewayHoldoutReplay(t *testing.T) {
	bundleRoot := requiredHoldoutEnv(t, "GATELM_E5_INTEGRATION_BUNDLE_ROOT")
	referencePath := requiredHoldoutEnv(t, "GATELM_E5_HOLDOUT_REFERENCE")
	datasetPath := requiredHoldoutEnv(t, "GATELM_E5_HOLDOUT_DATASET")
	manifestPath := requiredHoldoutEnv(t, "GATELM_E5_HOLDOUT_MANIFEST")
	reportPath := requiredHoldoutEnv(t, "GATELM_E5_HOLDOUT_REPORT")

	reference := loadGatewayHoldoutReference(t, referencePath)
	records := loadGatewayHoldoutRecords(t, datasetPath, manifestPath, reference)
	memory := map[string]holdoutMemorySnapshot{"beforeInit": readHoldoutMemorySnapshot()}

	encoder, err := NewEncoder(BundleConfig{
		ArtifactRoot:        bundleRoot,
		EncoderManifestPath: bundleRoot + "/difficulty-e5-encoder-manifest.v2.json",
		RuntimeLockPath:     bundleRoot + "/difficulty-e5-gateway-runtime-lock.linux-amd64.v2.json",
	})
	if err != nil {
		t.Fatal("initialize native holdout encoder")
	}
	evaluator := routing.NewDifficultySemanticShadowEvaluator(encoder)
	memory["afterInit"] = readHoldoutMemorySnapshot()

	observations := make(chan routing.DifficultySemanticShadowObservation, 4096)
	runner := routing.NewDifficultySemanticShadowRunner(
		evaluator,
		requestShadowTimeout,
		routing.DifficultySemanticShadowObserverFunc(func(observation routing.DifficultySemanticShadowObservation) {
			observations <- observation
		}),
	)
	if runner == nil {
		t.Fatal("construct native holdout shadow runner")
	}
	disabledRouter := routing.NewSimpleRouter(gatewayHoldoutRoutingConfig())
	enabledRouter := routing.NewSimpleRouter(
		gatewayHoldoutRoutingConfig(),
		routing.WithDifficultySemanticShadow(runner),
	)

	categoryClassifier := routing.NewRuleBasedCategoryClassifier()
	difficultyClassifier := routing.NewRuleBasedDifficultyClassifier()
	observed := make([]gatewayHoldoutObservedSample, 0, len(records))
	scoreDeltas := make([]float64, 0, len(records))
	offlineScoreDeltas := make([]float64, 0, len(records))
	labelMatches := 0
	offlineLabelMatches := 0
	labelMismatchIDs := []string{}
	offlineMismatchIDs := []string{}
	routeMatches := 0
	routeMismatchIDs := []string{}
	shadowStatuses := map[string]int{}

	for index, record := range records {
		referenceSample := reference.Samples[index]
		features := routing.ExtractPromptFeatures(record.RedactedPrompt)
		category := categoryClassifier.ClassifyFeatures(features).Category
		difficultyFeatures := routing.ExtractDifficultyFeatures(features, category)
		ruleDifficulty := difficultyClassifier.ClassifyFeatures(difficultyFeatures).Difficulty
		modelPath := routing.UsesDifficultyModelPath(difficultyFeatures)
		if category != referenceSample.ActualCategory || ruleDifficulty != referenceSample.RuleDifficulty || modelPath != referenceSample.ModelPath {
			t.Fatalf("Gateway feature-path identity drifted for sampleId=%s", record.SampleID)
		}

		goScore, goDifficulty := evaluateGatewayHoldoutSample(t, evaluator, features, category, ruleDifficulty, modelPath)
		delta := math.Abs(goScore - referenceSample.PythonGatewayComplexityScore)
		offlineDelta := math.Abs(goScore - referenceSample.PythonOfflineComplexityScore)
		scoreDeltas = append(scoreDeltas, delta)
		offlineScoreDeltas = append(offlineScoreDeltas, offlineDelta)
		if goDifficulty == referenceSample.PythonGatewayDifficulty {
			labelMatches++
		} else {
			labelMismatchIDs = append(labelMismatchIDs, record.SampleID)
		}
		if goDifficulty == referenceSample.PythonOfflineDifficulty {
			offlineLabelMatches++
		} else {
			offlineMismatchIDs = append(offlineMismatchIDs, record.SampleID)
		}
		observed = append(observed, gatewayHoldoutObservedSample{
			ExpectedDifficulty: record.ExpectedDifficulty,
			RuleDifficulty:     ruleDifficulty,
			GoDifficulty:       goDifficulty,
		})

		disabled, err := disabledRouter.DecideRoute(context.Background(), routing.Request{
			RequestedModel: "auto",
			PromptText:     record.RedactedPrompt,
		})
		if err != nil {
			t.Fatalf("shadow-disabled route failed for sampleId=%s", record.SampleID)
		}
		enabled, err := enabledRouter.DecideRoute(context.Background(), routing.Request{
			RequestedModel:           "auto",
			PromptText:               record.RedactedPrompt,
			DifficultyShadowEligible: true,
		})
		if err != nil {
			t.Fatalf("shadow-enabled route failed for sampleId=%s", record.SampleID)
		}
		if sameGatewayHoldoutDecision(disabled, enabled) {
			routeMatches++
		} else {
			routeMismatchIDs = append(routeMismatchIDs, record.SampleID)
		}
		observation := waitForGatewayHoldoutObservation(t, observations)
		shadowStatuses[observation.Status]++
	}

	for cycle := 0; cycle < holdoutWarmupCycles; cycle++ {
		warmGatewayHoldout(t, evaluator, records, reference.Samples)
	}
	memory["afterWarmup"] = readHoldoutMemorySnapshot()

	disabledRouteLatencies := []float64{}
	enabledRouteLatencies := []float64{}
	shadowCompletionLatencies := []float64{}
	directInferenceLatencies := []float64{}
	peak := readHoldoutMemorySnapshot()
	for cycle := 0; cycle < holdoutMeasureCycles; cycle++ {
		for index, record := range records {
			referenceSample := reference.Samples[index]
			features := routing.ExtractPromptFeatures(record.RedactedPrompt)
			category := categoryClassifier.ClassifyFeatures(features).Category
			if referenceSample.ModelPath {
				started := time.Now()
				result := evaluator.Evaluate(context.Background(), features, category)
				directInferenceLatencies = append(directInferenceLatencies, microsSince(started))
				if result.Status != routing.DifficultySemanticShadowReady {
					t.Fatalf("native measured inference failed for sampleId=%s", record.SampleID)
				}
			}
			started := time.Now()
			if _, err := disabledRouter.DecideRoute(context.Background(), routing.Request{RequestedModel: "auto", PromptText: record.RedactedPrompt}); err != nil {
				t.Fatalf("measured shadow-disabled route failed for sampleId=%s", record.SampleID)
			}
			disabledRouteLatencies = append(disabledRouteLatencies, microsSince(started))

			started = time.Now()
			if _, err := enabledRouter.DecideRoute(context.Background(), routing.Request{
				RequestedModel:           "auto",
				PromptText:               record.RedactedPrompt,
				DifficultyShadowEligible: true,
			}); err != nil {
				t.Fatalf("measured shadow-enabled route failed for sampleId=%s", record.SampleID)
			}
			enabledRouteLatencies = append(enabledRouteLatencies, microsSince(started))
			observation := waitForGatewayHoldoutObservation(t, observations)
			shadowCompletionLatencies = append(shadowCompletionLatencies, float64(observation.Duration.Nanoseconds())/1000.0)
			shadowStatuses[observation.Status]++
			if index%10 == 0 {
				peak = maxHoldoutMemorySnapshot(peak, readHoldoutMemorySnapshot())
			}
		}
	}
	memory["peakDuringReplay"] = maxHoldoutMemorySnapshot(peak, readHoldoutMemorySnapshot())
	memory["afterReplay"] = readHoldoutMemorySnapshot()

	modelPathRecord := records[0]
	for index, sample := range reference.Samples {
		if sample.ModelPath {
			modelPathRecord = records[index]
			break
		}
	}
	busy := measureGatewayHoldoutBusySaturation(t, runner, modelPathRecord, observations)
	timeoutRecovery := measureNativeTimeoutRecovery(modelPathRecord, encoder)

	closeCtx, closeCancel := context.WithTimeout(context.Background(), 30*time.Second)
	if err := runner.Close(closeCtx); err != nil {
		closeCancel()
		t.Fatal("close native holdout shadow runner")
	}
	closeCancel()
	runtime.GC()
	debug.FreeOSMemory()
	time.Sleep(100 * time.Millisecond)
	memory["afterClose"] = readHoldoutMemorySnapshot()

	selectedSummary := summarizeGatewayHoldoutObserved(observed, "go")
	baselineSummary := summarizeGatewayHoldoutObserved(observed, "rule")
	parity := gatewayHoldoutParity{
		LabelMatches:               labelMatches,
		LabelMismatches:            len(records) - labelMatches,
		MismatchSampleIDs:          labelMismatchIDs,
		OfflineLabelMatches:        offlineLabelMatches,
		OfflineLabelMismatches:     len(records) - offlineLabelMatches,
		OfflineMismatchSampleIDs:   offlineMismatchIDs,
		MaxAbsoluteScoreDelta:      maximumFloat(scoreDeltas),
		P50AbsoluteScoreDelta:      percentileFloat(scoreDeltas, 0.50),
		P95AbsoluteScoreDelta:      percentileFloat(scoreDeltas, 0.95),
		MaxOfflineSingleScoreDelta: maximumFloat(offlineScoreDeltas),
		AbsoluteTolerance:          holdoutScoreTolerance,
		RelativeTolerance:          0,
	}
	if parity.LabelMatches != holdoutRecordCount || parity.MaxAbsoluteScoreDelta > holdoutScoreTolerance {
		t.Fatalf("same-shape Python/Go holdout parity failed: labels=%d maxDelta=%g", parity.LabelMatches, parity.MaxAbsoluteScoreDelta)
	}
	if routeMatches != holdoutRecordCount {
		t.Fatalf("shadow changed %d authoritative routing decisions", holdoutRecordCount-routeMatches)
	}
	if selectedSummary != reference.GatewaySingleClassification {
		t.Fatalf("Go Gateway classification differs from same-shape Python reference: got=%+v want=%+v", selectedSummary, reference.GatewaySingleClassification)
	}
	if baselineSummary != reference.RuleBaselineClassification {
		t.Fatalf("Go rule baseline differs from canonical reference: got=%+v want=%+v", baselineSummary, reference.RuleBaselineClassification)
	}

	report := gatewayHoldoutReplayRun{
		SchemaVersion: holdoutRunSchema,
		Status:        "gateway_implementation_parity_and_runtime_measurement_not_promotion_evidence",
		MeasuredAt:    time.Now().UTC().Format(time.RFC3339),
		Environment: map[string]string{
			"goVersion": runtime.Version(),
			"goos":      runtime.GOOS,
			"goarch":    runtime.GOARCH,
			"commit":    os.Getenv("GATELM_EVIDENCE_COMMIT"),
			"run":       os.Getenv("GATELM_EVIDENCE_RUN"),
		},
		DatasetVersion:              holdoutDatasetVersion,
		DatasetSHA256:               holdoutDatasetSHA256,
		HoldoutRecords:              holdoutRecordCount,
		HoldoutFamilies:             holdoutFamilyCount,
		ArtifactVersion:             difficultymodel.GatewayShadow118DArtifactVersion,
		BundleHash:                  difficultymodel.GatewayShadow118DBundleHash,
		ContentHash:                 difficultymodel.GatewayShadow118DContentHash,
		ThresholdPolicyVersion:      reference.ThresholdPolicyVersion,
		Threshold:                   reference.Threshold,
		ExecutionShapePolicyVersion: holdoutExecutionShape,
		Parity:                      parity,
		RoutingInvariance:           gatewayHoldoutRoutingInvariance{Matched: routeMatches, Mismatched: len(routeMismatchIDs), MismatchSampleIDs: routeMismatchIDs},
		SelectedClassification:      selectedSummary,
		OfflineSingleClassification: reference.OfflineSingleClassification,
		OfflineAggregateReproduced:  selectedSummary == reference.OfflineSingleClassification,
		RuleBaselineClassification:  baselineSummary,
		LatencyMicros: map[string]holdoutLatencySummary{
			"routeShadowDisabled": summarizeHoldoutLatency(disabledRouteLatencies),
			"routeShadowEnabled":  summarizeHoldoutLatency(enabledRouteLatencies),
			"shadowCompletion":    summarizeHoldoutLatency(shadowCompletionLatencies),
			"fullModelInference":  summarizeHoldoutLatency(directInferenceLatencies),
		},
		MemoryBytes:           memory,
		ShadowStatuses:        shadowStatuses,
		BusySaturation:        busy,
		NativeTimeoutRecovery: timeoutRecovery,
	}
	writeGatewayHoldoutReport(t, reportPath, report)
}

func requiredHoldoutEnv(t *testing.T, name string) string {
	t.Helper()
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		t.Skipf("%s is not configured", name)
	}
	return value
}

func loadGatewayHoldoutReference(t *testing.T, path string) gatewayHoldoutReference {
	t.Helper()
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("read ephemeral Gateway holdout reference")
	}
	var reference gatewayHoldoutReference
	if err := json.Unmarshal(payload, &reference); err != nil {
		t.Fatal("decode ephemeral Gateway holdout reference")
	}
	if reference.SchemaVersion != holdoutReferenceSchema ||
		reference.DatasetVersion != holdoutDatasetVersion ||
		reference.DatasetSHA256 != holdoutDatasetSHA256 ||
		reference.SplitPolicyVersion != holdoutSplitPolicy ||
		reference.SplitSeed != holdoutSplitSeed ||
		reference.HoldoutRecords != holdoutRecordCount ||
		reference.HoldoutFamilies != holdoutFamilyCount ||
		reference.ModelPathRecords != holdoutModelPathCount ||
		reference.ArtifactVersion != difficultymodel.GatewayShadow118DArtifactVersion ||
		reference.BundleHash != difficultymodel.GatewayShadow118DBundleHash ||
		reference.ContentHash != difficultymodel.GatewayShadow118DContentHash ||
		reference.ExecutionShapePolicyVersion != holdoutExecutionShape ||
		reference.ThresholdPolicyVersion != "difficulty-threshold-v1" ||
		reference.Threshold != 0.45 || len(reference.Samples) != holdoutRecordCount {
		t.Fatal("ephemeral Gateway holdout reference identity mismatch")
	}
	return reference
}

func loadGatewayHoldoutRecords(t *testing.T, datasetPath string, manifestPath string, reference gatewayHoldoutReference) []gatewayHoldoutDatasetRecord {
	t.Helper()
	manifestPayload, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal("read canonical Gateway holdout manifest")
	}
	var manifest gatewayHoldoutManifest
	if err := json.Unmarshal(manifestPayload, &manifest); err != nil {
		t.Fatal("decode canonical Gateway holdout manifest")
	}
	holdoutCount := manifest.SplitCounts["holdout"]
	if manifest.DatasetVersion != holdoutDatasetVersion || manifest.DatasetSHA256 != holdoutDatasetSHA256 ||
		manifest.SplitPolicyVersion != holdoutSplitPolicy || manifest.SplitSeed != holdoutSplitSeed ||
		holdoutCount.Records != holdoutRecordCount || holdoutCount.Families != holdoutFamilyCount {
		t.Fatal("canonical Gateway holdout manifest identity mismatch")
	}
	holdoutFamilies := map[string]int{}
	for _, family := range manifest.Families {
		if family.Partition == "holdout" {
			holdoutFamilies[family.PromptFamily] = family.Records
		}
	}
	if len(holdoutFamilies) != holdoutFamilyCount {
		t.Fatal("canonical Gateway holdout manifest family count mismatch")
	}

	datasetPayload, err := os.ReadFile(datasetPath)
	if err != nil {
		t.Fatal("read canonical Gateway holdout dataset")
	}
	digest := sha256.Sum256(datasetPayload)
	if hex.EncodeToString(digest[:]) != holdoutDatasetSHA256 {
		t.Fatal("canonical Gateway holdout dataset hash mismatch")
	}
	records := make([]gatewayHoldoutDatasetRecord, 0, holdoutRecordCount)
	actualFamilyRecords := map[string]int{}
	scanner := bufio.NewScanner(bytes.NewReader(datasetPayload))
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		if strings.TrimSpace(scanner.Text()) == "" {
			continue
		}
		var record gatewayHoldoutDatasetRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			t.Fatal("decode canonical Gateway holdout dataset record")
		}
		if record.SchemaVersion != "gatelm.difficulty-label-record.v2" || record.DatasetVersion != holdoutDatasetVersion {
			t.Fatal("canonical Gateway holdout dataset record identity mismatch")
		}
		if _, ok := holdoutFamilies[record.PromptFamily]; ok {
			records = append(records, record)
			actualFamilyRecords[record.PromptFamily]++
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal("scan canonical Gateway holdout dataset")
	}
	if len(records) != holdoutRecordCount {
		t.Fatal("canonical Gateway holdout record count mismatch")
	}
	for family, expected := range holdoutFamilies {
		if actualFamilyRecords[family] != expected {
			t.Fatal("canonical Gateway holdout family membership mismatch")
		}
	}
	for index, record := range records {
		if reference.Samples[index].SampleID != record.SampleID || reference.Samples[index].ExpectedCategory != record.ExpectedCategory || reference.Samples[index].ExpectedDifficulty != record.ExpectedDifficulty {
			t.Fatal("canonical Gateway holdout order or label mismatch")
		}
	}
	return records
}

func evaluateGatewayHoldoutSample(t *testing.T, evaluator *routing.DifficultySemanticShadowEvaluator, features routing.PromptFeatures, category string, ruleDifficulty string, modelPath bool) (float64, string) {
	t.Helper()
	if !modelPath {
		if ruleDifficulty == routing.DifficultyComplex {
			return 1, routing.DifficultyComplex
		}
		return 0, routing.DifficultySimple
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	result := evaluator.Evaluate(ctx, features, category)
	if result.Status != routing.DifficultySemanticShadowReady {
		t.Fatalf("native Gateway holdout evaluation returned status=%s", result.Status)
	}
	if math.IsNaN(result.Difficulty.ComplexityScore) || math.IsInf(result.Difficulty.ComplexityScore, 0) || result.Difficulty.ComplexityScore < 0 || result.Difficulty.ComplexityScore > 1 {
		t.Fatal("native Gateway holdout evaluation returned an invalid score")
	}
	return result.Difficulty.ComplexityScore, result.Difficulty.Difficulty
}

func gatewayHoldoutRoutingConfig() routing.SimpleRouterConfig {
	simple := routing.RouteCell{ModelRefs: []string{"replay-simple-primary", "replay-fallback"}}
	complex := routing.RouteCell{ModelRefs: []string{"replay-complex-primary", "replay-fallback"}}
	routes := routing.DifficultyRoutes{Simple: simple, Complex: complex}
	return routing.SimpleRouterConfig{
		Mode:           routing.RoutingPolicyModeAuto,
		BootstrapState: routing.BootstrapStateConfigured,
		Routes: routing.RoutingMatrix{
			General: routes, Code: routes, Translation: routes, Summarization: routes, Reasoning: routes,
		},
		PolicyHash: routing.DefaultPolicyHash,
	}
}

func sameGatewayHoldoutDecision(left routing.Decision, right routing.Decision) bool {
	return left.RequestedModel == right.RequestedModel &&
		left.ModelRef == right.ModelRef &&
		reflect.DeepEqual(left.CandidateModelRefs, right.CandidateModelRefs) &&
		left.RoutingDecisionKeyHash == right.RoutingDecisionKeyHash &&
		left.RoutingDecisionMaterial == right.RoutingDecisionMaterial &&
		left.RoutingReason == right.RoutingReason &&
		left.PolicyHash == right.PolicyHash
}

func waitForGatewayHoldoutObservation(t *testing.T, observations <-chan routing.DifficultySemanticShadowObservation) routing.DifficultySemanticShadowObservation {
	t.Helper()
	select {
	case observation := <-observations:
		return observation
	case <-time.After(30 * time.Second):
		t.Fatal("timed out waiting for native Gateway shadow observation")
		return routing.DifficultySemanticShadowObservation{}
	}
}

func warmGatewayHoldout(t *testing.T, evaluator *routing.DifficultySemanticShadowEvaluator, records []gatewayHoldoutDatasetRecord, reference []gatewayHoldoutReferenceSample) {
	t.Helper()
	classifier := routing.NewRuleBasedCategoryClassifier()
	for index, record := range records {
		if !reference[index].ModelPath {
			continue
		}
		features := routing.ExtractPromptFeatures(record.RedactedPrompt)
		category := classifier.ClassifyFeatures(features).Category
		if result := evaluator.Evaluate(context.Background(), features, category); result.Status != routing.DifficultySemanticShadowReady {
			t.Fatalf("native Gateway holdout warmup failed for sampleId=%s", record.SampleID)
		}
	}
}

func measureGatewayHoldoutBusySaturation(t *testing.T, runner *routing.DifficultySemanticShadowRunner, record gatewayHoldoutDatasetRecord, observations <-chan routing.DifficultySemanticShadowObservation) gatewayHoldoutBusySaturation {
	t.Helper()
	features := routing.ExtractPromptFeatures(record.RedactedPrompt)
	category := routing.NewRuleBasedCategoryClassifier().ClassifyFeatures(features).Category
	difficultyFeatures := routing.ExtractDifficultyFeatures(features, category)
	ruleDifficulty := routing.NewRuleBasedDifficultyClassifier().ClassifyFeatures(difficultyFeatures).Difficulty
	const attempts = 10
	accepted := 0
	rejectedLatencies := []float64{}
	for index := 0; index < attempts; index++ {
		started := time.Now()
		if runner.Submit(features, category, ruleDifficulty) {
			accepted++
		} else {
			rejectedLatencies = append(rejectedLatencies, microsSince(started))
		}
	}
	busy := 0
	for index := 0; index < attempts; index++ {
		if observation := waitForGatewayHoldoutObservation(t, observations); observation.Status == routing.DifficultySemanticShadowBusy {
			busy++
		}
	}
	if busy == 0 || busy != attempts-accepted {
		t.Fatal("native Gateway shadow saturation did not expose bounded busy isolation")
	}
	return gatewayHoldoutBusySaturation{Attempts: attempts, Accepted: accepted, RejectedBusy: busy, RejectedLatency: summarizeHoldoutLatency(rejectedLatencies)}
}

func measureNativeTimeoutRecovery(record gatewayHoldoutDatasetRecord, encoder routing.DifficultySemanticPooledEncoder) gatewayHoldoutNativeTimeoutRecovery {
	features := routing.ExtractPromptFeatures(record.RedactedPrompt)
	instruction, ok := routing.DifficultySemanticInputForOffline(features)
	if !ok {
		return gatewayHoldoutNativeTimeoutRecovery{Status: "not_proven", InterruptsInFlightONNXRun: "not_proven"}
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	started := time.Now()
	_, _ = encoder.EncodePooled(ctx, instruction)
	elapsed := microsSince(started)
	deadlineObserved := ctx.Err() == context.DeadlineExceeded
	cancel()
	recoveryCtx, recoveryCancel := context.WithTimeout(context.Background(), 30*time.Second)
	_, recoveryErr := encoder.EncodePooled(recoveryCtx, instruction)
	recoveryCancel()
	succeeded := recoveryErr == nil
	status := "not_proven"
	if deadlineObserved && succeeded {
		status = "passed"
	}
	return gatewayHoldoutNativeTimeoutRecovery{
		Status: status, DeadlineObserved: deadlineObserved, ElapsedMicros: elapsed,
		SubsequentInferenceSucceeded: succeeded, InterruptsInFlightONNXRun: "not_proven",
	}
}

func summarizeGatewayHoldoutObserved(samples []gatewayHoldoutObservedSample, field string) holdoutClassificationSummary {
	summary := holdoutClassificationSummary{Samples: len(samples)}
	for _, sample := range samples {
		prediction := sample.GoDifficulty
		if field == "rule" {
			prediction = sample.RuleDifficulty
		}
		if sample.ExpectedDifficulty == routing.DifficultySimple {
			summary.SimpleExpected++
			if prediction == routing.DifficultyComplex {
				summary.SimpleToComplex++
			}
		} else {
			summary.ComplexExpected++
			if prediction == routing.DifficultySimple {
				summary.ComplexToSimple++
			}
		}
		if prediction == sample.ExpectedDifficulty {
			summary.Correct++
		}
	}
	if summary.Samples > 0 {
		summary.Accuracy = float64(summary.Correct) / float64(summary.Samples)
	}
	return summary
}

func microsSince(started time.Time) float64 {
	return float64(time.Since(started).Nanoseconds()) / 1000.0
}

func summarizeHoldoutLatency(values []float64) holdoutLatencySummary {
	if len(values) == 0 {
		return holdoutLatencySummary{}
	}
	return holdoutLatencySummary{
		Samples: len(values), P50: percentileFloat(values, 0.50), P95: percentileFloat(values, 0.95),
		P99: percentileFloat(values, 0.99), Max: maximumFloat(values),
	}
}

func percentileFloat(values []float64, percentile float64) float64 {
	if len(values) == 0 {
		return 0
	}
	ordered := append([]float64(nil), values...)
	sort.Float64s(ordered)
	position := float64(len(ordered)-1) * percentile
	lower := int(math.Floor(position))
	upper := int(math.Ceil(position))
	if lower == upper {
		return ordered[lower]
	}
	fraction := position - float64(lower)
	return ordered[lower]*(1-fraction) + ordered[upper]*fraction
}

func maximumFloat(values []float64) float64 {
	maximum := 0.0
	for _, value := range values {
		if value > maximum {
			maximum = value
		}
	}
	return maximum
}

func readHoldoutMemorySnapshot() holdoutMemorySnapshot {
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	status := readProcStatusValues()
	return holdoutMemorySnapshot{
		RSS: status["VmRSS"], HWM: status["VmHWM"], Threads: status["Threads"],
		CgroupCurrent: readIntegerFile("/sys/fs/cgroup/memory.current"),
		CgroupPeak:    readIntegerFile("/sys/fs/cgroup/memory.peak"),
		GoHeapAlloc:   memory.HeapAlloc, GoHeapSys: memory.HeapSys, GoSys: memory.Sys, GoNumGC: memory.NumGC,
	}
}

func readProcStatusValues() map[string]int64 {
	result := map[string]int64{}
	payload, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return result
	}
	for _, line := range strings.Split(string(payload), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := strings.TrimSuffix(fields[0], ":")
		if name != "VmRSS" && name != "VmHWM" && name != "Threads" {
			continue
		}
		value, err := strconv.ParseInt(fields[1], 10, 64)
		if err != nil {
			continue
		}
		if name == "VmRSS" || name == "VmHWM" {
			value *= 1024
		}
		result[name] = value
	}
	return result
}

func readIntegerFile(path string) int64 {
	payload, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	value, err := strconv.ParseInt(strings.TrimSpace(string(payload)), 10, 64)
	if err != nil {
		return 0
	}
	return value
}

func maxHoldoutMemorySnapshot(left holdoutMemorySnapshot, right holdoutMemorySnapshot) holdoutMemorySnapshot {
	return holdoutMemorySnapshot{
		RSS: maxInt64(left.RSS, right.RSS), HWM: maxInt64(left.HWM, right.HWM),
		CgroupCurrent: maxInt64(left.CgroupCurrent, right.CgroupCurrent), CgroupPeak: maxInt64(left.CgroupPeak, right.CgroupPeak),
		GoHeapAlloc: maxUint64(left.GoHeapAlloc, right.GoHeapAlloc), GoHeapSys: maxUint64(left.GoHeapSys, right.GoHeapSys),
		GoSys: maxUint64(left.GoSys, right.GoSys), GoNumGC: maxUint32(left.GoNumGC, right.GoNumGC),
		Threads: maxInt64(left.Threads, right.Threads),
	}
}

func maxInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
func maxUint64(left uint64, right uint64) uint64 {
	if left > right {
		return left
	}
	return right
}
func maxUint32(left uint32, right uint32) uint32 {
	if left > right {
		return left
	}
	return right
}

func writeGatewayHoldoutReport(t *testing.T, path string, report gatewayHoldoutReplayRun) {
	t.Helper()
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal("encode aggregate-only Gateway holdout report")
	}
	payload = append(payload, '\n')
	if bytes.Contains(payload, []byte("redactedPrompt")) || bytes.Contains(payload, []byte("complexityScore")) || bytes.Contains(payload, []byte("token")) || bytes.Contains(payload, []byte("embedding")) {
		t.Fatal("forbidden per-request material entered aggregate Gateway holdout report")
	}
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(fmt.Errorf("write aggregate-only Gateway holdout report: %w", err))
	}
}
