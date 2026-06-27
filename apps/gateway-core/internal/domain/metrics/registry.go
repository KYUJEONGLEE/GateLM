package metrics

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
)

const (
	GatewayRequestsTotal             = "gatelm_gateway_requests_total"
	GatewayRequestDurationSeconds    = "gatelm_gateway_request_duration_seconds"
	GatewayInflightRequests          = "gatelm_gateway_inflight_requests"
	ProviderRequestsTotal            = "gatelm_provider_requests_total"
	ProviderRequestDurationSeconds   = "gatelm_provider_request_duration_seconds"
	CacheOperationsTotal             = "gatelm_cache_operations_total"
	RateLimitDecisionsTotal          = "gatelm_rate_limit_decisions_total"
	RateLimitDecisionDurationSeconds = "gatelm_rate_limit_decision_duration_seconds"
	MaskingActionsTotal              = "gatelm_masking_actions_total"
	LogWritesTotal                   = "gatelm_log_writes_total"
	LogWriteDurationSeconds          = "gatelm_log_write_duration_seconds"
	PrometheusTextContentType        = "text/plain; version=0.0.4; charset=utf-8"
)

var defaultDurationBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

type Label struct {
	Name  string
	Value string
}

type Registry struct {
	mu         sync.Mutex
	counters   map[seriesKey]float64
	gauges     map[seriesKey]float64
	histograms map[seriesKey]*histogramSeries
}

type seriesKey struct {
	name   string
	labels string
}

type histogramSeries struct {
	buckets []float64
	counts  []uint64
	count   uint64
	sum     float64
}

type metricSpec struct {
	typ  string
	help string
}

var metricSpecs = map[string]metricSpec{
	GatewayRequestsTotal:             {"counter", "Total Gateway requests by terminal outcome."},
	GatewayRequestDurationSeconds:    {"histogram", "Gateway request duration in seconds."},
	GatewayInflightRequests:          {"gauge", "Current in-flight Gateway requests."},
	ProviderRequestsTotal:            {"counter", "Total provider requests issued by Gateway."},
	ProviderRequestDurationSeconds:   {"histogram", "Provider request duration in seconds."},
	CacheOperationsTotal:             {"counter", "Total Gateway cache operations."},
	RateLimitDecisionsTotal:          {"counter", "Total Gateway rate limit decisions."},
	RateLimitDecisionDurationSeconds: {"histogram", "Gateway rate limit decision duration in seconds."},
	MaskingActionsTotal:              {"counter", "Total Gateway masking actions."},
	LogWritesTotal:                   {"counter", "Total invocation log writes."},
	LogWriteDurationSeconds:          {"histogram", "Invocation log write duration in seconds."},
}

var allowedLabels = map[string]struct{}{
	"endpoint":           {},
	"method":             {},
	"status":             {},
	"http_status":        {},
	"error_code":         {},
	"cache_status":       {},
	"cache_type":         {},
	"masking_action":     {},
	"rate_limit_allowed": {},
	"selected_provider":  {},
	"selected_model":     {},
	"operation":          {},
}

func NewRegistry() *Registry {
	return &Registry{
		counters:   map[seriesKey]float64{},
		gauges:     map[seriesKey]float64{},
		histograms: map[seriesKey]*histogramSeries{},
	}
}

func (r *Registry) AddCounter(name string, labels []Label, value float64) {
	if r == nil || value <= 0 || metricSpecs[name].typ != "counter" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.counters[newSeriesKey(name, labels)] += value
}

func (r *Registry) AddGauge(name string, labels []Label, delta float64) {
	if r == nil || metricSpecs[name].typ != "gauge" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.gauges[newSeriesKey(name, labels)] += delta
}

func (r *Registry) SetGauge(name string, labels []Label, value float64) {
	if r == nil || metricSpecs[name].typ != "gauge" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.gauges[newSeriesKey(name, labels)] = value
}

func (r *Registry) ObserveHistogram(name string, labels []Label, value float64) {
	if r == nil || metricSpecs[name].typ != "histogram" || value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	key := newSeriesKey(name, labels)
	series := r.histograms[key]
	if series == nil {
		series = &histogramSeries{
			buckets: append([]float64(nil), defaultDurationBuckets...),
			counts:  make([]uint64, len(defaultDurationBuckets)),
		}
		r.histograms[key] = series
	}
	for index, bucket := range series.buckets {
		if value <= bucket {
			series.counts[index]++
			break
		}
	}
	series.count++
	series.sum += value
}

func (r *Registry) RenderPrometheus() string {
	if r == nil {
		r = NewRegistry()
	}

	r.mu.Lock()
	counters := cloneFloatSeries(r.counters)
	gauges := cloneFloatSeries(r.gauges)
	histograms := cloneHistogramSeries(r.histograms)
	r.mu.Unlock()

	var builder strings.Builder
	names := metricNames()
	for _, name := range names {
		spec := metricSpecs[name]
		builder.WriteString("# HELP ")
		builder.WriteString(name)
		builder.WriteByte(' ')
		builder.WriteString(spec.help)
		builder.WriteByte('\n')
		builder.WriteString("# TYPE ")
		builder.WriteString(name)
		builder.WriteByte(' ')
		builder.WriteString(spec.typ)
		builder.WriteByte('\n')

		switch spec.typ {
		case "counter":
			writeFloatSamples(&builder, name, counters)
		case "gauge":
			writeFloatSamples(&builder, name, gauges)
		case "histogram":
			writeHistogramSamples(&builder, name, histograms)
		}
	}
	return builder.String()
}

func newSeriesKey(name string, labels []Label) seriesKey {
	return seriesKey{name: name, labels: canonicalLabels(labels)}
}

func canonicalLabels(labels []Label) string {
	filtered := make([]Label, 0, len(labels))
	for _, label := range labels {
		name := strings.TrimSpace(label.Name)
		if _, ok := allowedLabels[name]; !ok {
			continue
		}
		value := strings.TrimSpace(label.Value)
		if value == "" {
			value = "none"
		}
		filtered = append(filtered, Label{Name: name, Value: value})
	}
	sort.Slice(filtered, func(i int, j int) bool {
		return filtered[i].Name < filtered[j].Name
	})

	parts := make([]string, 0, len(filtered))
	for _, label := range filtered {
		parts = append(parts, label.Name+"="+label.Value)
	}
	return strings.Join(parts, "\xff")
}

func formatLabels(canonical string) string {
	if canonical == "" {
		return ""
	}
	parts := strings.Split(canonical, "\xff")
	formatted := make([]string, 0, len(parts))
	for _, part := range parts {
		name, value, ok := strings.Cut(part, "=")
		if !ok {
			continue
		}
		formatted = append(formatted, name+"=\""+escapeLabelValue(value)+"\"")
	}
	return "{" + strings.Join(formatted, ",") + "}"
}

func escapeLabelValue(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "\n", "\\n")
	value = strings.ReplaceAll(value, "\"", "\\\"")
	return value
}

func metricNames() []string {
	names := make([]string, 0, len(metricSpecs))
	for name := range metricSpecs {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func cloneFloatSeries(values map[seriesKey]float64) map[seriesKey]float64 {
	cloned := make(map[seriesKey]float64, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func cloneHistogramSeries(values map[seriesKey]*histogramSeries) map[seriesKey]histogramSeries {
	cloned := make(map[seriesKey]histogramSeries, len(values))
	for key, value := range values {
		if value == nil {
			continue
		}
		cloned[key] = histogramSeries{
			buckets: append([]float64(nil), value.buckets...),
			counts:  append([]uint64(nil), value.counts...),
			count:   value.count,
			sum:     value.sum,
		}
	}
	return cloned
}

func writeFloatSamples(builder *strings.Builder, metricName string, samples map[seriesKey]float64) {
	keys := sortedSeriesKeys(metricName, samples)
	for _, key := range keys {
		fmt.Fprintf(builder, "%s%s %s\n", metricName, formatLabels(key.labels), formatFloat(samples[key]))
	}
}

func writeHistogramSamples(builder *strings.Builder, metricName string, samples map[seriesKey]histogramSeries) {
	keys := sortedSeriesKeys(metricName, samples)
	for _, key := range keys {
		series := samples[key]
		var cumulative uint64
		for index, bucket := range series.buckets {
			cumulative += series.counts[index]
			labels := appendCanonicalLabel(key.labels, "le", formatFloat(bucket))
			fmt.Fprintf(builder, "%s_bucket%s %d\n", metricName, formatLabelsWithPrometheusInternal(labels), cumulative)
		}
		labels := appendCanonicalLabel(key.labels, "le", "+Inf")
		fmt.Fprintf(builder, "%s_bucket%s %d\n", metricName, formatLabelsWithPrometheusInternal(labels), series.count)
		fmt.Fprintf(builder, "%s_sum%s %s\n", metricName, formatLabels(key.labels), formatFloat(series.sum))
		fmt.Fprintf(builder, "%s_count%s %d\n", metricName, formatLabels(key.labels), series.count)
	}
}

func sortedSeriesKeys[T any](metricName string, samples map[seriesKey]T) []seriesKey {
	keys := make([]seriesKey, 0, len(samples))
	for key := range samples {
		if key.name == metricName {
			keys = append(keys, key)
		}
	}
	sort.Slice(keys, func(i int, j int) bool {
		return keys[i].labels < keys[j].labels
	})
	return keys
}

func appendCanonicalLabel(canonical string, name string, value string) string {
	extra := name + "=" + value
	if canonical == "" {
		return extra
	}
	return canonical + "\xff" + extra
}

func formatLabelsWithPrometheusInternal(canonical string) string {
	if canonical == "" {
		return ""
	}
	parts := strings.Split(canonical, "\xff")
	sort.Slice(parts, func(i int, j int) bool {
		left, _, _ := strings.Cut(parts[i], "=")
		right, _, _ := strings.Cut(parts[j], "=")
		return left < right
	})
	formatted := make([]string, 0, len(parts))
	for _, part := range parts {
		name, value, ok := strings.Cut(part, "=")
		if !ok {
			continue
		}
		formatted = append(formatted, name+"=\""+escapeLabelValue(value)+"\"")
	}
	return "{" + strings.Join(formatted, ",") + "}"
}

func formatFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}
