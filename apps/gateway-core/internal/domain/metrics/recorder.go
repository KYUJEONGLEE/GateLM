package metrics

import (
	"strconv"
	"strings"
)

type GatewayRequest struct {
	Endpoint        string
	Method          string
	Status          string
	HTTPStatus      int
	ErrorCode       string
	DurationSeconds float64
}

type ProviderRequest struct {
	SelectedProvider string
	SelectedModel    string
	Status           string
	HTTPStatus       int
	ErrorCode        string
	DurationSeconds  float64
}

type CacheOperation struct {
	Operation   string
	CacheStatus string
	CacheType   string
	Status      string
}

type RateLimitDecision struct {
	Allowed         bool
	Reason          string
	DurationSeconds float64
}

type LogWrite struct {
	Operation       string
	Status          string
	DurationSeconds float64
}

func (r *Registry) GatewayRequestStarted(endpoint string, method string) {
	r.AddGauge(GatewayInflightRequests, []Label{
		{Name: "endpoint", Value: endpoint},
		{Name: "method", Value: method},
	}, 1)
}

func (r *Registry) GatewayRequestCompleted(request GatewayRequest) {
	labels := []Label{
		{Name: "endpoint", Value: request.Endpoint},
		{Name: "method", Value: request.Method},
		{Name: "status", Value: normalizeStatus(request.Status)},
		{Name: "http_status", Value: httpStatusLabel(request.HTTPStatus)},
		{Name: "error_code", Value: defaultLabelValue(request.ErrorCode)},
	}
	r.AddGauge(GatewayInflightRequests, []Label{
		{Name: "endpoint", Value: request.Endpoint},
		{Name: "method", Value: request.Method},
	}, -1)
	r.AddCounter(GatewayRequestsTotal, labels, 1)
	r.ObserveHistogram(GatewayRequestDurationSeconds, labels, request.DurationSeconds)
}

func (r *Registry) ProviderRequest(request ProviderRequest) {
	labels := []Label{
		{Name: "selected_provider", Value: request.SelectedProvider},
		{Name: "selected_model", Value: request.SelectedModel},
		{Name: "status", Value: normalizeStatus(request.Status)},
		{Name: "http_status", Value: httpStatusLabel(request.HTTPStatus)},
		{Name: "error_code", Value: defaultLabelValue(request.ErrorCode)},
	}
	r.AddCounter(ProviderRequestsTotal, labels, 1)
	r.ObserveHistogram(ProviderRequestDurationSeconds, labels, request.DurationSeconds)
}

func (r *Registry) CacheOperation(operation CacheOperation) {
	labels := []Label{
		{Name: "operation", Value: operation.Operation},
		{Name: "cache_status", Value: operation.CacheStatus},
		{Name: "cache_type", Value: operation.CacheType},
		{Name: "status", Value: normalizeStatus(operation.Status)},
	}
	r.AddCounter(CacheOperationsTotal, labels, 1)
}

func (r *Registry) RateLimitDecision(decision RateLimitDecision) {
	labels := []Label{
		{Name: "rate_limit_allowed", Value: strconv.FormatBool(decision.Allowed)},
		{Name: "status", Value: normalizeRateLimitStatus(decision)},
	}
	r.AddCounter(RateLimitDecisionsTotal, labels, 1)
	r.ObserveHistogram(RateLimitDecisionDurationSeconds, labels, decision.DurationSeconds)
}

func (r *Registry) MaskingAction(action string) {
	r.AddCounter(MaskingActionsTotal, []Label{
		{Name: "masking_action", Value: defaultLabelValue(action)},
	}, 1)
}

func (r *Registry) LogWrite(write LogWrite) {
	labels := []Label{
		{Name: "operation", Value: write.Operation},
		{Name: "status", Value: normalizeStatus(write.Status)},
	}
	r.AddCounter(LogWritesTotal, labels, 1)
	r.ObserveHistogram(LogWriteDurationSeconds, labels, write.DurationSeconds)
}

func httpStatusLabel(status int) string {
	if status <= 0 {
		return "0"
	}
	return strconv.Itoa(status)
}

func defaultLabelValue(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "none"
	}
	return value
}

func normalizeStatus(status string) string {
	trimmed := strings.TrimSpace(status)
	switch trimmed {
	case "success", "blocked", "rate_limited", "failed", "cancelled":
		return trimmed
	case "cache_hit":
		return "success"
	case "error", "partial_success":
		return "failed"
	case "":
		return "failed"
	default:
		return "failed"
	}
}

func normalizeRateLimitStatus(decision RateLimitDecision) string {
	if decision.Allowed {
		return "success"
	}
	switch strings.TrimSpace(decision.Reason) {
	case "rate_limited", "limit_exceeded":
		return "rate_limited"
	case "blocked":
		return "blocked"
	case "cancelled":
		return "cancelled"
	default:
		return "failed"
	}
}
