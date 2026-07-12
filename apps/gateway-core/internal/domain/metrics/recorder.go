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

type StreamRelay struct {
	SelectedProvider string
	SelectedModel    string
	Outcome          string
	ErrorCode        string
	DurationSeconds  float64
}

type StreamTimeToFirstToken struct {
	SelectedProvider string
	SelectedModel    string
	DurationSeconds  float64
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
func (r *Registry) StreamStarted(selectedProvider string, selectedModel string) {
	r.AddGauge(StreamsActive, streamBaseLabels(selectedProvider, selectedModel), 1)
}

func (r *Registry) StreamFinished(relay StreamRelay) {
	baseLabels := streamBaseLabels(relay.SelectedProvider, relay.SelectedModel)
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
		streamBaseLabels(ttft.SelectedProvider, ttft.SelectedModel),
		ttft.DurationSeconds,
	)
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
func streamBaseLabels(selectedProvider string, selectedModel string) []Label {
	return []Label{
		{Name: "selected_provider", Value: selectedProvider},
		{Name: "selected_model", Value: selectedModel},
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
