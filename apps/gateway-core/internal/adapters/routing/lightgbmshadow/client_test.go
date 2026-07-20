package lightgbmshadow

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	routingdomain "gatelm/apps/gateway-core/internal/domain/routing"
)

const (
	testModelVersion = "difficulty-lightgbm-shadow.unit.v1"
	testModelHash    = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
)

func TestClientUsesOnlyCanonicalInstructionAndExactRuleVector(t *testing.T) {
	var captured classifyRequest
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get(ServiceTokenHeader) != "unit-token" {
			t.Fatal("missing dedicated service token")
		}
		if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
			t.Fatal(err)
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(classifyResponse{
			ContractVersion:  ContractVersion,
			Status:           routingdomain.DifficultySemanticShadowReady,
			Difficulty:       routingdomain.DifficultyComplex,
			ModelVersion:     testModelVersion,
			ModelContentHash: testModelHash,
		})
	}))
	defer server.Close()

	client, err := NewClient(Config{
		EndpointURL:      server.URL,
		ServiceToken:     "unit-token",
		ModelVersion:     testModelVersion,
		ModelContentHash: testModelHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	features := routingdomain.ExtractPromptFeatures("Explain one bounded workflow step.")
	category := routingdomain.NewRuleBasedCategoryClassifier().ClassifyFeatures(features).Category
	result := client.Evaluate(context.Background(), features, category)
	if result.Status != routingdomain.DifficultySemanticShadowReady ||
		result.Difficulty.Difficulty != routingdomain.DifficultyComplex {
		t.Fatalf("unexpected result: %#v", result)
	}
	if captured.InstructionText == "" || len(captured.RuleVector) != 42 ||
		captured.ModelVersion != testModelVersion || captured.ModelContentHash != testModelHash {
		t.Fatalf("unexpected request contract: %#v", captured)
	}
}

func TestClientRejectsResponseIdentityDrift(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"contractVersion":"` + ContractVersion + `","status":"ready","difficulty":"simple","modelVersion":"drifted","modelContentHash":"` + testModelHash + `"}`))
	}))
	defer server.Close()
	client, err := NewClient(Config{
		EndpointURL:      server.URL,
		ServiceToken:     "unit-token",
		ModelVersion:     testModelVersion,
		ModelContentHash: testModelHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	features := routingdomain.ExtractPromptFeatures("Explain one bounded workflow step.")
	result := client.Evaluate(context.Background(), features, routingdomain.CategoryGeneral)
	if result.Status != routingdomain.DifficultySemanticShadowInferenceFailed {
		t.Fatalf("identity drift status = %q", result.Status)
	}
}

func TestClientErrorsDoNotContainRequestText(t *testing.T) {
	_, err := NewClient(Config{
		EndpointURL:      "not a url",
		ServiceToken:     "private-token",
		ModelVersion:     "secret prompt fragment",
		ModelContentHash: testModelHash,
	})
	if err == nil || strings.Contains(err.Error(), "secret prompt fragment") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestClientRejectsOversizedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(strings.Repeat("x", maximumResponseBytes+1)))
	}))
	defer server.Close()
	client, err := NewClient(Config{
		EndpointURL:      server.URL,
		ServiceToken:     "unit-token",
		ModelVersion:     testModelVersion,
		ModelContentHash: testModelHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	features := routingdomain.ExtractPromptFeatures("Explain one bounded workflow step.")
	result := client.Evaluate(context.Background(), features, routingdomain.CategoryGeneral)
	if result.Status != routingdomain.DifficultySemanticShadowInferenceFailed {
		t.Fatalf("oversized response status = %q", result.Status)
	}
}
