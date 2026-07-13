package providercatalog

import "testing"

func TestFirstFallbackProviderSkipsExcludedPrimaryCandidate(t *testing.T) {
	catalog := Catalog{
		Providers: []Provider{
			{
				ProviderID:       "provider_primary",
				ProviderName:     "openai-main",
				Enabled:          true,
				FallbackEligible: true,
				Models:           []Model{enabledFallbackModel("model_primary", 0)},
			},
			{
				ProviderID:       "provider_mock",
				ProviderName:     "mock-fallback",
				Enabled:          true,
				FallbackEligible: true,
				Models:           []Model{enabledFallbackModel("model_mock", 10)},
			},
		},
	}

	provider, model, err := catalog.FirstFallbackProvider("openai-main", "model_primary")
	if err != nil {
		t.Fatalf("expected fallback provider: %v", err)
	}
	if provider.ProviderName != "mock-fallback" || model.ModelID != "model_mock" {
		t.Fatalf("expected mock fallback, got provider=%s model=%s", provider.ProviderName, model.ModelID)
	}
}

func TestCatalogNormalizeConvertsNilProviderModelsToEmptySlice(t *testing.T) {
	catalog := Catalog{
		Providers: []Provider{
			{
				ProviderID: "provider_without_models",
				Models:     nil,
			},
		},
	}

	normalized := catalog.Normalize()
	if normalized.Providers[0].Models == nil {
		t.Fatal("expected nil models to normalize to an empty slice")
	}
	if len(normalized.Providers[0].Models) != 0 {
		t.Fatalf("expected empty models slice, got %d models", len(normalized.Providers[0].Models))
	}
}

func TestCatalogResolveModelRefTreatsReferenceAsOpaque(t *testing.T) {
	t.Parallel()
	catalog := Catalog{Providers: []Provider{
		{ProviderID: "provider-a", ProviderName: "provider-a-name", Enabled: true, Models: []Model{{ModelID: "catalog-model-a", ModelRef: "opaque:ref:with:colons", ModelName: "actual-model", Enabled: true}}},
		{ProviderID: "provider-mock", ProviderName: "mock", Enabled: true, Models: []Model{{ModelID: "mock-balanced", ModelName: "mock-balanced", Enabled: true}}},
	}}

	provider, model, err := catalog.ResolveModelRef("opaque:ref:with:colons")
	if err != nil {
		t.Fatalf("ResolveModelRef() error = %v", err)
	}
	if provider.ProviderID != "provider-a" || model.ModelName != "actual-model" {
		t.Fatalf("unexpected resolved target: provider=%#v model=%#v", provider, model)
	}
	if model.ModelID != "catalog-model-a" || model.ModelRef != "opaque:ref:with:colons" {
		t.Fatalf("model identity and opaque ref must remain distinct: %#v", model)
	}

	provider, model, err = catalog.ResolveModelRef("mock-balanced")
	if err != nil {
		t.Fatalf("ResolveModelRef(mock bootstrap) error = %v", err)
	}
	if provider.ProviderName != "mock" || model.ModelID != "mock-balanced" {
		t.Fatalf("unexpected mock bootstrap target: provider=%#v model=%#v", provider, model)
	}
}

func enabledFallbackModel(modelID string, priority int) Model {
	return Model{
		ModelID:   modelID,
		ModelName: modelID + "-name",
		Enabled:   true,
		Routing: ModelRouting{
			FallbackPriority: priority,
		},
	}
}
