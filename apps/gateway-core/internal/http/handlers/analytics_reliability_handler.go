package handlers

import (
	"context"
	"errors"
	"net/http"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type AnalyticsReliabilityReader interface {
	GetAnalyticsReliability(
		ctx context.Context,
		filter invocationlog.AnalyticsReliabilityFilter,
	) (invocationlog.AnalyticsReliabilityFields, error)
}

type AnalyticsReliabilityHandler struct {
	Reader   AnalyticsReliabilityReader
	TenantID string
}

type analyticsReliabilityResponse struct {
	Data invocationlog.AnalyticsReliabilityFields `json:"data"`
}

func (h AnalyticsReliabilityHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Reader == nil {
		writeGatewayError(
			w,
			http.StatusServiceUnavailable,
			"",
			"RELIABILITY_DATA_UNAVAILABLE",
			"Reliability data is unavailable.",
		)
		return
	}

	from, err := parseRequiredRFC3339Query(r, "from")
	if err != nil {
		writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
		return
	}
	to, err := parseRequiredRFC3339Query(r, "to")
	if err != nil {
		writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
		return
	}
	incidentLimit, err := parseOptionalPositiveIntQuery(r, "incidentLimit")
	if err != nil {
		writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
		return
	}

	query := r.URL.Query()
	filter := invocationlog.AnalyticsReliabilityFilter{
		TenantID:      firstNonEmptyQueryValue(query.Get("tenantId"), h.TenantID),
		ProjectID:     query.Get("projectId"),
		Surface:       query.Get("surface"),
		From:          from,
		To:            to,
		IncidentLimit: incidentLimit,
	}
	reliability, err := h.Reader.GetAnalyticsReliability(r.Context(), filter)
	if err != nil {
		switch {
		case errors.Is(err, invocationlog.ErrReliabilityScopeInvalid):
			writeGatewayError(w, http.StatusBadRequest, "", "RELIABILITY_SCOPE_INVALID", err.Error())
		case errors.Is(err, invocationlog.ErrReliabilityRangeTooBroad):
			writeGatewayError(w, http.StatusBadRequest, "", "RELIABILITY_RANGE_TOO_BROAD", err.Error())
		case errors.Is(err, invocationlog.ErrInvalidLogQuery):
			writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
		case errors.Is(err, invocationlog.ErrReliabilityDataUnavailable), errors.Is(err, invocationlog.ErrAnalyticsDataUnavailable):
			logInvocationLogInternalError(r, "get_analytics_reliability", filter.TenantID, filter.ProjectID, err)
			writeGatewayError(
				w,
				http.StatusServiceUnavailable,
				"",
				"RELIABILITY_DATA_UNAVAILABLE",
				"Reliability data is unavailable.",
			)
		default:
			logInvocationLogInternalError(r, "get_analytics_reliability", filter.TenantID, filter.ProjectID, err)
			writeGatewayError(w, http.StatusInternalServerError, "", "internal_error", "Reliability data could not be loaded.")
		}
		return
	}

	writeJSON(w, http.StatusOK, analyticsReliabilityResponse{Data: reliability})
}
