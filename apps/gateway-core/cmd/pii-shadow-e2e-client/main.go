package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	aiservice "gatelm/apps/gateway-core/internal/adapters/safety/aiservice"
	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
)

const (
	inputSchemaVersion  = "gatelm.pii-shadow-e2e-input.v1"
	outputSchemaVersion = "gatelm.pii-shadow-e2e-client.v1"
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
	SchemaVersion       string `json:"schemaVersion"`
	RequestCount        int    `json:"requestCount"`
	SampledRequestCount int    `json:"sampledRequestCount"`
	SuccessCount        int    `json:"successCount"`
	ErrorCount          int    `json:"errorCount"`
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
	sampleBasisPoints := flags.Int("sample-basis-points", 500, "sample rate in basis points")
	timeout := flags.Duration("timeout", 5*time.Second, "per-request timeout")
	if err := flags.Parse(args); err != nil {
		fmt.Fprintln(stderr, "FAIL: invalid PII Shadow E2E client arguments")
		return 2
	}
	if !validLoopbackEndpoint(*endpoint) || strings.TrimSpace(*tenantID) == "" {
		fmt.Fprintln(stderr, "FAIL: PII Shadow E2E client requires a loopback endpoint and tenant")
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
		SchemaVersion: outputSchemaVersion,
		RequestCount:  len(input.Items),
	}
	for index, item := range input.Items {
		requestID := fmt.Sprintf("pii-shadow-e2e-%06d", index)
		ctx := maskdomain.WithPIIShadowScope(context.Background(), *tenantID, requestID)
		if sampler.ShouldCapture(ctx) {
			output.SampledRequestCount++
		}
		if _, err := engine.Apply(ctx, maskdomain.ApplyRequest{Prompt: item.Prompt}); err != nil {
			output.ErrorCount++
			continue
		}
		output.SuccessCount++
	}
	if err := json.NewEncoder(stdout).Encode(output); err != nil {
		fmt.Fprintln(stderr, "FAIL: PII Shadow E2E client could not encode aggregate output")
		return 2
	}
	if output.ErrorCount != 0 {
		return 1
	}
	return 0
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
