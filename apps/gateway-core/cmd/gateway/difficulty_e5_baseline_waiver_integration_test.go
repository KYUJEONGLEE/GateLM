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

func TestNativeRequestRuntimeE2E(t *testing.T) {
	bundleRoot := os.Getenv("GATELM_E5_INTEGRATION_BUNDLE_ROOT")
	if bundleRoot == "" {
		t.Skip("native E5 integration bundle is not configured")
	}

	startupCtx, startupCancel := context.WithTimeout(context.Background(), difficultyE5StartupSmokeTimeout)
	defer startupCancel()
	runtime, status := initializeDifficultyE5Runtime(
		startupCtx,
		config.DifficultyE5RuntimeConfig{
			Enabled:             true,
			ArtifactRoot:        bundleRoot,
			EncoderManifestPath: filepath.Join(bundleRoot, "difficulty-e5-encoder-manifest.v2.json"),
			RuntimeLockPath:     filepath.Join(bundleRoot, "difficulty-e5-gateway-runtime-lock.linux-amd64.v2.json"),
			Timeout:             100 * time.Millisecond,
		},
		e5onnx.NewEncoder,
	)
	if status != DifficultyE5HotPathRuntimeReady || runtime == nil {
		t.Fatalf("native hot-path runtime status = %q", status)
	}
	t.Cleanup(func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := runtime.Close(closeCtx); err != nil {
			t.Errorf("close native hot-path runtime: %v", err)
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
		RequestedModel: "auto",
		PromptText:     "Explain OAuth briefly.",
	}
	runtimeDecision, err := routing.NewSimpleRouter(
		routerConfig,
		routing.WithDifficultySemanticRuntime(runtime),
	).DecideRoute(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	expectedModelRef := "rule-simple"
	if runtimeDecision.RoutingDecisionMaterial.Difficulty == routing.DifficultyComplex {
		expectedModelRef = "rule-complex"
	}
	if runtimeDecision.ModelRef != expectedModelRef {
		t.Fatalf("native semantic difficulty did not select its authoritative matrix cell: %#v", runtimeDecision)
	}
}
