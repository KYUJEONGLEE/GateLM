package handlers

import (
	"net/http"

	"gatelm/apps/gateway-core/internal/domain/metrics"
)

type MetricsHandler struct {
	Registry *metrics.Registry
}

func (h MetricsHandler) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	registry := h.Registry
	if registry == nil {
		registry = metrics.NewRegistry()
	}

	w.Header().Set("Content-Type", metrics.PrometheusTextContentType)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(registry.RenderPrometheus()))
}
