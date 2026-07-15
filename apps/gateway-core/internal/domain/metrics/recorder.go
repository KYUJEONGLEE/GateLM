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

type GatewayStageDuration struct {
	Stage           string
	Status          string
	DurationSeconds float64
}

type ProviderRequest struct {
	Provider        string
	Model           string
	Status          string
	HTTPStatus      int
	ErrorCode       string
	DurationSeconds float64
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

type StreamRelay struct {
	Provider        string
	Model           string
	Outcome         string
	ErrorCode       string
	DurationSeconds float64
}

type StreamTimeToFirstToken struct {
	Provider        string
	Model           string
	DurationSeconds float64
}

// AISafetySidecarCall contains aggregate-only sidecar telemetry. Every string
// is normalized to a bounded value before it is emitted as a metric label.
type AISafetySidecarCall struct {
	Surface         string
	Mode            string
	Outcome         string
	InferencePath   string
	DurationSeconds float64
}

// AISafetySidecarFallback records a local-rule fallback without carrying the
// upstream error or any request-derived value.
type AISafetySidecarFallback struct {
	Surface string
	Mode    string
	Reason  string
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

func (r *Registry) GatewayStageDuration(duration GatewayStageDuration) {
	labels := []Label{
		{Name: "stage", Value: defaultLabelValue(duration.Stage)},
		{Name: "status", Value: normalizeStatus(duration.Status)},
	}
	r.ObserveHistogram(GatewayStageDurationSeconds, labels, duration.DurationSeconds)
}

func (r *Registry) ProviderRequest(request ProviderRequest) {
	labels := []Label{
		{Name: "provider", Value: request.Provider},
		{Name: "model", Value: request.Model},
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
		{Name: "status", Value: operation.Status},
	}
	r.AddCounter(CacheOperationsTotal, labels, 1)
}

func (r *Registry) RateLimitDecision(decision RateLimitDecision) {
	labels := []Label{
		{Name: "rate_limit_allowed", Value: strconv.FormatBool(decision.Allowed)},
		{Name: "status", Value: defaultLabelValue(decision.Reason)},
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
		{Name: "status", Value: write.Status},
	}
	r.AddCounter(LogWritesTotal, labels, 1)
	r.ObserveHistogram(LogWriteDurationSeconds, labels, write.DurationSeconds)
}

type AsyncLogEvent struct {
	Operation       string
	Status          string
	DurationSeconds float64
}

func (r *Registry) AsyncLogEnqueue(event AsyncLogEvent) {
	labels := asyncLogLabels(event.Operation, event.Status)
	r.AddCounter(AsyncLogEnqueueTotal, labels, 1)
	r.ObserveHistogram(AsyncLogEnqueueDurationSeconds, labels, event.DurationSeconds)
}

func (r *Registry) AsyncLogQueueDepth(operation string, depth int) {
	r.SetGauge(AsyncLogQueueDepth, []Label{{Name: "operation", Value: operation}}, float64(depth))
}

func (r *Registry) AsyncLogDropped(operation string, status string) {
	r.AddCounter(AsyncLogDroppedTotal, asyncLogLabels(operation, status), 1)
}

func (r *Registry) AsyncLogPersist(event AsyncLogEvent) {
	r.AsyncLogPersistBatch(event, 1)
}

func (r *Registry) AsyncLogPersistBatch(event AsyncLogEvent, recordCount int) {
	if recordCount <= 0 {
		return
	}
	labels := asyncLogLabels(event.Operation, event.Status)
	r.AddCounter(AsyncLogPersistTotal, labels, float64(recordCount))
	r.ObserveHistogram(AsyncLogPersistDurationSeconds, labels, event.DurationSeconds)
}
func (r *Registry) StreamStarted(provider string, model string) {
	r.AddGauge(StreamsActive, streamBaseLabels(provider, model), 1)
}

func (r *Registry) StreamFinished(relay StreamRelay) {
	baseLabels := streamBaseLabels(relay.Provider, relay.Model)
	relayLabels := append(baseLabels,
		Label{Name: "stream_outcome", Value: normalizeStreamOutcome(relay.Outcome)},
		Label{Name: "error_code", Value: defaultLabelValue(relay.ErrorCode)},
	)
	r.AddGauge(StreamsActive, baseLabels, -1)
	r.AddCounter(StreamRelayTotal, relayLabels, 1)
	r.ObserveHistogram(StreamDurationSeconds, relayLabels, relay.DurationSeconds)
}

func (r *Registry) StreamTimeToFirstToken(ttft StreamTimeToFirstToken) {
	r.ObserveHistogram(
		StreamTimeToFirstTokenSeconds,
		streamBaseLabels(ttft.Provider, ttft.Model),
		ttft.DurationSeconds,
	)
}

func (r *Registry) RecordAISafetySidecarCall(call AISafetySidecarCall) {
	labels := []Label{
		{Name: "surface", Value: normalizeAISafetySurface(call.Surface)},
		{Name: "mode", Value: normalizeAISafetyMode(call.Mode)},
		{Name: "outcome", Value: normalizeAISafetyOutcome(call.Outcome)},
		{Name: "inference_path", Value: normalizeAISafetyInferencePath(call.InferencePath)},
	}
	r.AddCounter(AISafetySidecarCallsTotal, labels, 1)
	r.ObserveHistogram(AISafetySidecarCallDurationSeconds, labels, call.DurationSeconds)
}

func (r *Registry) RecordAISafetySidecarFallback(fallback AISafetySidecarFallback) {
	r.AddCounter(AISafetySidecarFallbackTotal, []Label{
		{Name: "surface", Value: normalizeAISafetySurface(fallback.Surface)},
		{Name: "mode", Value: normalizeAISafetyMode(fallback.Mode)},
		{Name: "reason", Value: normalizeAISafetyFallbackReason(fallback.Reason)},
	}, 1)
}

func (r *Registry) SetGatewayDependencyReady(dependency string, required bool, ready bool) {
	value := 0.0
	if ready {
		value = 1
	}
	r.SetGauge(GatewayDependencyReady, []Label{
		{Name: "dependency", Value: normalizeGatewayDependency(dependency)},
		{Name: "required", Value: strconv.FormatBool(required)},
	}, value)
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
	case "":
		return "failed"
	default:
		return "failed"
	}
}

func asyncLogLabels(operation string, status string) []Label {
	return []Label{
		{Name: "operation", Value: defaultLabelValue(operation)},
		{Name: "status", Value: defaultLabelValue(status)},
	}
}
func streamBaseLabels(provider string, model string) []Label {
	return []Label{
		{Name: "provider", Value: provider},
		{Name: "model", Value: model},
	}
}

func normalizeStreamOutcome(outcome string) string {
	trimmed := strings.TrimSpace(outcome)
	switch trimmed {
	case "completed", "interrupted", "cancelled":
		return trimmed
	default:
		return "interrupted"
	}
}

func normalizeAISafetySurface(surface string) string {
	switch strings.TrimSpace(surface) {
	case "gateway_v1", "tenant_chat":
		return strings.TrimSpace(surface)
	default:
		return "unknown"
	}
}

func normalizeAISafetyMode(mode string) string {
	switch strings.TrimSpace(mode) {
	case "shadow", "enforce":
		return strings.TrimSpace(mode)
	default:
		return "unknown"
	}
}

func normalizeAISafetyOutcome(outcome string) string {
	switch strings.TrimSpace(outcome) {
	case "passed", "redacted", "blocked", "timeout", "transport_error", "http_error", "invalid_response", "cancelled":
		return strings.TrimSpace(outcome)
	default:
		return "invalid_response"
	}
}

func normalizeAISafetyInferencePath(path string) string {
	switch strings.TrimSpace(path) {
	case "rules_only", "hybrid":
		return strings.TrimSpace(path)
	default:
		return "unknown"
	}
}

func normalizeAISafetyFallbackReason(reason string) string {
	switch strings.TrimSpace(reason) {
	case "timeout", "transport_error", "http_error", "invalid_response":
		return strings.TrimSpace(reason)
	default:
		return "invalid_response"
	}
}

func normalizeGatewayDependency(dependency string) string {
	switch strings.TrimSpace(dependency) {
	case "postgres", "postgres_log", "redis", "mock_provider", "control_plane", "ai_safety_sidecar":
		return strings.TrimSpace(dependency)
	default:
		return "unknown"
	}
}
