package routing

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

type difficultySemanticRuntimeEvaluatorFunc func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult

func (evaluate difficultySemanticRuntimeEvaluatorFunc) Evaluate(
	ctx context.Context,
	features PromptFeatures,
	category string,
) DifficultySemanticShadowResult {
	return evaluate(ctx, features, category)
}

func (difficultySemanticRuntimeEvaluatorFunc) Close() error { return nil }

func TestDifficultySemanticRuntimeReturnsReadyResult(t *testing.T) {
	t.Parallel()
	runtime := NewDifficultySemanticRuntime(
		difficultySemanticRuntimeEvaluatorFunc(func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult {
			return DifficultySemanticShadowResult{
				Status:     DifficultySemanticShadowReady,
				Difficulty: DifficultyResult{Difficulty: DifficultyComplex},
			}
		}),
		50*time.Millisecond,
	)
	t.Cleanup(func() { _ = runtime.Close(context.Background()) })

	result := runtime.Classify(context.Background(), ExtractPromptFeatures("Explain one workflow."), CategoryGeneral)
	if result.Status != DifficultySemanticShadowReady || result.Difficulty.Difficulty != DifficultyComplex {
		t.Fatalf("Classify() = %#v", result)
	}
}

func TestDifficultySemanticRuntimeBoundsTimeout(t *testing.T) {
	t.Parallel()
	runtime := NewDifficultySemanticRuntime(
		difficultySemanticRuntimeEvaluatorFunc(func(ctx context.Context, _ PromptFeatures, _ string) DifficultySemanticShadowResult {
			<-ctx.Done()
			return DifficultySemanticShadowResult{Status: DifficultySemanticShadowTimeout}
		}),
		10*time.Millisecond,
	)
	t.Cleanup(func() { _ = runtime.Close(context.Background()) })

	startedAt := time.Now()
	result := runtime.Classify(context.Background(), ExtractPromptFeatures("Explain one workflow."), CategoryGeneral)
	if result.Status != DifficultySemanticShadowTimeout {
		t.Fatalf("Classify() status = %q, want timeout", result.Status)
	}
	if elapsed := time.Since(startedAt); elapsed > 100*time.Millisecond {
		t.Fatalf("Classify() took %s, want bounded timeout", elapsed)
	}
}

func TestDifficultySemanticRuntimeRejectsWhenQueueIsFull(t *testing.T) {
	release := make(chan struct{})
	started := make(chan struct{}, 1)
	runtime := NewDifficultySemanticRuntime(
		difficultySemanticRuntimeEvaluatorFunc(func(ctx context.Context, _ PromptFeatures, _ string) DifficultySemanticShadowResult {
			select {
			case started <- struct{}{}:
			default:
			}
			select {
			case <-release:
				return DifficultySemanticShadowResult{Status: DifficultySemanticShadowReady, Difficulty: DifficultyResult{Difficulty: DifficultySimple}}
			case <-ctx.Done():
				return DifficultySemanticShadowResult{Status: DifficultySemanticShadowTimeout}
			}
		}),
		time.Second,
	)
	t.Cleanup(func() {
		close(release)
		_ = runtime.Close(context.Background())
	})

	results := make(chan DifficultySemanticShadowResult, defaultDifficultySemanticRuntimeQueueSize+1)
	go func() {
		results <- runtime.Classify(context.Background(), PromptFeatures{}, CategoryGeneral)
	}()
	<-started
	for index := 0; index < defaultDifficultySemanticRuntimeQueueSize; index++ {
		go func() {
			results <- runtime.Classify(context.Background(), PromptFeatures{}, CategoryGeneral)
		}()
	}
	deadline := time.Now().Add(time.Second)
	for len(runtime.jobs) != defaultDifficultySemanticRuntimeQueueSize && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	result := runtime.Classify(context.Background(), PromptFeatures{}, CategoryGeneral)
	if result.Status != DifficultySemanticShadowBusy {
		t.Fatalf("Classify() status = %q, want busy", result.Status)
	}
}

func TestSimpleRouterUsesSemanticDifficultyForAutoRoute(t *testing.T) {
	t.Parallel()
	config := validV2RouterConfig(RoutingPolicyModeAuto)
	runtime := NewDifficultySemanticRuntime(
		difficultySemanticRuntimeEvaluatorFunc(func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult {
			return DifficultySemanticShadowResult{
				Status:     DifficultySemanticShadowReady,
				Difficulty: DifficultyResult{Difficulty: DifficultyComplex},
			}
		}),
		50*time.Millisecond,
	)
	t.Cleanup(func() { _ = runtime.Close(context.Background()) })
	router := NewSimpleRouter(config, WithDifficultySemanticRuntime(runtime))

	decision, err := router.DecideRoute(context.Background(), Request{RequestedModel: "auto", PromptText: "Explain OAuth briefly."})
	if err != nil {
		t.Fatalf("DecideRoute() error = %v", err)
	}
	if decision.ModelRef != "model-general-complex" || decision.RoutingDecisionMaterial.Difficulty != DifficultyComplex {
		t.Fatalf("semantic difficulty was not authoritative: %#v", decision)
	}
}

func TestSimpleRouterFallsBackToRuleDifficultyWhenSemanticRuntimeIsNotReady(t *testing.T) {
	t.Parallel()
	config := validV2RouterConfig(RoutingPolicyModeAuto)
	runtime := NewDifficultySemanticRuntime(
		difficultySemanticRuntimeEvaluatorFunc(func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult {
			return DifficultySemanticShadowResult{Status: DifficultySemanticShadowInferenceFailed}
		}),
		50*time.Millisecond,
	)
	t.Cleanup(func() { _ = runtime.Close(context.Background()) })
	router := NewSimpleRouter(config, WithDifficultySemanticRuntime(runtime))

	decision, err := router.DecideRoute(context.Background(), Request{RequestedModel: "auto", PromptText: "Explain OAuth briefly."})
	if err != nil {
		t.Fatalf("DecideRoute() error = %v", err)
	}
	if decision.ModelRef != "model-general-simple" || decision.RoutingDecisionMaterial.Difficulty != DifficultySimple {
		t.Fatalf("rule fallback was not retained: %#v", decision)
	}
}

func TestSimpleRouterDoesNotRunSemanticRuntimeForManualRoute(t *testing.T) {
	t.Parallel()
	var evaluations atomic.Int32
	runtime := NewDifficultySemanticRuntime(
		difficultySemanticRuntimeEvaluatorFunc(func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult {
			evaluations.Add(1)
			return DifficultySemanticShadowResult{Status: DifficultySemanticShadowReady, Difficulty: DifficultyResult{Difficulty: DifficultyComplex}}
		}),
		50*time.Millisecond,
	)
	t.Cleanup(func() { _ = runtime.Close(context.Background()) })
	router := NewSimpleRouter(validV2RouterConfig(RoutingPolicyModeAuto), WithDifficultySemanticRuntime(runtime))

	decision, err := router.DecideRoute(context.Background(), Request{RequestedModel: "manual-model", PromptText: "Explain OAuth briefly."})
	if err != nil {
		t.Fatalf("DecideRoute() error = %v", err)
	}
	if decision.ModelRef != "manual-model" || evaluations.Load() != 0 {
		t.Fatalf("manual route invoked semantic runtime: decision=%#v evaluations=%d", decision, evaluations.Load())
	}
}

func TestSimpleRouterDoesNotQueueSemanticRuntimeForNonModelPath(t *testing.T) {
	t.Parallel()
	var evaluations atomic.Int32
	runtime := NewDifficultySemanticRuntime(
		difficultySemanticRuntimeEvaluatorFunc(func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult {
			evaluations.Add(1)
			return DifficultySemanticShadowResult{Status: DifficultySemanticShadowReady, Difficulty: DifficultyResult{Difficulty: DifficultyComplex}}
		}),
		50*time.Millisecond,
	)
	t.Cleanup(func() { _ = runtime.Close(context.Background()) })
	router := NewSimpleRouter(validV2RouterConfig(RoutingPolicyModeAuto), WithDifficultySemanticRuntime(runtime))

	decision, err := router.DecideRoute(context.Background(), Request{RequestedModel: "auto", PromptText: ""})
	if err != nil {
		t.Fatalf("DecideRoute() error = %v", err)
	}
	if evaluations.Load() != 0 || decision.RoutingDecisionMaterial.Difficulty != DifficultySimple {
		t.Fatalf("non-model-path route invoked semantic runtime: decision=%#v evaluations=%d", decision, evaluations.Load())
	}
}
