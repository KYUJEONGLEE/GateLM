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
