package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
	"gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
)

const (
	testTenantID          = "00000000-0000-4000-8000-000000000100"
	testProjectID         = "00000000-0000-4000-8000-000000000200"
	testApplicationID     = "00000000-0000-4000-8000-000000000300"
	testRoutingPolicyHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
)

func TestProviderLoadsRuntimeSnapshotExecutionView(t *testing.T) {
	ref := testProviderCatalogRef()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/admin/v1/applications/"+testApplicationID+"/runtime-snapshot/active" {
			t.Fatalf("unexpected runtime snapshot path: %s", r.URL.Path)
		}
		writeRuntimeSnapshot(t, w, testRuntimeSnapshotResponse(ref, testApplicationID))
	}))
	defer server.Close()

	provider := NewProvider(server.URL, server.Client())
	snapshot, err := provider.GetExecutionSnapshot(context.Background(), testTenantID, testProjectID, testApplicationID)
	if err != nil {
		t.Fatalf("expected runtime snapshot, got %v", err)
	}

	if snapshot.Snapshot.ProviderCatalogRef != ref {
		t.Fatalf("unexpected provider catalog ref: %+v", snapshot.Snapshot.ProviderCatalogRef)
	}
	if snapshot.BudgetScope.Type != budget.ScopeTypeApplication ||
		snapshot.BudgetScope.ID != testApplicationID ||
		snapshot.BudgetScope.ResolvedBy != budget.ResolvedByDefaultApplication {
		t.Fatalf("unexpected budget scope: %+v", snapshot.BudgetScope)
	}
	if snapshot.CachePolicy.CachePolicyHash != "hash_cache_policy_live" || snapshot.CachePolicy.Type != runtimeconfig.CacheTypeExact {
		t.Fatalf("unexpected cache policy: %+v", snapshot.CachePolicy)
	}
	if !snapshot.BudgetPolicy.Enabled ||
		snapshot.BudgetPolicy.EnforcementMode != budget.EnforcementModeBlock ||
		snapshot.BudgetPolicy.WarningThresholdPercent != 75 {
		t.Fatalf("unexpected budget policy: %+v", snapshot.BudgetPolicy)
	}
	if snapshot.RoutingPolicy.Mode != routing.RoutingPolicyModeAuto || snapshot.RoutingPolicy.BootstrapState != routing.BootstrapStateConfigured {
		t.Fatalf("unexpected routing policy: %+v", snapshot.RoutingPolicy)
	}
	refs := snapshot.RoutingPolicy.Routes.Code.Complex.ModelRefs
	if len(refs) != 2 || refs[0] != "provider-openai:gpt-test-smart" || refs[1] != "provider-openai:gpt-test-low" {
		t.Fatalf("expected ordered model refs to survive snapshot mapping: %+v", snapshot.RoutingPolicy)
	}
	if !snapshot.PromptCapture.Enabled ||
		snapshot.PromptCapture.Mode != runtimeconfig.PromptCaptureModeLogSafeFull ||
		snapshot.PromptCapture.MaxChars != 1200 {
		t.Fatalf("unexpected prompt capture policy: %+v", snapshot.PromptCapture)
	}
	if !snapshot.ResponseCapture.Enabled ||
		snapshot.ResponseCapture.Mode != runtimeconfig.ResponseCaptureModeRawFull ||
		snapshot.ResponseCapture.MaxChars != 1600 {
		t.Fatalf("unexpected response capture policy: %+v", snapshot.ResponseCapture)
	}
}

func TestProviderSendsInternalServiceToken(t *testing.T) {
	const token = "gateway-internal-token-for-test"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get(internalServiceTokenHeader); got != token {
			t.Fatalf("unexpected internal service token header: %q", got)
		}
		writeRuntimeSnapshot(t, w, testRuntimeSnapshotResponse(testProviderCatalogRef(), testApplicationID))
	}))
	defer server.Close()

	provider := NewProvider(server.URL, server.Client(), token)
	if _, err := provider.GetExecutionSnapshot(context.Background(), testTenantID, testProjectID, testApplicationID); err != nil {
		t.Fatalf("expected runtime snapshot, got %v", err)
	}
}

func TestProviderRejectsRuntimeSnapshotLookupKeyMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeRuntimeSnapshot(t, w, testRuntimeSnapshotResponse(testProviderCatalogRef(), "00000000-0000-4000-8000-999999999999"))
	}))
	defer server.Close()

	provider := NewProvider(server.URL, server.Client())
	_, err := provider.GetExecutionSnapshot(context.Background(), testTenantID, testProjectID, testApplicationID)
	if !errors.Is(err, runtimeconfig.ErrScopeMismatch) {
		t.Fatalf("expected scope mismatch, got %v", err)
	}
}

func TestProviderRejectsRuntimeSnapshotV1(t *testing.T) {
	response := testRuntimeSnapshotResponse(testProviderCatalogRef(), testApplicationID)
	response.SchemaVersion = "gatelm.runtime-snapshot.v1"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeRuntimeSnapshot(t, w, response)
	}))
	defer server.Close()

	provider := NewProvider(server.URL, server.Client())
	_, err := provider.GetExecutionSnapshot(context.Background(), testTenantID, testProjectID, testApplicationID)
	if !errors.Is(err, runtimeconfig.ErrUnsupportedSnapshotSchema) {
		t.Fatalf("expected v1 hard cutover rejection, got %v", err)
	}
}

func TestProviderAcceptsMonotonicRuntimeSnapshotVersion(t *testing.T) {
	response := testRuntimeSnapshotResponse(testProviderCatalogRef(), testApplicationID)
	response.RuntimeSnapshotVersion = 17
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeRuntimeSnapshot(t, w, response)
	}))
	defer server.Close()

	provider := NewProvider(server.URL, server.Client())
	snapshot, err := provider.GetExecutionSnapshot(context.Background(), testTenantID, testProjectID, testApplicationID)
	if err != nil {
		t.Fatalf("expected monotonic snapshot version to be accepted, got %v", err)
	}
	if snapshot.Snapshot.RuntimeSnapshotVersion != 17 {
		t.Fatalf("unexpected runtime snapshot version: %d", snapshot.Snapshot.RuntimeSnapshotVersion)
	}
}

func TestProviderRejectsMissingRuntimeSnapshotSchema(t *testing.T) {
	response := testRuntimeSnapshotResponse(testProviderCatalogRef(), testApplicationID)
	response.SchemaVersion = ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeRuntimeSnapshot(t, w, response)
	}))
	defer server.Close()

	provider := NewProvider(server.URL, server.Client())
	_, err := provider.GetExecutionSnapshot(context.Background(), testTenantID, testProjectID, testApplicationID)
	if !errors.Is(err, runtimeconfig.ErrUnsupportedSnapshotSchema) {
		t.Fatalf("expected missing schema rejection, got %v", err)
	}
}

func TestProviderDoesNotRestoreRoutingHashFromLegacyHashes(t *testing.T) {
	response := testRuntimeSnapshotResponse(testProviderCatalogRef(), testApplicationID)
	response.Policies.Routing.RoutingPolicyHash = ""
	response.LegacyHashes.RoutingPolicyHash = "legacy_hash_must_not_be_used"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeRuntimeSnapshot(t, w, response)
	}))
	defer server.Close()

	provider := NewProvider(server.URL, server.Client())
	_, err := provider.GetExecutionSnapshot(context.Background(), testTenantID, testProjectID, testApplicationID)
	if !errors.Is(err, runtimeconfig.ErrMissingRuntimeHash) && !errors.Is(err, runtimeconfig.ErrInvalidRoutingPolicy) {
		t.Fatalf("expected missing active routing hash rejection, got %v", err)
	}
}

func TestProviderRejectsNonCanonicalRoutingPolicyHash(t *testing.T) {
	for _, invalidHash := range []string{
		"hash_routing_policy_live",
		"sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		"sha256:abc",
	} {
		t.Run(invalidHash, func(t *testing.T) {
			response := testRuntimeSnapshotResponse(testProviderCatalogRef(), testApplicationID)
			response.Policies.Routing.RoutingPolicyHash = invalidHash
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				writeRuntimeSnapshot(t, w, response)
			}))
			defer server.Close()

			provider := NewProvider(server.URL, server.Client())
			_, err := provider.GetExecutionSnapshot(context.Background(), testTenantID, testProjectID, testApplicationID)
			if !errors.Is(err, runtimeconfig.ErrInvalidRoutingPolicy) {
				t.Fatalf("expected non-canonical routing hash rejection, got %v", err)
			}
		})
	}
}

func TestProviderRejectsUnknownOrLegacyRoutingFields(t *testing.T) {
	for name, mutate := range map[string]func(map[string]any){
		"extra_category": func(routingPolicy map[string]any) {
			routes := routingPolicy["routes"].(map[string]any)
			routes["unknown"] = routes["general"]
		},
		"extra_difficulty": func(routingPolicy map[string]any) {
			routes := routingPolicy["routes"].(map[string]any)
			general := routes["general"].(map[string]any)
			general["default"] = general["simple"]
		},
		"legacy_tier_field": func(routingPolicy map[string]any) {
			routingPolicy["lowCostModel"] = "legacy-model"
		},
	} {
		t.Run(name, func(t *testing.T) {
			response := testRuntimeSnapshotResponse(testProviderCatalogRef(), testApplicationID)
			payload, err := json.Marshal(response)
			if err != nil {
				t.Fatalf("marshal snapshot: %v", err)
			}
			var body map[string]any
			if err := json.Unmarshal(payload, &body); err != nil {
				t.Fatalf("decode snapshot map: %v", err)
			}
			policies := body["policies"].(map[string]any)
			routingPolicy := policies["routing"].(map[string]any)
			mutate(routingPolicy)

			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if err := json.NewEncoder(w).Encode(body); err != nil {
					t.Fatalf("encode mutated snapshot: %v", err)
				}
			}))
			defer server.Close()

			provider := NewProvider(server.URL, server.Client())
			if _, err := provider.GetExecutionSnapshot(context.Background(), testTenantID, testProjectID, testApplicationID); err == nil {
				t.Fatal("expected strict routing snapshot rejection")
			}
		})
	}
}

func TestProviderRejectsIncompleteRoutingMatrix(t *testing.T) {
	response := testRuntimeSnapshotResponse(testProviderCatalogRef(), testApplicationID)
	response.Policies.Routing.Routes.Reasoning.Complex.ModelRefs = nil
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeRuntimeSnapshot(t, w, response)
	}))
	defer server.Close()

	provider := NewProvider(server.URL, server.Client())
	_, err := provider.GetExecutionSnapshot(context.Background(), testTenantID, testProjectID, testApplicationID)
	if !errors.Is(err, runtimeconfig.ErrInvalidRoutingPolicy) {
		t.Fatalf("expected incomplete 5x2 matrix rejection, got %v", err)
	}
}

func TestProviderUsesLastKnownSnapshotOnlyForTransientFailures(t *testing.T) {
	ref := testProviderCatalogRef()
	status := http.StatusOK
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if status != http.StatusOK {
			http.Error(w, "temporarily unavailable", status)
			return
		}
		writeRuntimeSnapshot(t, w, testRuntimeSnapshotResponse(ref, testApplicationID))
	}))
	defer server.Close()

	provider := NewProvider(server.URL, server.Client())
	if _, err := provider.GetExecutionSnapshot(context.Background(), testTenantID, testProjectID, testApplicationID); err != nil {
		t.Fatalf("prime last-known snapshot: %v", err)
	}

	status = http.StatusServiceUnavailable
	snapshot, err := provider.GetExecutionSnapshot(context.Background(), testTenantID, testProjectID, testApplicationID)
	if err != nil {
		t.Fatalf("expected last-known snapshot on transient failure, got %v", err)
	}
	if snapshot.Snapshot.RuntimeState != runtimeconfig.RuntimeStateLastKnownSafeUsed {
		t.Fatalf("expected last-known runtime state, got %s", snapshot.Snapshot.RuntimeState)
	}

	status = http.StatusNotFound
	if _, err := provider.GetExecutionSnapshot(context.Background(), testTenantID, testProjectID, testApplicationID); err == nil {
		t.Fatal("expected not found to fail without last-known fallback")
	}
}

func writeRuntimeSnapshot(t *testing.T, w http.ResponseWriter, response runtimeSnapshotResponse) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		t.Fatalf("encode runtime snapshot response: %v", err)
	}
}

func testProviderCatalogRef() providercatalog.Reference {
	return providercatalog.Reference{
		CatalogID:      "provider_catalog:" + testApplicationID + ":1",
		CatalogVersion: 1,
		ContentHash:    "sha256:provider-catalog-live-test",
	}
}

func testRuntimeSnapshotResponse(ref providercatalog.Reference, applicationID string) runtimeSnapshotResponse {
	return runtimeSnapshotResponse{
		SchemaVersion:          runtimeSnapshotSchemaV2,
		RuntimeSnapshotID:      "runtime_snapshot_live_test",
		RuntimeSnapshotVersion: 2,
		ContentHash:            "hash_runtime_snapshot_live",
		RuntimeState:           runtimeconfig.RuntimeStateSnapshotActive,
		PublishedAt:            time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC),
		PublishedBy:            "control_plane_test",
		GatewayInstanceID:      "gateway_core_test",
		LookupKey: runtimeSnapshotLookupKey{
			TenantID:      testTenantID,
			ProjectID:     testProjectID,
			ApplicationID: applicationID,
		},
		BudgetResolution: runtimeSnapshotBudget{
			BudgetScopeType: budget.ScopeTypeApplication,
			BudgetScopeID:   applicationID,
			ResolvedBy:      budget.ResolvedByDefaultApplication,
		},
		ProviderCatalogRef: ref,
		Policies: runtimeSnapshotPolicies{
			Safety: runtimeSnapshotSafetyPolicy{
				PolicyHash: "hash_security_policy_live",
			},
			Routing: runtimeSnapshotRoutingPolicy{
				Mode:              routing.RoutingPolicyModeAuto,
				BootstrapState:    routing.BootstrapStateConfigured,
				Routes:            testRoutingMatrix(),
				RoutingPolicyHash: testRoutingPolicyHash,
			},
			Cache: runtimeSnapshotCachePolicy{
				ExactCacheEnabled: true,
				CachePolicyHash:   "hash_cache_policy_live",
			},
			PromptCapture: runtimeSnapshotPromptCapturePolicy{
				Enabled:  true,
				Mode:     runtimeconfig.PromptCaptureModeLogSafeFull,
				MaxChars: 1200,
			},
			ResponseCapture: runtimeSnapshotResponseCapturePolicy{
				Enabled:  true,
				Mode:     runtimeconfig.ResponseCaptureModeRawFull,
				MaxChars: 1600,
			},
			RateLimit: runtimeSnapshotRateLimitPolicy{
				Enabled:       true,
				Scope:         "application",
				WindowSeconds: 60,
				Limit:         10,
			},
			Budget: runtimeSnapshotBudgetPolicy{
				Enabled:                 true,
				EnforcementMode:         budget.EnforcementModeBlock,
				WarningThresholdPercent: 75,
			},
		},
		LegacyHashes: runtimeconfig.LegacyHashes{
			ConfigHash:         "hash_runtime_snapshot_live",
			SecurityPolicyHash: "hash_security_policy_live",
			RoutingPolicyHash:  "hash_routing_policy_live",
		},
	}
}

func testRoutingMatrix() routing.RoutingMatrix {
	cell := func(ref string) routing.RouteCell { return routing.RouteCell{ModelRefs: []string{ref}} }
	difficulties := routing.DifficultyRoutes{Simple: cell("provider-openai:gpt-test-low"), Complex: cell("provider-openai:gpt-test-low")}
	matrix := routing.RoutingMatrix{
		General: difficulties, Code: difficulties, Translation: difficulties,
		Summarization: difficulties, Reasoning: difficulties,
	}
	matrix.Code.Complex.ModelRefs = []string{"provider-openai:gpt-test-smart", "provider-openai:gpt-test-low"}
	return matrix
}
