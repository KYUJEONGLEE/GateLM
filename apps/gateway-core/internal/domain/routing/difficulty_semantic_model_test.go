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

func TestDifficultySemanticModelAssemblesExact118DBlocks(t *testing.T) {
	features := syntheticDifficultySemanticModelFeatures()
	vector, err := generatedDifficultySemanticModel118D.assembleModelVector(
		features,
		syntheticDifficultySemanticPooled(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(vector) != 118 {
		t.Fatalf("semantic vector dimension=%d, want 118", len(vector))
	}
	if vector[0] != 0 || vector[1] != 1 || vector[8] != 1 || vector[41] != 0 {
		t.Fatalf("rule block offsets drifted")
	}
	if delta := math.Abs(vector[42] - -0.3578607439994812); delta > 2e-6 {
		t.Fatalf("projection block start delta=%g exceeds tolerance", delta)
	}
	if delta := math.Abs(vector[105] - 0.08702966570854187); delta > 2e-6 {
		t.Fatalf("projection block end delta=%g exceeds tolerance", delta)
	}
	if delta := math.Abs(vector[106] - 0.6659214847694449); delta > 1e-6 {
		t.Fatalf("semantic head block start delta=%g exceeds tolerance", delta)
	}
	if delta := math.Abs(vector[117] - 0.18833381597465082); delta > 1e-6 {
		t.Fatalf("semantic head block end delta=%g exceeds tolerance", delta)
	}
}

func TestDifficultySemanticShadowEvaluatorUsesInstructionOnlyEncoder(t *testing.T) {
	encoder := &testDifficultyPooledEncoder{pooled: syntheticDifficultySemanticPooled()}
	evaluator := NewDifficultySemanticShadowEvaluator(encoder)
	features := ExtractPromptFeatures("Explain one workflow step.")

	result := evaluator.Evaluate(context.Background(), features, CategoryGeneral)

	if result.Status != DifficultySemanticShadowReady || result.Difficulty.Difficulty != DifficultyComplex {
		t.Fatalf("shadow result=%+v, want ready complex result", result)
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
	identity := generatedDifficultySemanticModel118D.identity
	if identity.artifactVersion != "difficulty-offline.owner-approved-500.2026-07-15.42d-rule-vector-v1-plus-projection-plus-semantic-head-probabilities.v2" ||
		identity.bundleHash != "sha256:4835d722bba348416693eda83bc33ff0328d93bb4e806c762481df94f57ec5ed" ||
		identity.contentHash != "sha256:b41ed845c7b6931c7ad5738c7ef95e3013d5b1708ccd09440a86db5cd158efa0" ||
		identity.projectionHash != "sha256:cddd5ea36ab6ee5bae0144e04f3faabe1c593857c5f53e058aa184ae790e2e12" ||
		identity.semanticHeadsHash != "sha256:64b0590af9a9cbb8bfc62d43bdcb2930ae584eee59e2707aa9c4af7b358ef9fb" {
		t.Fatalf("generated semantic model identity drifted: %+v", identity)
	}
	digest := sha256.New()
	var encoded [4]byte
	write := func(value float32) {
		binary.LittleEndian.PutUint32(encoded[:], math.Float32bits(value))
		_, _ = digest.Write(encoded[:])
	}
	for _, value := range generatedDifficultySemanticModel118D.pcaMean {
		write(value)
	}
	for _, row := range generatedDifficultySemanticModel118D.pcaComponents {
		for _, value := range row {
			write(value)
		}
	}
	actual := "sha256:" + hex.EncodeToString(digest.Sum(nil))
	if actual != identity.projectionHash {
		t.Fatalf("compiled PCA hash = %s, want pinned projection hash", actual)
	}
}

func TestDifficultySemanticModelMatchesPythonCanonicalSyntheticParity(t *testing.T) {
	features := syntheticDifficultySemanticModelFeatures()
	pooled := syntheticDifficultySemanticPooled()
	projection, err := generatedDifficultySemanticModel118D.projectPooled(pooled)
	if err != nil {
		t.Fatal(err)
	}
	projectionCheckpoints := map[int]float64{
		0:  -0.3578607439994812,
		1:  0.08811639994382858,
		17: 0.10118965059518814,
		63: 0.08702966570854187,
	}
	for index, expected := range projectionCheckpoints {
		if delta := math.Abs(float64(projection[index]) - expected); delta > 2e-6 {
			t.Fatalf("PCA checkpoint %d delta=%g exceeds tolerance", index, delta)
		}
	}

	heads, err := generatedDifficultySemanticModel118D.predictSemanticHeads(projection)
	if err != nil {
		t.Fatal(err)
	}
	expectedHeads := [difficultySemanticHeadProbabilityDimension]float64{
		0.6659214847694449, 0.08796352028738748, 0.24611499494316752,
		0.7228245820524181, 0.06442186710978645, 0.21275355083779557,
		0.29936366865553737, 0.45518764862537853, 0.24544868271908407,
		0.3856842812246019, 0.42598190280074716, 0.18833381597465082,
	}
	for index, expected := range expectedHeads {
		if delta := math.Abs(heads[index] - expected); delta > 1e-6 {
			t.Fatalf("semantic head checkpoint %d delta=%g exceeds tolerance", index, delta)
		}
	}
	for head := 0; head < difficultySemanticHeadCount; head++ {
		sum := 0.0
		for class := 0; class < difficultySemanticHeadClassCount; class++ {
			sum += heads[head*difficultySemanticHeadClassCount+class]
		}
		if math.Abs(sum-1) > 1e-12 {
			t.Fatalf("semantic head %d probability sum=%v", head, sum)
		}
	}

	result, err := generatedDifficultySemanticModel118D.inferModelPath(features, pooled)
	if err != nil {
		t.Fatal(err)
	}
	if delta := math.Abs(result.ComplexityScore - 0.9999474611528935); delta > 2e-8 {
		t.Fatalf("calibrated score=%v delta=%g exceeds tolerance", result.ComplexityScore, delta)
	}
	if result.Difficulty != DifficultyComplex {
		t.Fatalf("difficulty=%q, want complex", result.Difficulty)
	}
	if generatedDifficultySemanticModel118D.threshold != 0.45 ||
		difficultyFromScore(0.45, generatedDifficultySemanticModel118D.threshold) != DifficultyComplex ||
		difficultyFromScore(math.Nextafter(0.45, 0), generatedDifficultySemanticModel118D.threshold) != DifficultySimple {
		t.Fatal("selected threshold must use greater-than-or-equal semantics at 0.45")
	}
}

func TestDifficultySemanticModelRejectsUnavailableShadowInputsSafely(t *testing.T) {
	pooled := syntheticDifficultySemanticPooled()
	sentinel := DifficultyFeatures{
		category: CategoryGeneral,
		common:   CommonDifficultyFeatures{payloadSizeBucket: "empty"},
		general:  &GeneralDifficultyFeatures{},
	}
	if _, err := generatedDifficultySemanticModel118D.inferModelPath(sentinel, pooled); !errors.Is(err, errDifficultySemanticModelPathRequired) {
		t.Fatalf("sentinel input error=%v", err)
	}
	features := syntheticDifficultySemanticModelFeatures()
	pooled[12] = float32(math.NaN())
	if _, err := generatedDifficultySemanticModel118D.inferModelPath(features, pooled); !errors.Is(err, errDifficultySemanticInputInvalid) {
		t.Fatalf("non-finite input error=%v", err)
	} else if strings.Contains(strings.ToLower(err.Error()), "nan") || strings.Contains(err.Error(), "12") {
		t.Fatalf("safe error exposed input material: %q", err)
	}
	degenerate := generatedDifficultySemanticModel118D.pcaMean
	if _, err := generatedDifficultySemanticModel118D.inferModelPath(features, degenerate); !errors.Is(err, errDifficultySemanticProjectionInvalid) {
		t.Fatalf("degenerate projection error=%v", err)
	}
}

func TestDifficultySemanticModelSuccessPathDoesNotAllocate(t *testing.T) {
	features := syntheticDifficultySemanticModelFeatures()
	pooled := syntheticDifficultySemanticPooled()
	if allocations := testing.AllocsPerRun(100, func() {
		result, err := generatedDifficultySemanticModel118D.inferModelPath(features, pooled)
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
	result, err := generatedDifficultySemanticModel118D.inferModelPath(
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
