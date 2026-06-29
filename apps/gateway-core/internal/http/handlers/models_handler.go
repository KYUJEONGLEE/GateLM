package handlers

import (
	"net/http"
	"time"

	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/pipeline"
)

type ModelsHandler struct {
	Providers           *provider.Registry
	PreProviderPipeline GatewayPipeline
}

func (h ModelsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	startedAt := time.Now()
	requestID := middleware.NormalizeRequestID(r.Header.Get(middleware.RequestIDHeader))
	if requestID == "" {
		requestID = middleware.NewRequestID()
	}

	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: requestID,
		TraceID:   requestID,
		Endpoint:  "/v1/models",
		Method:    http.MethodGet,
		StartedAt: startedAt.UTC(),
	})

	gatewayCtx := newGatewayContext(reqCtx, "")
	if h.PreProviderPipeline != nil {
		if err := h.PreProviderPipeline.Execute(r.Context(), gatewayCtx); err != nil {
			applyGatewayContext(reqCtx, gatewayCtx)
			writeGatewayPipelineFailure(w, reqCtx, err)
			return
		}
		applyGatewayContext(reqCtx, gatewayCtx)
	}

	if h.Providers == nil {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusInternalServerError, "internal_error", "Providers registry is not initialized.", "resolve_provider_adapter")
		return
	}
	adapter, err := h.Providers.Get("")
	if err != nil {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusInternalServerError, "internal_error", "Gateway provider is not configured.", "resolve_provider_adapter")
		return
	}

	reqCtx.SelectedProvider = adapter.Name()

	models, err := adapter.ListModels(r.Context())
	if err != nil {
		failure := provider.ClassifyFailure(err)
		writeGatewayErrorWithContext(w, reqCtx, httpStatusForProviderFailure(failure), failure.SanitizedCode(), "Provider request failed.", "call_provider_model_catalog")
		return
	}

	setGatewayHeaders(w, reqCtx)
	writeJSON(w, http.StatusOK, models)
}
