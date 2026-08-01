package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"

	aiservice "gatelm/apps/gateway-core/internal/adapters/safety/aiservice"
	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
)

const (
	inputSchemaVersion  = "gatelm.pii-shadow-e2e-input.v1"
	outputSchemaVersion = "gatelm.pii-shadow-e2e-client.v2"
	maximumInputBytes   = 4 * 1024 * 1024
	maximumRequests     = 5_000
)

type inputEnvelope struct {
	SchemaVersion string      `json:"schemaVersion"`
	Items         []inputItem `json:"items"`
}

type inputItem struct {
	Prompt string `json:"prompt"`
}

type outputEnvelope struct {
	SchemaVersion                          string         `json:"schemaVersion"`
	RequestCount                           int            `json:"requestCount"`
	SampledRequestCount                    int            `json:"sampledRequestCount"`
	DeterministicReplaySampledRequestCount int            `json:"deterministicReplaySampledRequestCount"`
	SuccessCount                           int            `json:"successCount"`
	ErrorCount                             int            `json:"errorCount"`
	ControlRequestCount                    int            `json:"controlRequestCount"`
	ControlSampledRequestCount             int            `json:"controlSampledRequestCount"`
	ControlSuccessCount                    int            `json:"controlSuccessCount"`
	ControlErrorCount                      int            `json:"controlErrorCount"`
	RequestLatencyMs                       latencySummary `json:"requestLatencyMs"`
	SampledRequestLatencyMs                latencySummary `json:"sampledRequestLatencyMs"`
	NonSampledRequestLatencyMs             latencySummary `json:"nonSampledRequestLatencyMs"`
}

type latencySummary struct {
	Count int     `json:"count"`
	P50   float64 `json:"p50"`
	P95   float64 `json:"p95"`
	P99   float64 `json:"p99"`
	Max   float64 `json:"max"`
}

type passthroughMaskingEngine struct{}

func (passthroughMaskingEngine) Apply(
	_ context.Context,
	req maskdomain.ApplyRequest,
) (maskdomain.Result, error) {
	return maskdomain.Result{
		Action:                  maskdomain.ActionNone,
		RedactedPrompt:          req.Prompt,
		LogSafePrompt:           req.Prompt,
		SecurityPolicyVersionID: "pii-shadow-e2e-synthetic",
	}, nil
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

func run(args []string, stdin io.Reader, stdout io.Writer, stderr io.Writer) int {
	flags := flag.NewFlagSet("pii-shadow-e2e-client", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	endpoint := flags.String("endpoint", "", "loopback AI Safety detect endpoint")
	tenantID := flags.String("tenant-id", "pii-shadow-e2e-tenant", "synthetic tenant id")
	controlTenantID := flags.String(
		"control-tenant-id",
		"pii-shadow-e2e-control-tenant",
		"non-allowlisted control tenant id",
	)
	sampleBasisPoints := flags.Int("sample-basis-points", 500, "sample rate in basis points")
	timeout := flags.Duration("timeout", 5*time.Second, "per-request timeout")
	if err := flags.Parse(args); err != nil {
		fmt.Fprintln(stderr, "FAIL: invalid PII Shadow E2E client arguments")
		return 2
	}
	if !validLoopbackEndpoint(*endpoint) || strings.TrimSpace(*tenantID) == "" ||
		strings.TrimSpace(*controlTenantID) == "" || strings.TrimSpace(*controlTenantID) == strings.TrimSpace(*tenantID) {
		fmt.Fprintln(stderr, "FAIL: PII Shadow E2E client requires distinct allowlisted and control tenants")
		return 2
	}
	if *sampleBasisPoints < 1 || *sampleBasisPoints > maskdomain.PIIShadowSampleScale {
		fmt.Fprintln(stderr, "FAIL: invalid PII Shadow sample rate")
		return 2
	}
	if *timeout <= 0 || *timeout > 30*time.Second {
		fmt.Fprintln(stderr, "FAIL: invalid PII Shadow request timeout")
		return 2
	}

	var input inputEnvelope
	decoder := json.NewDecoder(io.LimitReader(stdin, maximumInputBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || input.SchemaVersion != inputSchemaVersion {
		fmt.Fprintln(stderr, "FAIL: invalid PII Shadow synthetic input")
		return 2
	}
	if len(input.Items) < 1 || len(input.Items) > maximumRequests {
		fmt.Fprintln(stderr, "FAIL: invalid PII Shadow request count")
		return 2
	}
	for _, item := range input.Items {
		if strings.TrimSpace(item.Prompt) == "" {
			fmt.Fprintln(stderr, "FAIL: empty PII Shadow synthetic input")
			return 2
		}
	}

	sampler := maskdomain.NewPIIShadowSampler(
		true,
		[]string{*tenantID},
		*sampleBasisPoints,
	)
	engine := aiservice.NewMaskingEngine(aiservice.MaskingEngineConfig{
		Local:                      passthroughMaskingEngine{},
		EndpointURL:                *endpoint,
		HTTPClient:                 &http.Client{Timeout: *timeout},
		Timeout:                    *timeout,
		ModelID:                    "gatelm/koelectra-small-v3-pii-ner",
		DetectorSet:                "gatelm-koelectra-pii-ner-v1",
		Locale:                     "ko-KR",
		Mode:                       aiservice.ModeEnforce,
		OverloadPolicy:             aiservice.OverloadPolicyFailClosed,
		PIIShadowEnabled:           true,
		PIIShadowAllowedTenantIDs:  []string{*tenantID},
		PIIShadowSampleBasisPoints: *sampleBasisPoints,
	})

	output := outputEnvelope{
		SchemaVersion:       outputSchemaVersion,
		RequestCount:        len(input.Items),
		ControlRequestCount: 1,
	}
	requestLatencies := make([]float64, 0, len(input.Items))
	sampledRequestLatencies := make([]float64, 0, len(input.Items))
	nonSampledRequestLatencies := make([]float64, 0, len(input.Items))
	for index, item := range input.Items {
		requestID := fmt.Sprintf("pii-shadow-e2e-%06d", index)
		ctx := maskdomain.WithPIIShadowScope(context.Background(), *tenantID, requestID)
		sampled := sampler.ShouldCapture(ctx)
		if sampled {
			output.SampledRequestCount++
		}
		if sampler.ShouldCapture(ctx) {
			output.DeterministicReplaySampledRequestCount++
		}
		started := time.Now()
		_, err := engine.Apply(ctx, maskdomain.ApplyRequest{Prompt: item.Prompt})
		latencyMs := float64(time.Since(started).Microseconds()) / 1000
		requestLatencies = append(requestLatencies, latencyMs)
		if sampled {
			sampledRequestLatencies = append(sampledRequestLatencies, latencyMs)
		} else {
			nonSampledRequestLatencies = append(nonSampledRequestLatencies, latencyMs)
		}
		if err != nil {
			output.ErrorCount++
			continue
		}
		output.SuccessCount++
	}
	controlContext := maskdomain.WithPIIShadowScope(
		context.Background(),
		*controlTenantID,
		"pii-shadow-e2e-control-000000",
	)
	if sampler.ShouldCapture(controlContext) {
		output.ControlSampledRequestCount++
	}
	if _, err := engine.Apply(controlContext, maskdomain.ApplyRequest{Prompt: input.Items[0].Prompt}); err != nil {
		output.ControlErrorCount++
	} else {
		output.ControlSuccessCount++
	}
	output.RequestLatencyMs = summarizeLatencies(requestLatencies)
	output.SampledRequestLatencyMs = summarizeLatencies(sampledRequestLatencies)
	output.NonSampledRequestLatencyMs = summarizeLatencies(nonSampledRequestLatencies)
	if err := json.NewEncoder(stdout).Encode(output); err != nil {
		fmt.Fprintln(stderr, "FAIL: PII Shadow E2E client could not encode aggregate output")
		return 2
	}
	if output.ErrorCount != 0 || output.ControlErrorCount != 0 ||
		output.ControlSampledRequestCount != 0 ||
		output.SampledRequestCount != output.DeterministicReplaySampledRequestCount {
		return 1
	}
	return 0
}

func summarizeLatencies(values []float64) latencySummary {
	if len(values) == 0 {
		return latencySummary{}
	}
	ordered := append([]float64(nil), values...)
	slices.Sort(ordered)
	return latencySummary{
		Count: len(ordered),
		P50:   nearestRank(ordered, 0.50),
		P95:   nearestRank(ordered, 0.95),
		P99:   nearestRank(ordered, 0.99),
		Max:   ordered[len(ordered)-1],
	}
}

func nearestRank(ordered []float64, percentile float64) float64 {
	index := int(math.Ceil(float64(len(ordered))*percentile)) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(ordered) {
		index = len(ordered) - 1
	}
	return ordered[index]
}

func validLoopbackEndpoint(value string) bool {
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.Scheme != "http" || parsed.Host == "" {
		return false
	}
	host := parsed.Hostname()
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
