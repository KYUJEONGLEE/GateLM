package routing

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

type stubDifficultySemanticShadowEvaluation struct {
	evaluate func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult
	close    func() error
	closed   atomic.Int32
}

func (stub *stubDifficultySemanticShadowEvaluation) Evaluate(
	ctx context.Context,
	features PromptFeatures,
	category string,
) DifficultySemanticShadowResult {
	if stub.evaluate == nil {
		return DifficultySemanticShadowResult{Status: DifficultySemanticShadowUnavailable}
	}
	return stub.evaluate(ctx, features, category)
}

func (stub *stubDifficultySemanticShadowEvaluation) Close() error {
	stub.closed.Add(1)
	if stub.close != nil {
		return stub.close()
	}
	return nil
}

func TestSimpleRouterKeepsRuleDifficultyAndModelRefWhenShadowDisagrees(t *testing.T) {
	observations := make(chan DifficultySemanticShadowObservation, 1)
	evaluation := &stubDifficultySemanticShadowEvaluation{
		evaluate: func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult {
			return DifficultySemanticShadowResult{
				Status: DifficultySemanticShadowReady,
				Difficulty: DifficultyResult{
					ComplexityScore: 0.99,
					Difficulty:      DifficultyComplex,
				},
			}
		},
	}
	runner := NewDifficultySemanticShadowRunner(
		evaluation,
		100*time.Millisecond,
		DifficultySemanticShadowObserverFunc(func(observation DifficultySemanticShadowObservation) {
			observations <- observation
		}),
	)
	t.Cleanup(func() { closeDifficultySemanticShadowRunnerForTest(t, runner) })

	config := defaultSimpleRouterConfig()
	config.Routes.General.Simple.ModelRefs = []string{"rule-simple"}
	config.Routes.General.Complex.ModelRefs = []string{"rule-complex"}
	router := NewSimpleRouter(config, WithDifficultySemanticShadow(runner))
	decision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel: "auto",
		PromptText:     "Explain OAuth briefly.",
	})
	if err != nil {
		t.Fatalf("DecideRoute() error = %v", err)
	}
	if decision.RoutingDecisionMaterial.Difficulty != DifficultySimple || decision.ModelRef != "rule-simple" {
		t.Fatalf("shadow changed authoritative route: %+v", decision)
	}

	observation := waitForDifficultySemanticShadowObservation(t, observations)
	if observation.Status != DifficultySemanticShadowReady ||
		observation.Comparison != DifficultySemanticShadowComparisonRuleSimpleShadowComplex {
		t.Fatalf("unexpected shadow observation: %+v", observation)
	}
}

func TestSimpleRouterDoesNotSubmitManualModelRefToShadow(t *testing.T) {
	var calls atomic.Int32
	evaluation := &stubDifficultySemanticShadowEvaluation{
		evaluate: func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult {
			calls.Add(1)
			return DifficultySemanticShadowResult{Status: DifficultySemanticShadowReady}
		},
	}
	runner := NewDifficultySemanticShadowRunner(evaluation, 100*time.Millisecond, nil)
	t.Cleanup(func() { closeDifficultySemanticShadowRunnerForTest(t, runner) })
	router := NewSimpleRouter(defaultSimpleRouterConfig(), WithDifficultySemanticShadow(runner))

	decision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel: "opaque-manual-model",
		PromptText:     "Design a distributed migration with failure paths.",
	})
	if err != nil || decision.ModelRef != "opaque-manual-model" {
		t.Fatalf("manual route failed: decision=%+v err=%v", decision, err)
	}
	time.Sleep(10 * time.Millisecond)
	if calls.Load() != 0 {
		t.Fatalf("manual route submitted %d shadow jobs", calls.Load())
	}
}

func TestSimpleRouterNeverWaitsForShadowEvaluation(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	evaluation := &stubDifficultySemanticShadowEvaluation{
		evaluate: func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult {
			close(entered)
			<-release
			return DifficultySemanticShadowResult{
				Status:     DifficultySemanticShadowReady,
				Difficulty: DifficultyResult{Difficulty: DifficultyComplex},
			}
		},
	}
	runner := NewDifficultySemanticShadowRunner(evaluation, time.Second, nil)
	router := NewSimpleRouter(defaultSimpleRouterConfig(), WithDifficultySemanticShadow(runner))

	startedAt := time.Now()
	decision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel: "auto",
		PromptText:     "Explain OAuth briefly.",
	})
	if err != nil || decision.ModelRef == "" {
		t.Fatalf("rule route failed: decision=%+v err=%v", decision, err)
	}
	if elapsed := time.Since(startedAt); elapsed > 50*time.Millisecond {
		t.Fatalf("route waited for shadow evaluation: %s", elapsed)
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("shadow worker did not start")
	}
	close(release)
	closeDifficultySemanticShadowRunnerForTest(t, runner)
}

func TestDifficultySemanticShadowRunnerSanitizesTimeoutAndPanic(t *testing.T) {
	t.Run("timeout", func(t *testing.T) {
		observations := make(chan DifficultySemanticShadowObservation, 1)
		evaluation := &stubDifficultySemanticShadowEvaluation{
			evaluate: func(ctx context.Context, _ PromptFeatures, _ string) DifficultySemanticShadowResult {
				<-ctx.Done()
				return DifficultySemanticShadowResult{Status: DifficultySemanticShadowInferenceFailed}
			},
		}
		runner := NewDifficultySemanticShadowRunner(
			evaluation,
			5*time.Millisecond,
			DifficultySemanticShadowObserverFunc(func(observation DifficultySemanticShadowObservation) {
				observations <- observation
			}),
		)
		runner.Submit(ExtractPromptFeatures("safe timeout sample"), CategoryGeneral, DifficultySimple)
		observation := waitForDifficultySemanticShadowObservation(t, observations)
		if observation.Status != DifficultySemanticShadowTimeout ||
			observation.Comparison != DifficultySemanticShadowComparisonNotCompared {
			t.Fatalf("unexpected timeout observation: %+v", observation)
		}
		closeDifficultySemanticShadowRunnerForTest(t, runner)
	})

	t.Run("panic", func(t *testing.T) {
		observations := make(chan DifficultySemanticShadowObservation, 1)
		evaluation := &stubDifficultySemanticShadowEvaluation{
			evaluate: func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult {
				panic("sensitive panic detail must not escape")
			},
		}
		runner := NewDifficultySemanticShadowRunner(
			evaluation,
			100*time.Millisecond,
			DifficultySemanticShadowObserverFunc(func(observation DifficultySemanticShadowObservation) {
				observations <- observation
			}),
		)
		runner.Submit(ExtractPromptFeatures("safe panic sample"), CategoryGeneral, DifficultyComplex)
		observation := waitForDifficultySemanticShadowObservation(t, observations)
		if observation.Status != DifficultySemanticShadowPanicRecovered ||
			observation.Comparison != DifficultySemanticShadowComparisonNotCompared {
			t.Fatalf("unexpected panic observation: %+v", observation)
		}
		closeDifficultySemanticShadowRunnerForTest(t, runner)
	})
}

func TestDifficultySemanticShadowRunnerSanitizesUnknownEvaluatorStatus(t *testing.T) {
	observations := make(chan DifficultySemanticShadowObservation, 1)
	evaluation := &stubDifficultySemanticShadowEvaluation{
		evaluate: func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult {
			return DifficultySemanticShadowResult{
				Status:     "secret evaluator detail",
				Difficulty: DifficultyResult{ComplexityScore: 0.712345, Difficulty: DifficultyComplex},
			}
		},
	}
	runner := NewDifficultySemanticShadowRunner(
		evaluation,
		100*time.Millisecond,
		DifficultySemanticShadowObserverFunc(func(observation DifficultySemanticShadowObservation) {
			observations <- observation
		}),
	)
	runner.Submit(ExtractPromptFeatures("safe sanitizer sample"), CategoryGeneral, DifficultySimple)
	observation := waitForDifficultySemanticShadowObservation(t, observations)
	if observation.Status != DifficultySemanticShadowUnavailable ||
		observation.Comparison != DifficultySemanticShadowComparisonNotCompared {
		t.Fatalf("unknown evaluator material crossed the observer boundary: %+v", observation)
	}
	closeDifficultySemanticShadowRunnerForTest(t, runner)
}

func TestDifficultySemanticShadowRunnerBoundsActiveAndQueuedWork(t *testing.T) {
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	observations := make(chan DifficultySemanticShadowObservation, 3)
	evaluation := &stubDifficultySemanticShadowEvaluation{
		evaluate: func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult {
			entered <- struct{}{}
			<-release
			return DifficultySemanticShadowResult{
				Status:     DifficultySemanticShadowReady,
				Difficulty: DifficultyResult{Difficulty: DifficultySimple},
			}
		},
	}
	runner := NewDifficultySemanticShadowRunner(
		evaluation,
		time.Second,
		DifficultySemanticShadowObserverFunc(func(observation DifficultySemanticShadowObservation) {
			observations <- observation
		}),
	)
	features := ExtractPromptFeatures("safe bounded sample")
	if !runner.Submit(features, CategoryGeneral, DifficultySimple) {
		t.Fatal("first shadow job was not accepted")
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("first shadow job did not start")
	}
	if !runner.Submit(features, CategoryGeneral, DifficultySimple) {
		t.Fatal("one waiting shadow job should be accepted")
	}
	if runner.Submit(features, CategoryGeneral, DifficultySimple) {
		t.Fatal("third shadow job should be rejected while one is active and one is queued")
	}
	busy := waitForDifficultySemanticShadowObservation(t, observations)
	if busy.Status != DifficultySemanticShadowBusy || busy.Comparison != DifficultySemanticShadowComparisonNotCompared {
		t.Fatalf("unexpected busy observation: %+v", busy)
	}
	close(release)
	closeDifficultySemanticShadowRunnerForTest(t, runner)
}

func TestDifficultySemanticShadowRunnerIsolatesObserverPanicAndContinues(t *testing.T) {
	var evaluations atomic.Int32
	evaluation := &stubDifficultySemanticShadowEvaluation{
		evaluate: func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult {
			evaluations.Add(1)
			return DifficultySemanticShadowResult{
				Status:     DifficultySemanticShadowReady,
				Difficulty: DifficultyResult{Difficulty: DifficultySimple},
			}
		},
	}
	runner := NewDifficultySemanticShadowRunner(
		evaluation,
		time.Second,
		DifficultySemanticShadowObserverFunc(func(DifficultySemanticShadowObservation) {
			panic("sensitive observer detail must not escape")
		}),
	)
	features := ExtractPromptFeatures("safe observer isolation sample")
	if !runner.Submit(features, CategoryGeneral, DifficultySimple) {
		t.Fatal("first observer-isolation job was not accepted")
	}
	waitForDifficultyShadowEvaluationCount(t, &evaluations, 1)
	if !runner.Submit(features, CategoryGeneral, DifficultySimple) {
		t.Fatal("worker stopped after observer panic")
	}
	waitForDifficultyShadowEvaluationCount(t, &evaluations, 2)
	closeDifficultySemanticShadowRunnerForTest(t, runner)
}

func TestDifficultySemanticShadowRunnerCloseTimesOutWithoutBlockingRoutingOwner(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	evaluation := &stubDifficultySemanticShadowEvaluation{
		evaluate: func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult {
			close(entered)
			<-release
			return DifficultySemanticShadowResult{Status: DifficultySemanticShadowInferenceFailed}
		},
	}
	runner := NewDifficultySemanticShadowRunner(evaluation, time.Second, nil)
	if !runner.Submit(ExtractPromptFeatures("safe close-timeout sample"), CategoryGeneral, DifficultySimple) {
		t.Fatal("close-timeout job was not accepted")
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("close-timeout evaluation did not start")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
	err := runner.Close(ctx)
	cancel()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Close() error = %v, want deadline exceeded", err)
	}
	close(release)
	closeDifficultySemanticShadowRunnerForTest(t, runner)
	if evaluation.closed.Load() != 1 {
		t.Fatalf("evaluator Close() calls = %d, want 1", evaluation.closed.Load())
	}
}

func waitForDifficultyShadowEvaluationCount(t *testing.T, count *atomic.Int32, expected int32) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if count.Load() >= expected {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("shadow evaluation count = %d, want at least %d", count.Load(), expected)
}

func waitForDifficultySemanticShadowObservation(
	t *testing.T,
	observations <-chan DifficultySemanticShadowObservation,
) DifficultySemanticShadowObservation {
	t.Helper()
	select {
	case observation := <-observations:
		return observation
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for difficulty shadow observation")
		return DifficultySemanticShadowObservation{}
	}
}

func closeDifficultySemanticShadowRunnerForTest(t *testing.T, runner *DifficultySemanticShadowRunner) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := runner.Close(ctx); err != nil {
		t.Fatalf("shadow runner Close() error = %v", err)
	}
}
