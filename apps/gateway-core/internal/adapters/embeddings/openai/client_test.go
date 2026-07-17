package openai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"syscall"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/embedding"
)

func TestClientEmbedsBatchAndRestoresResponseIndexOrder(t *testing.T) {
	const apiKey = "test_api_key_must_not_leak"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/embeddings" {
			t.Fatalf("unexpected request: method=%s path=%s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer "+apiKey {
			t.Fatal("credential must be sent only through the bearer header")
		}
		var request struct {
			Input      []string `json:"input"`
			Model      string   `json:"model"`
			Dimensions int      `json:"dimensions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if strings.Join(request.Input, "|") != "first|second" || request.Model != "request-model" || request.Dimensions != 3 {
			t.Fatalf("unexpected batch request: %+v", request)
		}
		writeJSON(t, w, map[string]any{
			"model": "request-model",
			"data": []map[string]any{
				{"index": 1, "embedding": []float64{2, 2, 2}},
				{"index": 0, "embedding": []float64{1, 1, 1}},
			},
			"usage": map[string]int{"prompt_tokens": 7, "total_tokens": 7},
		})
	}))
	defer server.Close()

	client := newTestClient(t, Config{
		APIKey:      apiKey,
		BaseURL:     server.URL + "/v1",
		Model:       "configured-model",
		Dimensions:  2,
		MaxAttempts: 1,
	})
	result, err := client.Embed(context.Background(), embedding.Request{
		Inputs:     []string{"first", "second"},
		Model:      "request-model",
		Dimensions: 3,
	})
	if err != nil {
		t.Fatalf("embed batch: %v", err)
	}
	if result.Model != "request-model" || result.Usage.PromptTokens != 7 || result.Usage.TotalTokens != 7 {
		t.Fatalf("unexpected result metadata: %+v", result)
	}
	if len(result.Vectors) != 2 || result.Vectors[0][0] != 1 || result.Vectors[1][0] != 2 {
		t.Fatalf("vectors must be reconstructed by response index: %+v", result.Vectors)
	}
}

func TestClientUsesScalarInputAndConfiguredProfileForSingleInput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Input      string `json:"input"`
			Model      string `json:"model"`
			Dimensions int    `json:"dimensions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("single input must retain scalar request compatibility: %v", err)
		}
		if request.Input != "  Preserve Original Text  " || request.Model != "configured-model" || request.Dimensions != 2 {
			t.Fatalf("unexpected single request: %+v", request)
		}
		writeJSON(t, w, map[string]any{
			"model": "configured-model",
			"data":  []map[string]any{{"index": 0, "embedding": []float64{0.1, 0.2}}},
			"usage": map[string]int{"prompt_tokens": 1, "total_tokens": 1},
		})
	}))
	defer server.Close()

	client := newTestClient(t, Config{
		APIKey:      "test-key",
		BaseURL:     server.URL,
		Model:       "configured-model",
		Dimensions:  2,
		MaxAttempts: 1,
	})
	result, err := client.Embed(context.Background(), embedding.Request{
		Inputs: []string{"  Preserve Original Text  "},
	})
	if err != nil {
		t.Fatalf("embed single input: %v", err)
	}
	if len(result.Vectors) != 1 || len(result.Vectors[0]) != 2 {
		t.Fatalf("unexpected single result: %+v", result)
	}
}

func TestValidateResponseRejectsUnsafeOrInconsistentVectors(t *testing.T) {
	index0, index1, index2 := 0, 1, 2
	cases := []struct {
		name       string
		response   responseBody
		count      int
		dimensions int
		want       error
	}{
		{name: "count mismatch", response: responseWithItems(responseItem(&index0, []float64{1, 2})), count: 2, dimensions: 2, want: embedding.ErrInvalidResponse},
		{name: "missing index", response: responseWithItems(responseItem(nil, []float64{1, 2})), count: 1, dimensions: 2, want: embedding.ErrInvalidResponse},
		{name: "duplicate index", response: responseWithItems(responseItem(&index0, []float64{1, 2}), responseItem(&index0, []float64{3, 4})), count: 2, dimensions: 2, want: embedding.ErrInvalidResponse},
		{name: "out of range index", response: responseWithItems(responseItem(&index2, []float64{1, 2})), count: 1, dimensions: 2, want: embedding.ErrInvalidResponse},
		{name: "dimension mismatch", response: responseWithItems(responseItem(&index0, []float64{1})), count: 1, dimensions: 2, want: embedding.ErrInvalidResponse},
		{name: "empty vector", response: responseWithItems(responseItem(&index0, nil)), count: 1, dimensions: 2, want: embedding.ErrEmptyVector},
		{name: "nan", response: responseWithItems(responseItem(&index0, []float64{math.NaN(), 1})), count: 1, dimensions: 2, want: embedding.ErrInvalidResponse},
		{name: "infinity", response: responseWithItems(responseItem(&index0, []float64{math.Inf(1), 1})), count: 1, dimensions: 2, want: embedding.ErrInvalidResponse},
		{name: "model mismatch", response: func() responseBody {
			response := responseWithItems(responseItem(&index0, []float64{1, 2}))
			response.Model = "different-model"
			return response
		}(), count: 1, dimensions: 2, want: embedding.ErrInvalidResponse},
		{name: "missing second index", response: responseWithItems(responseItem(&index0, []float64{1, 2}), responseItem(&index2, []float64{3, 4}), responseItem(&index1, []float64{5, 6})), count: 3, dimensions: 2, want: nil},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			_, err := validateStrictResponse(test.response, test.count, test.dimensions, "model")
			if test.want == nil {
				if err != nil {
					t.Fatalf("unexpected validation error: %v", err)
				}
				return
			}
			if !errors.Is(err, test.want) {
				t.Fatalf("validation error mismatch: got=%v want=%v", err, test.want)
			}
		})
	}
}

func TestValidateStrictResponseRequiresCompleteValidUsage(t *testing.T) {
	index0 := 0
	valid := responseWithItems(responseItem(&index0, []float64{1, 2}))
	negative := -1
	zero := 0
	one := 1
	two := 2
	tooMany := maximumUsageTokens + 1

	cases := []struct {
		name     string
		response responseBody
	}{
		{name: "missing model", response: func() responseBody {
			response := valid
			response.Model = ""
			return response
		}()},
		{name: "model must match exactly", response: func() responseBody {
			response := valid
			response.Model = " model "
			return response
		}()},
		{name: "missing usage object", response: func() responseBody {
			response := valid
			response.Usage = nil
			return response
		}()},
		{name: "missing prompt tokens", response: func() responseBody {
			response := valid
			response.Usage = &responseUsage{TotalTokens: &one}
			return response
		}()},
		{name: "missing total tokens", response: func() responseBody {
			response := valid
			response.Usage = &responseUsage{PromptTokens: &one}
			return response
		}()},
		{name: "negative prompt tokens", response: func() responseBody {
			response := valid
			response.Usage = &responseUsage{PromptTokens: &negative, TotalTokens: &one}
			return response
		}()},
		{name: "zero usage", response: func() responseBody {
			response := valid
			response.Usage = &responseUsage{PromptTokens: &zero, TotalTokens: &zero}
			return response
		}()},
		{name: "prompt exceeds total", response: func() responseBody {
			response := valid
			response.Usage = &responseUsage{PromptTokens: &two, TotalTokens: &one}
			return response
		}()},
		{name: "usage exceeds bound", response: func() responseBody {
			response := valid
			response.Usage = &responseUsage{PromptTokens: &one, TotalTokens: &tooMany}
			return response
		}()},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			_, err := validateStrictResponse(test.response, 1, 2, "model")
			if !errors.Is(err, embedding.ErrInvalidResponse) {
				t.Fatalf("strict response must reject incomplete or invalid metadata: %v", err)
			}
		})
	}
}

func TestClientDefaultsToStrictResponseValidation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, map[string]any{
			"data": []map[string]any{{"embedding": []float64{1}}},
		})
	}))
	defer server.Close()

	client := newTestClient(t, Config{APIKey: "test-key", BaseURL: server.URL, Model: "model", MaxAttempts: 1})
	_, err := client.Embed(context.Background(), embedding.Request{Inputs: []string{"safe input"}})
	if !errors.Is(err, embedding.ErrInvalidResponse) {
		t.Fatalf("zero-value validation mode must be strict: %v", err)
	}
}

func TestClientRejectsUnknownResponseValidationMode(t *testing.T) {
	_, err := NewClient(Config{
		APIKey:                 "test-key",
		BaseURL:                "https://example.com/v1",
		ResponseValidationMode: ResponseValidationMode("unknown"),
	})
	if !errors.Is(err, embedding.ErrInvalidRequest) {
		t.Fatalf("unknown validation mode must fail closed: %v", err)
	}
}

func TestClientRejectsMalformedAndOversizedResponses(t *testing.T) {
	cases := []struct {
		name  string
		body  string
		limit int64
		want  error
	}{
		{name: "malformed", body: `{"data":`, limit: 1024, want: embedding.ErrInvalidResponse},
		{name: "oversized", body: strings.Repeat("x", 65), limit: 64, want: embedding.ErrResponseTooLarge},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_, _ = io.WriteString(w, test.body)
			}))
			defer server.Close()
			client := newTestClient(t, Config{
				APIKey:           "test-key",
				BaseURL:          server.URL,
				Model:            "model",
				Dimensions:       2,
				MaxAttempts:      1,
				MaxResponseBytes: test.limit,
			})
			_, err := client.Embed(context.Background(), embedding.Request{Inputs: []string{"safe input"}})
			if !errors.Is(err, test.want) {
				t.Fatalf("response error mismatch: got=%v want=%v", err, test.want)
			}
		})
	}
}

func TestClientRetriesOnlyApprovedTransientFailures(t *testing.T) {
	for _, status := range []int{http.StatusRequestTimeout, http.StatusTooManyRequests, http.StatusInternalServerError} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			attempts := 0
			delays := []time.Duration{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				attempts++
				if attempts < 3 {
					w.WriteHeader(status)
					return
				}
				writeJSON(t, w, map[string]any{
					"model": "model",
					"data":  []map[string]any{{"index": 0, "embedding": []float64{1, 2}}},
					"usage": map[string]int{"prompt_tokens": 1, "total_tokens": 1},
				})
			}))
			defer server.Close()
			client := newTestClient(t, Config{
				APIKey:      "test-key",
				BaseURL:     server.URL,
				Model:       "model",
				Dimensions:  2,
				MaxAttempts: 3,
				Sleep: func(_ context.Context, delay time.Duration) error {
					delays = append(delays, delay)
					return nil
				},
			})
			if _, err := client.Embed(context.Background(), embedding.Request{Inputs: []string{"safe input"}}); err != nil {
				t.Fatalf("transient status should recover: %v", err)
			}
			if attempts != 3 || len(delays) != 2 || delays[0] >= delays[1] {
				t.Fatalf("bounded exponential retry mismatch: attempts=%d delays=%v", attempts, delays)
			}
		})
	}
}

func TestClientRetriesOnlyKnownTransientTransportFailures(t *testing.T) {
	cases := []struct {
		name string
		err  error
	}{
		{name: "temporary network error", err: temporaryError{}},
		{name: "connection reset", err: syscall.ECONNRESET},
		{name: "unexpected eof", err: io.ErrUnexpectedEOF},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			attempts := 0
			client := newTestClient(t, Config{
				APIKey:      "test-key",
				BaseURL:     "http://127.0.0.1/v1",
				Model:       "model",
				Dimensions:  2,
				MaxAttempts: 2,
				HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
					attempts++
					if attempts == 1 {
						return nil, test.err
					}
					return successfulEmbeddingResponse(request), nil
				})},
				Sleep: noSleep,
			})

			result, err := client.Embed(context.Background(), embedding.Request{Inputs: []string{"safe input"}})
			if err != nil || attempts != 2 || len(result.Vectors) != 1 {
				t.Fatalf("known transient transport must recover within the bound: attempts=%d result=%+v err=%v", attempts, result, err)
			}
		})
	}
}

func TestClientRetriesKnownTransientResponseBodyReadFailures(t *testing.T) {
	cases := []struct {
		name string
		err  error
	}{
		{name: "response body timeout", err: timeoutError{}},
		{name: "response body connection reset", err: syscall.ECONNRESET},
		{name: "response body unexpected eof", err: io.ErrUnexpectedEOF},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			attempts := 0
			client := newTestClient(t, Config{
				APIKey:      "test-key",
				BaseURL:     "http://127.0.0.1/v1",
				Model:       "model",
				Dimensions:  2,
				MaxAttempts: 2,
				HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
					attempts++
					if attempts == 1 {
						return &http.Response{
							StatusCode: http.StatusOK,
							Header:     make(http.Header),
							Body:       io.NopCloser(responseReadError{err: test.err}),
							Request:    request,
						}, nil
					}
					return successfulEmbeddingResponse(request), nil
				})},
				Sleep: noSleep,
			})

			result, err := client.Embed(context.Background(), embedding.Request{Inputs: []string{"safe input"}})
			if err != nil || attempts != 2 || len(result.Vectors) != 1 {
				t.Fatalf("known transient response read must recover within the bound: attempts=%d result=%+v err=%v", attempts, result, err)
			}
		})
	}
}

func TestClientPreservesTimeoutClassificationForResponseBodyRead(t *testing.T) {
	attempts := 0
	client := newTestClient(t, Config{
		APIKey:      "test-key",
		BaseURL:     "http://127.0.0.1/v1",
		Model:       "model",
		Dimensions:  2,
		MaxAttempts: 2,
		HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			attempts++
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(responseReadError{err: timeoutError{}}),
				Request:    request,
			}, nil
		})},
		Sleep: noSleep,
	})

	_, err := client.Embed(context.Background(), embedding.Request{Inputs: []string{"safe input"}})
	if !errors.Is(err, embedding.ErrTimeout) || !errors.Is(err, context.DeadlineExceeded) ||
		errors.Is(err, embedding.ErrRequestFailed) || attempts != 2 {
		t.Fatalf("response body timeout classification/retry mismatch: attempts=%d err=%v", attempts, err)
	}
}

func TestClientDoesNotRetryMalformedResponseBody(t *testing.T) {
	attempts := 0
	client := newTestClient(t, Config{
		APIKey:      "test-key",
		BaseURL:     "http://127.0.0.1/v1",
		Model:       "model",
		Dimensions:  2,
		MaxAttempts: 3,
		HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			attempts++
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"data":`)),
				Request:    request,
			}, nil
		})},
		Sleep: noSleep,
	})

	_, err := client.Embed(context.Background(), embedding.Request{Inputs: []string{"safe input"}})
	if !errors.Is(err, embedding.ErrInvalidResponse) || attempts != 1 {
		t.Fatalf("malformed provider JSON must be a permanent safe error: attempts=%d err=%v", attempts, err)
	}
}

func TestClientDoesNotRetryPermanentStatusOrGenericTransportFailure(t *testing.T) {
	t.Run("permanent 4xx", func(t *testing.T) {
		attempts := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			attempts++
			w.WriteHeader(http.StatusBadRequest)
		}))
		defer server.Close()
		client := newTestClient(t, Config{APIKey: "test-key", BaseURL: server.URL, Model: "model", MaxAttempts: 3, Sleep: noSleep})
		_, err := client.Embed(context.Background(), embedding.Request{Inputs: []string{"safe input"}})
		if !errors.Is(err, embedding.ErrRequestFailed) || attempts != 1 {
			t.Fatalf("permanent failure must not retry: attempts=%d err=%v", attempts, err)
		}
	})

	t.Run("generic transport", func(t *testing.T) {
		attempts := 0
		client := newTestClient(t, Config{
			APIKey:      "test-key",
			BaseURL:     "http://127.0.0.1/v1",
			Model:       "model",
			MaxAttempts: 3,
			HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				attempts++
				return nil, errors.New("raw transport detail must not leak")
			})},
			Sleep: noSleep,
		})
		_, err := client.Embed(context.Background(), embedding.Request{Inputs: []string{"safe input"}})
		if !errors.Is(err, embedding.ErrRequestFailed) || attempts != 1 || strings.Contains(err.Error(), "raw transport detail") {
			t.Fatalf("generic transport failure must be safe and permanent: attempts=%d err=%v", attempts, err)
		}
	})
}

func TestClientExposesSafeStatusFailureKindsWithoutErrorTextParsing(t *testing.T) {
	cases := []struct {
		name       string
		status     int
		want       error
		wantFailed bool
	}{
		{name: "unauthorized", status: http.StatusUnauthorized, want: embedding.ErrUnauthorized, wantFailed: true},
		{name: "forbidden", status: http.StatusForbidden, want: embedding.ErrUnauthorized, wantFailed: true},
		{name: "request timeout", status: http.StatusRequestTimeout, want: embedding.ErrTimeout, wantFailed: true},
		{name: "rate limited", status: http.StatusTooManyRequests, want: embedding.ErrRateLimited, wantFailed: true},
		{name: "provider failed", status: http.StatusInternalServerError, want: embedding.ErrRequestFailed, wantFailed: true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
			}))
			defer server.Close()
			client := newTestClient(t, Config{
				APIKey: "test-key", BaseURL: server.URL, Model: "model", MaxAttempts: 1,
			})
			_, err := client.Embed(context.Background(), embedding.Request{Inputs: []string{"safe input"}})
			if !errors.Is(err, test.want) {
				t.Fatalf("status failure kind mismatch: got=%v want=%v", err, test.want)
			}
			if errors.Is(err, embedding.ErrRequestFailed) != test.wantFailed {
				t.Fatalf("request-failed compatibility mismatch: %v", err)
			}
		})
	}
}

func TestClientRetriesTransportTimeoutAndPreservesDeadlineClassification(t *testing.T) {
	attempts := 0
	client := newTestClient(t, Config{
		APIKey:      "test-key",
		BaseURL:     "http://127.0.0.1/v1",
		Model:       "model",
		Dimensions:  2,
		MaxAttempts: 2,
		HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			attempts++
			if _, ok := request.Context().Deadline(); !ok {
				t.Fatal("each provider attempt must have its own deadline")
			}
			return nil, timeoutError{}
		})},
		Sleep: noSleep,
	})
	_, err := client.Embed(context.Background(), embedding.Request{Inputs: []string{"safe input"}})
	if !errors.Is(err, context.DeadlineExceeded) || !errors.Is(err, embedding.ErrTimeout) ||
		attempts != 2 || errors.Is(err, embedding.ErrRequestFailed) {
		t.Fatalf("timeout classification/retry mismatch: attempts=%d err=%v", attempts, err)
	}
}

func TestClientErrorsNeverContainCredentialInputVectorOrProviderBody(t *testing.T) {
	const (
		apiKey       = "secret-api-key"
		input        = "private source input"
		providerBody = "provider raw error private detail"
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, providerBody+` [0.123,0.456]`, http.StatusBadRequest)
	}))
	defer server.Close()
	client := newTestClient(t, Config{APIKey: apiKey, BaseURL: server.URL, Model: "model", MaxAttempts: 1})
	_, err := client.Embed(context.Background(), embedding.Request{Inputs: []string{input}})
	if err == nil {
		t.Fatal("provider failure expected")
	}
	for _, forbidden := range []string{apiKey, input, providerBody, "0.123"} {
		if strings.Contains(err.Error(), forbidden) {
			t.Fatalf("safe error leaked forbidden material: %v", err)
		}
	}
}

func newTestClient(t *testing.T, config Config) *Client {
	t.Helper()
	client, err := NewClient(config)
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	return client
}

func writeJSON(t *testing.T, w http.ResponseWriter, value any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		t.Fatalf("write response: %v", err)
	}
}

type responseItemValue struct {
	index     *int
	embedding []float64
}

func responseItem(index *int, vector []float64) responseItemValue {
	return responseItemValue{index: index, embedding: vector}
}

func responseWithItems(items ...responseItemValue) responseBody {
	promptTokens, totalTokens := 1, 1
	response := responseBody{
		Model: "model",
		Usage: &responseUsage{PromptTokens: &promptTokens, TotalTokens: &totalTokens},
	}
	for _, item := range items {
		response.Data = append(response.Data, struct {
			Index     *int      `json:"index"`
			Embedding []float64 `json:"embedding"`
		}{Index: item.index, Embedding: item.embedding})
	}
	return response
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

type responseReadError struct{ err error }

func (r responseReadError) Read([]byte) (int, error) { return 0, r.err }

type timeoutError struct{}

func (timeoutError) Error() string   { return "timeout detail" }
func (timeoutError) Timeout() bool   { return true }
func (timeoutError) Temporary() bool { return true }

type temporaryError struct{}

func (temporaryError) Error() string   { return "temporary detail" }
func (temporaryError) Timeout() bool   { return false }
func (temporaryError) Temporary() bool { return true }

func successfulEmbeddingResponse(request *http.Request) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body: io.NopCloser(strings.NewReader(
			`{"model":"model","data":[{"index":0,"embedding":[1,2]}],"usage":{"prompt_tokens":1,"total_tokens":1}}`,
		)),
		Request: request,
	}
}

func noSleep(context.Context, time.Duration) error { return nil }
