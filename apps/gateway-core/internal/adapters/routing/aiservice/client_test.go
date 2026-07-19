package aiservice

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	routingdomain "gatelm/apps/gateway-core/internal/domain/routing"
)

func TestClassifierSendsBoundedPinnedRequestAndAcceptsReadyDecision(t *testing.T) {
	var captured classifyRequest
	var capturedToken string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		capturedToken = request.Header.Get(ServiceTokenHeader)
		if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
			t.Error(err)
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(classifyResponse{
			ContractVersion:  ContractVersion,
			Status:           routingdomain.DifficultySemanticShadowReady,
			Difficulty:       routingdomain.DifficultySimple,
			ModelVersion:     ModelVersion,
			ModelContentHash: ModelContentHash,
		})
	}))
	defer server.Close()

	classifier := newTestClassifier(t, server.URL, 100*time.Millisecond, 4)
	result := classifier.Classify(
		context.Background(),
		routingdomain.ExtractPromptFeatures("Explain OAuth briefly."),
		routingdomain.CategoryGeneral,
	)

	if result.Status != routingdomain.DifficultySemanticShadowReady || result.Difficulty.Difficulty != routingdomain.DifficultySimple {
		t.Fatalf("result=%+v, want ready simple", result)
	}
	if capturedToken != "unit-routing-token" || captured.ContractVersion != ContractVersion ||
		captured.ModelContentHash != ModelContentHash || captured.RuleVectorVersion != RuleVectorVersion {
		t.Fatalf("remote request identity drifted: token=%q request=%+v", capturedToken, captured)
	}
	if captured.InstructionText != "explain oauth briefly." || len(captured.RuleVector) != routingdomain.DifficultyFeatureVectorDimensionV1 {
		t.Fatalf("remote request boundary drifted: instruction=%q vector=%d", captured.InstructionText, len(captured.RuleVector))
	}
}

func TestClassifierRejectsUnpinnedResponseWithoutAProductDecision(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"contractVersion":"gatelm.internal.routing-difficulty-inference.v1","status":"ready","difficulty":"complex","modelVersion":"drifted","modelContentHash":"sha256:drifted"}`))
	}))
	defer server.Close()

	classifier := newTestClassifier(t, server.URL, 100*time.Millisecond, 4)
	result := classifier.Classify(
		context.Background(),
		routingdomain.ExtractPromptFeatures("Explain OAuth briefly."),
		routingdomain.CategoryGeneral,
	)

	if result.Status != routingdomain.DifficultySemanticShadowInferenceFailed || result.Difficulty.Difficulty != "" {
		t.Fatalf("result=%+v, want sanitized inference failure", result)
	}
}

func TestClassifierTimesOutAndFallsBackWithoutReturningRemoteMaterial(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		time.Sleep(40 * time.Millisecond)
		writer.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	classifier := newTestClassifier(t, server.URL, 5*time.Millisecond, 4)
	result := classifier.Classify(
		context.Background(),
		routingdomain.ExtractPromptFeatures("Explain OAuth briefly."),
		routingdomain.CategoryGeneral,
	)

	if result.Status != routingdomain.DifficultySemanticShadowTimeout || result.Difficulty.Difficulty != "" {
		t.Fatalf("result=%+v, want timeout without product decision", result)
	}
}

func TestClassifierRejectsConcurrentCallsAboveBoundAsBusy(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		once.Do(func() { close(entered) })
		<-release
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(classifyResponse{
			ContractVersion:  ContractVersion,
			Status:           routingdomain.DifficultySemanticShadowReady,
			Difficulty:       routingdomain.DifficultySimple,
			ModelVersion:     ModelVersion,
			ModelContentHash: ModelContentHash,
		})
	}))
	defer server.Close()

	classifier := newTestClassifier(t, server.URL, time.Second, 1)
	firstDone := make(chan routingdomain.DifficultySemanticShadowResult, 1)
	go func() {
		firstDone <- classifier.Classify(
			context.Background(),
			routingdomain.ExtractPromptFeatures("Explain OAuth briefly."),
			routingdomain.CategoryGeneral,
		)
	}()
	<-entered
	second := classifier.Classify(
		context.Background(),
		routingdomain.ExtractPromptFeatures("Explain OAuth briefly."),
		routingdomain.CategoryGeneral,
	)
	if second.Status != routingdomain.DifficultySemanticShadowBusy {
		t.Fatalf("second=%+v, want busy", second)
	}
	close(release)
	if first := <-firstDone; first.Status != routingdomain.DifficultySemanticShadowReady {
		t.Fatalf("first=%+v, want ready", first)
	}
}

func TestClassifierDoesNotCallRemoteForInapplicableInput(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls++ }))
	defer server.Close()
	classifier := newTestClassifier(t, server.URL, 100*time.Millisecond, 4)

	result := classifier.Classify(
		context.Background(),
		routingdomain.ExtractPromptFeatures(""),
		routingdomain.CategoryGeneral,
	)
	if result.Status != routingdomain.DifficultySemanticShadowNotApplicable || calls != 0 {
		t.Fatalf("result=%+v calls=%d, want local not_applicable", result, calls)
	}
}

func TestClassifierObserverReceivesOnlyBoundedOutcomeAndCannotBreakRouting(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(classifyResponse{
			ContractVersion:  ContractVersion,
			Status:           routingdomain.DifficultySemanticShadowReady,
			Difficulty:       routingdomain.DifficultySimple,
			ModelVersion:     ModelVersion,
			ModelContentHash: ModelContentHash,
		})
	}))
	defer server.Close()

	observations := make(chan Observation, 1)
	classifier, err := NewClassifier(Config{
		EndpointURL:       server.URL,
		ServiceToken:      "unit-routing-token",
		Timeout:           100 * time.Millisecond,
		MaximumConcurrent: 4,
		Observer: func(observation Observation) {
			observations <- observation
			panic("observer failure must remain isolated")
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	result := classifier.Classify(
		context.Background(),
		routingdomain.ExtractPromptFeatures("Explain OAuth briefly."),
		routingdomain.CategoryGeneral,
	)
	if result.Status != routingdomain.DifficultySemanticShadowReady {
		t.Fatalf("result=%+v, want ready despite observer panic", result)
	}
	observation := <-observations
	if observation.Status != routingdomain.DifficultySemanticShadowReady || observation.Duration <= 0 {
		t.Fatalf("observation=%+v, want bounded ready telemetry", observation)
	}
}

func newTestClassifier(t *testing.T, endpoint string, timeout time.Duration, maximumConcurrent int) *Classifier {
	t.Helper()
	classifier, err := NewClassifier(Config{
		EndpointURL:       endpoint,
		ServiceToken:      "unit-routing-token",
		Timeout:           timeout,
		MaximumConcurrent: maximumConcurrent,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = classifier.Close(context.Background()) })
	return classifier
}
