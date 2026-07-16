package routing

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"math"
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestDifficultySemanticModelAssemblesExact106DBlocks(t *testing.T) {
	features := syntheticDifficultySemanticModelFeatures()
	vector, err := generatedDifficultySemanticModel106D.assembleModelVector(
		features,
		syntheticDifficultySemanticPooled(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(vector) != 106 {
		t.Fatalf("semantic vector dimension=%d, want 106", len(vector))
	}
	if vector[0] != 0 || vector[1] != 1 || vector[8] != 1 || vector[41] != 0 {
		t.Fatalf("rule block offsets drifted")
	}
	for index, value := range vector[42:] {
		if !finiteDifficultyFloat(value) {
			t.Fatalf("projection block value %d is not finite", index)
		}
	}
}

func TestDifficultySemanticShadowEvaluatorUsesInstructionOnlyEncoder(t *testing.T) {
	encoder := &testDifficultyPooledEncoder{pooled: syntheticDifficultySemanticPooled()}
	evaluator := NewDifficultySemanticShadowEvaluator(encoder)
	features := ExtractPromptFeatures("Explain one workflow step.")

	result := evaluator.Evaluate(context.Background(), features, CategoryGeneral)

	if result.Status != DifficultySemanticShadowReady || result.Difficulty.Difficulty != DifficultySimple {
		t.Fatalf("shadow result=%+v, want ready simple result", result)
	}
	if encoder.input != "explain one workflow step." {
		t.Fatalf("encoder input boundary drifted")
	}
}

func TestDifficultySemanticShadowEvaluatorFailsClosedWithoutExposingEncoderError(t *testing.T) {
	encoder := &testDifficultyPooledEncoder{err: errors.New("secret token 123")}
	evaluator := NewDifficultySemanticShadowEvaluator(encoder)
	features := ExtractPromptFeatures("Explain one workflow step.")

	result := evaluator.Evaluate(context.Background(), features, CategoryGeneral)

	if result.Status != DifficultySemanticShadowInferenceFailed || result.Difficulty.Difficulty != "" {
		t.Fatalf("shadow failure=%+v, want sanitized unavailable result", result)
	}
	if strings.Contains(result.Status, "secret") || strings.Contains(result.Status, "123") {
		t.Fatalf("shadow status exposed encoder error: %q", result.Status)
	}
}

func TestDifficultySemanticShadowEvaluatorReturnsUnavailableWithoutEncoder(t *testing.T) {
	result := NewDifficultySemanticShadowEvaluator(nil).Evaluate(
		context.Background(),
		ExtractPromptFeatures("Explain one workflow step."),
		CategoryGeneral,
	)
	if result.Status != DifficultySemanticShadowUnavailable || result.Difficulty.Difficulty != "" {
		t.Fatalf("shadow result=%+v, want unavailable without a product result", result)
	}
}

func TestDifficultySemanticShadowEvaluatorRejectsConcurrentInferenceAsBusy(t *testing.T) {
	encoder := &blockingDifficultyPooledEncoder{
		entered: make(chan struct{}),
		release: make(chan struct{}),
	}
	evaluator := NewDifficultySemanticShadowEvaluator(encoder)
	features := ExtractPromptFeatures("Explain one workflow step.")
	firstDone := make(chan DifficultySemanticShadowResult, 1)
	go func() {
		firstDone <- evaluator.Evaluate(context.Background(), features, CategoryGeneral)
	}()
	<-encoder.entered

	second := evaluator.Evaluate(context.Background(), features, CategoryGeneral)
	if second.Status != DifficultySemanticShadowBusy || second.Difficulty.Difficulty != "" {
		t.Fatalf("concurrent shadow result=%+v, want busy without a product result", second)
	}
	close(encoder.release)
	if first := <-firstDone; first.Status != DifficultySemanticShadowReady {
		t.Fatalf("first shadow result=%+v, want ready", first)
	}
}

type testDifficultyPooledEncoder struct {
	input  string
	pooled DifficultySemanticPooled
	err    error
}

func (encoder *testDifficultyPooledEncoder) EncodePooled(_ context.Context, instructionText string) (DifficultySemanticPooled, error) {
	encoder.input = instructionText
	return encoder.pooled, encoder.err
}

func (*testDifficultyPooledEncoder) Close() error { return nil }

type blockingDifficultyPooledEncoder struct {
	entered chan struct{}
	release chan struct{}
}

func (encoder *blockingDifficultyPooledEncoder) EncodePooled(
	_ context.Context,
	_ string,
) (DifficultySemanticPooled, error) {
	close(encoder.entered)
	<-encoder.release
	return syntheticDifficultySemanticPooled(), nil
}

func (*blockingDifficultyPooledEncoder) Close() error { return nil }

func TestGeneratedDifficultySemanticModelIdentityAndProjectionBitsArePinned(t *testing.T) {
	identity := generatedDifficultySemanticModel106D.identity
	if identity.artifactVersion != "difficulty-offline.model-path-5000.2026-07-16.42d-rule-vector-v1-plus-projection.shadow.v1" ||
		identity.bundleHash != "sha256:1a755c3bca16f76a43f86696e9b2028e805eb7536161245a8683adf78b118ebd" ||
		identity.contentHash != "sha256:4c2c4f516206530d3b3f9c393b0633b7694a2e0aa5e20400d65faf088a184f5d" ||
		identity.projectionHash != "sha256:4800637a5aa82e3184cdb86052acbe973ba91aeb8119684ecba5baef4e1afc3d" ||
		identity.semanticHeadsHash != "sha256:8f835ce1799c18c32a7751a159fbd84a20bd970c39a7e13c41cf4ccca4790eef" {
		t.Fatalf("generated semantic model identity drifted: %+v", identity)
	}
	digest := sha256.New()
	var encoded [4]byte
	write := func(value float32) {
		binary.LittleEndian.PutUint32(encoded[:], math.Float32bits(value))
		_, _ = digest.Write(encoded[:])
	}
	for _, value := range generatedDifficultySemanticModel106D.pcaMean {
		write(value)
	}
	for _, row := range generatedDifficultySemanticModel106D.pcaComponents {
		for _, value := range row {
			write(value)
		}
	}
	actual := "sha256:" + hex.EncodeToString(digest.Sum(nil))
	if actual != identity.projectionHash {
		t.Fatalf("compiled PCA hash = %s, want pinned projection hash", actual)
	}
}

func TestGeneratedDifficultySemanticModelMatchesCurrentDecisionBoundary(t *testing.T) {
	identity := generatedDifficultySemanticModel106D.identity
	if identity.decisionBoundaryVersion != "difficulty-decision-boundary.semantic-empty-combined-8.2026-07-15.v2" {
		t.Fatalf("decision boundary identity drifted: %q", identity.decisionBoundaryVersion)
	}
	if identity.decisionBoundaryVersion != DifficultyDecisionBoundaryVersion {
		t.Fatal("semantic model does not match the current decision boundary")
	}
	if !DifficultySemanticShadowModelCompatible() {
		t.Fatal("current semantic model was rejected by the current decision boundary")
	}
}

func TestGeneratedDifficultySemanticModelRejectsHistoricalBaselineE2EWaiver(t *testing.T) {
	for _, waiver := range []string{
		"",
		DifficultySemanticShadowBaselineE2EWaiverV3,
		"difficulty-shadow-baseline-e2e-v3-2026-07-15-typo",
		"difficulty-shadow-baseline-e2e-v4-2026-07-15",
	} {
		if DifficultySemanticShadowBaselineWaiverAccepted(waiver) {
			t.Fatalf("unexpected baseline E2E waiver accepted: %q", waiver)
		}
	}
}

func TestDifficultySemanticModelMatchesPythonCanonicalSyntheticParity(t *testing.T) {
	features := syntheticDifficultySemanticModelFeatures()
	pooled := syntheticDifficultySemanticPooled()
	projection, err := generatedDifficultySemanticModel106D.projectPooled(pooled)
	if err != nil {
		t.Fatal(err)
	}
	projectionCheckpoints := map[int]float64{
		0:  -0.179607555270195,
		1:  -0.10602201521396637,
		17: 0.17137280106544495,
		63: 0.05988718941807747,
	}
	for index, expected := range projectionCheckpoints {
		if delta := math.Abs(float64(projection[index]) - expected); delta > 2e-6 {
			t.Fatalf("PCA checkpoint %d delta=%g exceeds tolerance", index, delta)
		}
	}

	result, err := generatedDifficultySemanticModel106D.inferModelPath(features, pooled)
	if err != nil {
		t.Fatal(err)
	}
	if delta := math.Abs(result.ComplexityScore - 0.00972840314063258); delta > 1e-7 {
		t.Fatalf("calibrated score=%v delta=%g exceeds tolerance", result.ComplexityScore, delta)
	}
	if result.Difficulty != DifficultySimple {
		t.Fatalf("difficulty=%q, want simple", result.Difficulty)
	}
	if generatedDifficultySemanticModel106D.threshold != 0.096 ||
		difficultyFromScore(0.096, generatedDifficultySemanticModel106D.threshold) != DifficultyComplex ||
		difficultyFromScore(math.Nextafter(0.096, 0), generatedDifficultySemanticModel106D.threshold) != DifficultySimple {
		t.Fatal("selected threshold must use greater-than-or-equal semantics at 0.096")
	}
}

func TestDifficultySemanticModelRejectsUnavailableShadowInputsSafely(t *testing.T) {
	pooled := syntheticDifficultySemanticPooled()
	sentinel := DifficultyFeatures{
		category: CategoryGeneral,
		common:   CommonDifficultyFeatures{payloadSizeBucket: "empty"},
		general:  &GeneralDifficultyFeatures{},
	}
	if _, err := generatedDifficultySemanticModel106D.inferModelPath(sentinel, pooled); !errors.Is(err, errDifficultySemanticModelPathRequired) {
		t.Fatalf("sentinel input error=%v", err)
	}
	features := syntheticDifficultySemanticModelFeatures()
	pooled[12] = float32(math.NaN())
	if _, err := generatedDifficultySemanticModel106D.inferModelPath(features, pooled); !errors.Is(err, errDifficultySemanticInputInvalid) {
		t.Fatalf("non-finite input error=%v", err)
	} else if strings.Contains(strings.ToLower(err.Error()), "nan") || strings.Contains(err.Error(), "12") {
		t.Fatalf("safe error exposed input material: %q", err)
	}
	degenerate := generatedDifficultySemanticModel106D.pcaMean
	if _, err := generatedDifficultySemanticModel106D.inferModelPath(features, degenerate); !errors.Is(err, errDifficultySemanticProjectionInvalid) {
		t.Fatalf("degenerate projection error=%v", err)
	}
}

func TestDifficultySemanticModelSuccessPathDoesNotAllocate(t *testing.T) {
	features := syntheticDifficultySemanticModelFeatures()
	pooled := syntheticDifficultySemanticPooled()
	if allocations := testing.AllocsPerRun(100, func() {
		result, err := generatedDifficultySemanticModel106D.inferModelPath(features, pooled)
		if err != nil || result.Difficulty == "" {
			panic("semantic model inference failed")
		}
	}); allocations != 0 {
		t.Fatalf("semantic model success allocations=%v, want 0", allocations)
	}
}

func TestDifficultySemanticModelExternalPythonParity(t *testing.T) {
	expectedText := os.Getenv("GATELM_DIFFICULTY_GATEWAY_PARITY_SCORE")
	if expectedText == "" {
		t.Skip("specialist Python parity score was not provided")
	}
	expected, err := strconv.ParseFloat(expectedText, 64)
	if err != nil || !finiteDifficultyFloat(expected) {
		t.Fatal("specialist Python parity score is invalid")
	}
	result, err := generatedDifficultySemanticModel106D.inferModelPath(
		syntheticDifficultySemanticModelFeatures(),
		syntheticDifficultySemanticPooled(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if delta := math.Abs(result.ComplexityScore - expected); delta > 1e-6 {
		t.Fatalf("Python-Go calibrated score delta=%g exceeds tolerance", delta)
	}
}

func syntheticDifficultySemanticModelFeatures() DifficultyFeatures {
	return DifficultyFeatures{
		category: CategoryGeneral,
		common: CommonDifficultyFeatures{
			payloadSizeBucket: "small",
			taskCount:         1,
		},
		general: &GeneralDifficultyFeatures{workflowDepth: 1},
	}
}

func syntheticDifficultySemanticPooled() [difficultySemanticPooledDimension]float32 {
	var pooled [difficultySemanticPooledDimension]float32
	for index := range pooled {
		pooled[index] = float32((index%17)-8) / 16
	}
	return pooled
}
