//go:build difficulty_e5_onnx && linux && cgo

package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/adapters/routing/e5onnx"
	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/routing"
)

func TestBaselineWaiverNativeRequestShadowE2E(t *testing.T) {
	bundleRoot := os.Getenv("GATELM_E5_INTEGRATION_BUNDLE_ROOT")
	if bundleRoot == "" {
		t.Skip("native E5 integration bundle is not configured")
	}

	observations := make(chan routing.DifficultySemanticShadowObservation, 1)
	startupCtx, startupCancel := context.WithTimeout(context.Background(), difficultyE5StartupSmokeTimeout)
	defer startupCancel()
	runner, status := initializeDifficultyE5ShadowRunner(
		startupCtx,
		config.DifficultyE5ShadowConfig{
			Enabled: true,
			AllowedScopes: []config.DifficultyE5ShadowScope{{
				TenantID: "tenant_smoke", ApplicationID: "application_smoke",
			}},
			BaselineWaiver:      routing.DifficultySemanticShadowBaselineE2EWaiverV3,
			ArtifactRoot:        bundleRoot,
			EncoderManifestPath: filepath.Join(bundleRoot, "difficulty-e5-encoder-manifest.v2.json"),
			RuntimeLockPath:     filepath.Join(bundleRoot, "difficulty-e5-gateway-runtime-lock.linux-amd64.v2.json"),
			Timeout:             100 * time.Millisecond,
		},
		e5onnx.NewEncoder,
		routing.DifficultySemanticShadowObserverFunc(func(observation routing.DifficultySemanticShadowObservation) {
			observations <- observation
		}),
	)
	if status != DifficultyE5ShadowRuntimeReady || runner == nil {
		t.Fatalf("baseline waiver native runner status = %q", status)
	}
	t.Cleanup(func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := runner.Close(closeCtx); err != nil {
			t.Errorf("close native shadow runner: %v", err)
		}
	})

	simpleCell := routing.RouteCell{ModelRefs: []string{"rule-simple"}}
	complexCell := routing.RouteCell{ModelRefs: []string{"rule-complex"}}
	routes := routing.DifficultyRoutes{Simple: simpleCell, Complex: complexCell}
	routerConfig := routing.SimpleRouterConfig{
		Mode:       routing.RoutingPolicyModeAuto,
		PolicyHash: routing.DefaultPolicyHash,
		Routes: routing.RoutingMatrix{
			General: routes, Code: routes, Translation: routes,
			Summarization: routes, Reasoning: routes,
		},
	}
	request := routing.Request{
		RequestedModel:           "auto",
		PromptText:               "Explain OAuth briefly.",
		DifficultyShadowEligible: true,
	}
	ruleDecision, err := routing.NewSimpleRouter(routerConfig).DecideRoute(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	shadowDecision, err := routing.NewSimpleRouter(
		routerConfig,
		routing.WithDifficultySemanticShadow(runner),
	).DecideRoute(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if shadowDecision.ModelRef != ruleDecision.ModelRef ||
		shadowDecision.RoutingDecisionMaterial.Difficulty != ruleDecision.RoutingDecisionMaterial.Difficulty ||
		shadowDecision.RoutingDecisionKeyHash != ruleDecision.RoutingDecisionKeyHash {
		t.Fatalf("authoritative route changed while baseline shadow was enabled")
	}

	select {
	case observation := <-observations:
		if observation.Status != routing.DifficultySemanticShadowReady ||
			observation.Comparison == routing.DifficultySemanticShadowComparisonNotCompared {
			t.Fatalf("native baseline shadow observation was not comparable: status=%q comparison=%q", observation.Status, observation.Comparison)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("native baseline shadow observation timed out")
	}
}
