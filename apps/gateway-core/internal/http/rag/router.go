package rag

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	ragworkloadauth "gatelm/apps/gateway-core/internal/adapters/rag/workloadauth"
	embeddingdomain "gatelm/apps/gateway-core/internal/domain/embedding"
	"gatelm/apps/gateway-core/internal/domain/metrics"
	"gatelm/apps/gateway-core/internal/domain/ragembedding"
	ragservice "gatelm/apps/gateway-core/internal/services/rag/embedding"
)

type authenticator interface {
	Authenticate(ctx context.Context, authorization string, request ragembedding.Request) (ragembedding.VerifiedScope, error)
}

type embeddingService interface {
	Embed(ctx context.Context, scope ragembedding.VerifiedScope, request ragembedding.Request) (ragservice.Response, error)
}

type Handler struct {
	auth         authenticator
	embeddings   embeddingService
	maxBodyBytes int64
	metrics      *metrics.Registry
}

type Option func(*Handler)

func WithMetrics(registry *metrics.Registry) Option {
	return func(handler *Handler) { handler.metrics = registry }
}

func NewRouter(auth authenticator, embeddings embeddingService, maxBodyBytes int64, options ...Option) http.Handler {
	handler := &Handler{auth: auth, embeddings: embeddings, maxBodyBytes: maxBodyBytes}
	for _, option := range options {
		if option != nil {
			option(handler)
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /internal/v1/rag/embeddings", handler.embed)
	return mux
}

func (h *Handler) embed(w http.ResponseWriter, request *http.Request) {
	if h == nil || h.auth == nil || h.embeddings == nil || h.maxBodyBytes <= 0 {
		h.record("unknown", "unknown", "invalid", "RAG_EMBEDDING_UNAVAILABLE", 0)
		writeError(w, http.StatusServiceUnavailable, "RAG_EMBEDDING_UNAVAILABLE", "RAG embedding service is unavailable.", 1)
		return
	}

	payload := ragembedding.Request{}
	if err := h.decodeJSON(w, request, &payload); err != nil || ragembedding.ValidateRequest(payload) != nil {
		h.record("unknown", "unknown", "invalid", "RAG_EMBEDDING_INVALID_REQUEST", 0)
		writeError(w, http.StatusBadRequest, "RAG_EMBEDDING_INVALID_REQUEST", "Invalid RAG embedding request.", 0)
		return
	}
	scope, err := h.auth.Authenticate(request.Context(), request.Header.Get("Authorization"), payload)
	if err != nil {
		h.record("unknown", "unknown", string(payload.Purpose), "RAG_EMBEDDING_TOKEN_INVALID", 0)
		writeAuthenticationError(w, err)
		return
	}
	response, err := h.embeddings.Embed(request.Context(), scope, payload)
	if err != nil {
		h.record("unknown", "unknown", string(payload.Purpose), safeFailureCode(err), 0)
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
	h.record(response.Provider, response.Model, string(response.Purpose), "none", response.Usage.PromptTokens)
}

func (h *Handler) record(provider, model, purpose, failureCode string, inputTokens int) {
	if h == nil || h.metrics == nil {
		return
	}
	jobType := "query"
	if purpose == string(ragembedding.PurposeIngestion) {
		jobType = "ingestion"
	}
	labels := []metrics.Label{
		{Name: "service", Value: "gateway-core"}, {Name: "provider", Value: provider}, {Name: "model", Value: model},
		{Name: "job_type", Value: jobType}, {Name: "failure_code", Value: failureCode},
	}
	h.metrics.AddCounter(metrics.RagEmbeddingRequestsTotal, labels, 1)
	if inputTokens > 0 {
		h.metrics.AddCounter(metrics.RagEmbeddingInputTokensTotal, labels, float64(inputTokens))
	}
}

func safeFailureCode(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, embeddingdomain.ErrTimeout):
		return "RAG_EMBEDDING_PROVIDER_TIMEOUT"
	case errors.Is(err, embeddingdomain.ErrRateLimited):
		return "RAG_EMBEDDING_RATE_LIMITED"
	case errors.Is(err, embeddingdomain.ErrInvalidRequest), errors.Is(err, embeddingdomain.ErrInputEmpty), errors.Is(err, ragservice.ErrInvalidRequest):
		return "RAG_EMBEDDING_INVALID_REQUEST"
	default:
		return "RAG_EMBEDDING_UNAVAILABLE"
	}
}

func (h *Handler) decodeJSON(w http.ResponseWriter, request *http.Request, target any) error {
	if !strings.HasPrefix(strings.ToLower(request.Header.Get("Content-Type")), "application/json") {
		return ragservice.ErrInvalidRequest
	}
	request.Body = http.MaxBytesReader(w, request.Body, h.maxBodyBytes)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return ragservice.ErrInvalidRequest
		}
		return err
	}
	return nil
}

func writeAuthenticationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ragworkloadauth.ErrInvalidRequest):
		writeError(w, http.StatusBadRequest, "RAG_EMBEDDING_INVALID_REQUEST", "Invalid RAG embedding request.", 0)
	case errors.Is(err, ragworkloadauth.ErrGuardUnavailable):
		writeError(w, http.StatusServiceUnavailable, "RAG_EMBEDDING_UNAVAILABLE", "RAG embedding service is unavailable.", 1)
	default:
		writeError(w, http.StatusUnauthorized, "RAG_EMBEDDING_TOKEN_INVALID", "RAG embedding workload authorization failed.", 0)
	}
}

func writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, context.Canceled):
		return
	case errors.Is(err, ragservice.ErrInvalidRequest), errors.Is(err, embeddingdomain.ErrInvalidRequest),
		errors.Is(err, embeddingdomain.ErrInputEmpty):
		writeError(w, http.StatusBadRequest, "RAG_EMBEDDING_INVALID_REQUEST", "Invalid RAG embedding request.", 0)
	case errors.Is(err, embeddingdomain.ErrRateLimited):
		writeError(w, http.StatusTooManyRequests, "RAG_EMBEDDING_RATE_LIMITED", "RAG embedding provider is rate limited.", 1)
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, embeddingdomain.ErrTimeout):
		writeError(w, http.StatusGatewayTimeout, "RAG_EMBEDDING_PROVIDER_TIMEOUT", "RAG embedding provider timed out.", 0)
	case errors.Is(err, embeddingdomain.ErrCredentialRequired), errors.Is(err, embeddingdomain.ErrCredentialUnavailable),
		errors.Is(err, embeddingdomain.ErrUnauthorized),
		errors.Is(err, ragservice.ErrServiceUnavailable):
		writeError(w, http.StatusServiceUnavailable, "RAG_EMBEDDING_UNAVAILABLE", "RAG embedding service is unavailable.", 1)
	default:
		writeError(w, http.StatusBadGateway, "RAG_EMBEDDING_PROVIDER_FAILED", "RAG embedding provider failed.", 0)
	}
}

type errorResponse struct {
	Code              string `json:"code"`
	Message           string `json:"message"`
	RetryAfterSeconds int    `json:"retryAfterSeconds,omitempty"`
}

func writeError(w http.ResponseWriter, status int, code, message string, retryAfterSeconds int) {
	if retryAfterSeconds > 0 {
		w.Header().Set("Retry-After", "1")
	}
	writeJSON(w, status, errorResponse{Code: code, Message: message, RetryAfterSeconds: retryAfterSeconds})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	response, err := json.Marshal(payload)
	if err != nil {
		status = http.StatusServiceUnavailable
		response = []byte(`{"code":"RAG_EMBEDDING_UNAVAILABLE","message":"RAG embedding service is unavailable."}`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(response)
}
