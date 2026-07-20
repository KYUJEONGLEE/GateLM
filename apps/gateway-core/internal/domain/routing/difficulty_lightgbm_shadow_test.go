package routing

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestDifficultyLightGBMShadowComparisonUsesAuthoritativeEnums(t *testing.T) {
	if got := DifficultyLightGBMShadowComparison(DifficultySimple, DifficultyComplex); got != DifficultySemanticShadowComparisonAuthoritativeSimpleShadowComplex {
		t.Fatalf("simple/complex comparison = %q", got)
	}
	if got := DifficultyLightGBMShadowComparison(DifficultyComplex, DifficultySimple); got != DifficultySemanticShadowComparisonAuthoritativeComplexShadowSimple {
		t.Fatalf("complex/simple comparison = %q", got)
	}
	if got := DifficultyLightGBMShadowComparison(DifficultyComplex, DifficultyComplex); got != DifficultySemanticShadowComparisonMatch {
		t.Fatalf("matching comparison = %q", got)
	}
}

func TestLightGBMShadowIsSkippedWhenLRIsNotReady(t *testing.T) {
	var shadowCalls atomic.Int32
	lrRuntime := NewDifficultySemanticRuntime(
		difficultySemanticRuntimeEvaluatorFunc(func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult {
			return DifficultySemanticShadowResult{Status: DifficultySemanticShadowUnavailable}
		}),
		50*time.Millisecond,
	)
	lightGBMEvaluation := &stubDifficultySemanticShadowEvaluation{
		evaluate: func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult {
			shadowCalls.Add(1)
			return DifficultySemanticShadowResult{
				Status:     DifficultySemanticShadowReady,
				Difficulty: DifficultyResult{Difficulty: DifficultyComplex},
			}
		},
	}
	lightGBMRunner := NewDifficultySemanticShadowRunner(
		lightGBMEvaluation,
		100*time.Millisecond,
		nil,
		WithDifficultySemanticShadowComparison(DifficultyLightGBMShadowComparison),
	)
	t.Cleanup(func() {
		_ = lrRuntime.Close(context.Background())
		closeDifficultySemanticShadowRunnerForTest(t, lightGBMRunner)
	})

	router := NewSimpleRouter(
		validV2RouterConfig(RoutingPolicyModeAuto),
		WithDifficultySemanticRuntime(lrRuntime),
		WithDifficultyLightGBMShadow(lightGBMRunner),
	)
	decision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel:                   "auto",
		PromptText:                       "Explain OAuth briefly.",
		DifficultyLightGBMShadowEligible: true,
	})
	if err != nil {
		t.Fatalf("DecideRoute() error = %v", err)
	}
	if decision.RoutingDecisionMaterial.Difficulty != DifficultySimple {
		t.Fatalf("rule fallback was not retained: %+v", decision)
	}
	time.Sleep(20 * time.Millisecond)
	if shadowCalls.Load() != 0 {
		t.Fatalf("LightGBM shadow ran without a ready LR result: calls=%d", shadowCalls.Load())
	}
}

func TestLightGBMShadowCannotChangeAuthoritativeLRRoute(t *testing.T) {
	observations := make(chan DifficultySemanticShadowObservation, 1)
	lrRuntime := NewDifficultySemanticRuntime(
		difficultySemanticRuntimeEvaluatorFunc(func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult {
			return DifficultySemanticShadowResult{
				Status:     DifficultySemanticShadowReady,
				Difficulty: DifficultyResult{Difficulty: DifficultyComplex},
			}
		}),
		50*time.Millisecond,
	)
	lightGBMEvaluation := &stubDifficultySemanticShadowEvaluation{
		evaluate: func(context.Context, PromptFeatures, string) DifficultySemanticShadowResult {
			return DifficultySemanticShadowResult{
				Status:     DifficultySemanticShadowReady,
				Difficulty: DifficultyResult{Difficulty: DifficultySimple},
			}
		},
	}
	lightGBMRunner := NewDifficultySemanticShadowRunner(
		lightGBMEvaluation,
		100*time.Millisecond,
		DifficultySemanticShadowObserverFunc(func(observation DifficultySemanticShadowObservation) {
			observations <- observation
		}),
		WithDifficultySemanticShadowComparison(DifficultyLightGBMShadowComparison),
	)
	t.Cleanup(func() {
		_ = lrRuntime.Close(context.Background())
		closeDifficultySemanticShadowRunnerForTest(t, lightGBMRunner)
	})

	router := NewSimpleRouter(
		validV2RouterConfig(RoutingPolicyModeAuto),
		WithDifficultySemanticRuntime(lrRuntime),
		WithDifficultyLightGBMShadow(lightGBMRunner),
	)
	decision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel:                   "auto",
		PromptText:                       "Explain OAuth briefly.",
		DifficultyLightGBMShadowEligible: true,
	})
	if err != nil {
		t.Fatalf("DecideRoute() error = %v", err)
	}
	if decision.RoutingDecisionMaterial.Difficulty != DifficultyComplex || decision.ModelRef != "model-general-complex" {
		t.Fatalf("LightGBM shadow changed authoritative LR route: %+v", decision)
	}

	observation := waitForDifficultySemanticShadowObservation(t, observations)
	if observation.Status != DifficultySemanticShadowReady ||
		observation.Comparison != DifficultySemanticShadowComparisonAuthoritativeComplexShadowSimple {
		t.Fatalf("unexpected LightGBM shadow observation: %+v", observation)
	}
}
