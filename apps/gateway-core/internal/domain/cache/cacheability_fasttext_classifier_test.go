package cache

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestFastTextSidecarCacheabilityClassifierClassifies(t *testing.T) {
	var received fastTextSidecarRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("sidecar method mismatch: %s", r.Method)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("sidecar request decode failed: %v", err)
		}
		writeFastTextSidecarTestResponse(t, w, fastTextSidecarResponse{
			Label:        string(CacheabilityLabelCacheableStatic),
			Confidence:   floatPointer(0.96),
			ReasonCode:   CacheabilityReasonFastTextSidecar,
			ModelVersion: "cacheability-fasttext-synthetic-v1",
		})
	}))
	defer server.Close()

	classifier, err := NewFastTextSidecarCacheabilityClassifier(FastTextSidecarCacheabilityClassifierConfig{
		Endpoint:   server.URL,
		HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatalf("fasttext sidecar classifier construct failed: %v", err)
	}

	result, err := classifier.Classify(context.Background(), CacheabilityClassificationRequest{
		NormalizedText: "  비밀번호   재설정 방법 알려줘  ",
		PromptCategory: SemanticCacheCategoryGeneral,
	})
	if err != nil {
		t.Fatalf("fasttext sidecar classification failed: %v", err)
	}
	if err := result.Validate(); err != nil {
		t.Fatalf("fasttext sidecar result must satisfy contract: %+v err=%v", result, err)
	}
	if result.Label != CacheabilityLabelCacheableStatic || result.Confidence != 0.96 || !result.Passes(0.90) {
		t.Fatalf("fasttext sidecar result mismatch: %+v", result)
	}
	if received.Text != "비밀번호 재설정 방법 알려줘" || received.PromptCategory != SemanticCacheCategoryGeneral {
		t.Fatalf("fasttext sidecar request mismatch: %+v", received)
	}
}

func TestFastTextSidecarCacheabilityClassifierFailureModes(t *testing.T) {
	t.Run("missing endpoint", func(t *testing.T) {
		_, err := NewFastTextSidecarCacheabilityClassifier(FastTextSidecarCacheabilityClassifierConfig{})
		if !errors.Is(err, ErrCacheabilityClassifierInvalidConfig) {
			t.Fatalf("missing endpoint should be invalid config: %v", err)
		}
	})

	t.Run("non-success response is classifier error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
		}))
		defer server.Close()
		classifier, err := NewFastTextSidecarCacheabilityClassifier(FastTextSidecarCacheabilityClassifierConfig{
			Endpoint:   server.URL,
			HTTPClient: server.Client(),
		})
		if err != nil {
			t.Fatalf("construct failed: %v", err)
		}
		_, err = classifier.Classify(context.Background(), CacheabilityClassificationRequest{NormalizedText: "how to reset password"})
		if err == nil {
			t.Fatalf("non-success sidecar response should fail closed with an error")
		}
	})

	t.Run("malformed json is invalid response", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"label":`))
		}))
		defer server.Close()
		classifier, err := NewFastTextSidecarCacheabilityClassifier(FastTextSidecarCacheabilityClassifierConfig{
			Endpoint:   server.URL,
			HTTPClient: server.Client(),
		})
		if err != nil {
			t.Fatalf("construct failed: %v", err)
		}
		_, err = classifier.Classify(context.Background(), CacheabilityClassificationRequest{NormalizedText: "how to reset password"})
		if !errors.Is(err, ErrCacheabilityClassifierInvalidResult) {
			t.Fatalf("malformed sidecar response should be invalid result: %v", err)
		}
	})

	t.Run("invalid contract result is returned for handler fail-closed validation", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			writeFastTextSidecarTestResponse(t, w, fastTextSidecarResponse{
				Label:        "intent_refund",
				Confidence:   floatPointer(0.96),
				ReasonCode:   CacheabilityReasonFastTextSidecar,
				ModelVersion: "cacheability-fasttext-synthetic-v1",
			})
		}))
		defer server.Close()
		classifier, err := NewFastTextSidecarCacheabilityClassifier(FastTextSidecarCacheabilityClassifierConfig{
			Endpoint:   server.URL,
			HTTPClient: server.Client(),
		})
		if err != nil {
			t.Fatalf("construct failed: %v", err)
		}
		result, err := classifier.Classify(context.Background(), CacheabilityClassificationRequest{NormalizedText: "refund policy 설명해줘"})
		if err != nil {
			t.Fatalf("invalid contract payload should be returned for gate validation: %v", err)
		}
		if err := result.Validate(); !errors.Is(err, ErrCacheabilityClassifierInvalidResult) {
			t.Fatalf("invalid sidecar label should fail contract validation: %+v err=%v", result, err)
		}
	})

	t.Run("context timeout", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(25 * time.Millisecond)
			writeFastTextSidecarTestResponse(t, w, fastTextSidecarResponse{
				Label:        string(CacheabilityLabelCacheableStatic),
				Confidence:   floatPointer(0.96),
				ReasonCode:   CacheabilityReasonFastTextSidecar,
				ModelVersion: "cacheability-fasttext-synthetic-v1",
			})
		}))
		defer server.Close()
		classifier, err := NewFastTextSidecarCacheabilityClassifier(FastTextSidecarCacheabilityClassifierConfig{
			Endpoint:   server.URL,
			HTTPClient: server.Client(),
		})
		if err != nil {
			t.Fatalf("construct failed: %v", err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
		defer cancel()
		_, err = classifier.Classify(ctx, CacheabilityClassificationRequest{NormalizedText: "how to reset password"})
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("timeout should return context deadline exceeded: %v", err)
		}
	})
}

func TestNewCacheabilityClassifierFastTextFactory(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeFastTextSidecarTestResponse(t, w, fastTextSidecarResponse{
			Label:        string(CacheabilityLabelCacheableStatic),
			Confidence:   floatPointer(0.96),
			ReasonCode:   CacheabilityReasonFastTextSidecar,
			ModelVersion: "cacheability-fasttext-synthetic-v1",
		})
	}))
	defer server.Close()

	classifier, err := NewCacheabilityClassifier(CacheabilityClassifierConfig{
		Enabled:  true,
		Type:     CacheabilityClassifierTypeFastText,
		Endpoint: server.URL,
	})
	if err != nil {
		t.Fatalf("fasttext classifier factory should construct with endpoint: %v", err)
	}
	result, err := classifier.Classify(context.Background(), CacheabilityClassificationRequest{NormalizedText: "how to reset password"})
	if err != nil {
		t.Fatalf("factory fasttext classifier failed: %v", err)
	}
	if !result.Passes(0.90) {
		t.Fatalf("factory fasttext classifier should return cacheable result: %+v", result)
	}

	disabled, err := NewCacheabilityClassifier(CacheabilityClassifierConfig{
		Enabled: false,
		Type:    CacheabilityClassifierTypeFastText,
	})
	if err != nil {
		t.Fatalf("disabled fasttext config should still no-op without endpoint: %v", err)
	}
	disabledResult, err := disabled.Classify(context.Background(), CacheabilityClassificationRequest{NormalizedText: "how to reset password"})
	if err != nil {
		t.Fatalf("disabled fasttext classifier should not fail: %v", err)
	}
	if disabledResult.ReasonCode != CacheabilityReasonClassifierDisabled {
		t.Fatalf("disabled fasttext classifier should fail closed as no-op: %+v", disabledResult)
	}
}

func writeFastTextSidecarTestResponse(t *testing.T, w http.ResponseWriter, response fastTextSidecarResponse) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		t.Fatalf("sidecar response encode failed: %v", err)
	}
}

func floatPointer(value float64) *float64 {
	return &value
}
