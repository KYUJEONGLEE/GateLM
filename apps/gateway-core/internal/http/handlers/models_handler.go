package handlers

import (
	"net/http"

	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/http/middleware"
)

type ModelsHandler struct {
	Providers *provider.Registry
}

func (h ModelsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := middleware.NormalizeRequestID(r.Header.Get(middleware.RequestIDHeader))
	if requestID == "" {
		requestID = middleware.NewRequestID()
	}

	adapter, err := h.Providers.Get("")
	if err != nil {
		writeGatewayError(w, http.StatusServiceUnavailable, requestID, "provider_not_configured", "Gateway provider is not configured.")
		return
	}

	models, err := adapter.ListModels(r.Context())
	if err != nil {
		writeGatewayError(w, http.StatusBadGateway, requestID, "provider_error", "Provider request failed.")
		return
	}

	w.Header().Set(middleware.RequestIDHeader, requestID)
	writeJSON(w, http.StatusOK, models)
}
