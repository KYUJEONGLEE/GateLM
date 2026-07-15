package aiservice

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
)

const (
	ContractVersion    = "ai-safety-detector.v1"
	DefaultModelID     = "openai/privacy-filter"
	DefaultRuntime     = "cpu_only"
	DefaultDetectorSet = "privacy-filter-default"
	ModeShadow         = "shadow"
	ModeEnforce        = "enforce"
	DefaultMode        = ModeEnforce
	DefaultTimeout     = 750 * time.Millisecond
)

var errSidecarUnavailable = errors.New("ai safety sidecar unavailable")

type LocalMaskingEngine interface {
	Apply(ctx context.Context, req maskdomain.ApplyRequest) (maskdomain.Result, error)
}

type MaskingEngineConfig struct {
	Local       LocalMaskingEngine
	EndpointURL string
	HTTPClient  *http.Client
	Timeout     time.Duration
	ModelID     string
	DetectorSet string
	Locale      string
	Mode        string
}

type MaskingEngine struct {
	local       LocalMaskingEngine
	endpointURL string
	httpClient  *http.Client
	timeout     time.Duration
	modelID     string
	detectorSet string
	locale      string
	mode        string
}

func NewMaskingEngine(config MaskingEngineConfig) MaskingEngine {
	local := config.Local
	if local == nil {
		local = maskdomain.NewP0Engine()
	}
	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	timeout := config.Timeout
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	modelID := strings.TrimSpace(config.ModelID)
	if modelID == "" {
		modelID = DefaultModelID
	}
	detectorSet := strings.TrimSpace(config.DetectorSet)
	if detectorSet == "" {
		detectorSet = DefaultDetectorSet
	}
	return MaskingEngine{
		local:       local,
		endpointURL: strings.TrimSpace(config.EndpointURL),
		httpClient:  httpClient,
		timeout:     timeout,
		modelID:     modelID,
		detectorSet: detectorSet,
		locale:      strings.TrimSpace(config.Locale),
		mode:        maskingMode(config.Mode),
	}
}

func (e MaskingEngine) Apply(ctx context.Context, req maskdomain.ApplyRequest) (maskdomain.Result, error) {
	localResult, err := e.local.Apply(ctx, req)
	if err != nil {
		return maskdomain.Result{}, err
	}
	if localResult.Action == maskdomain.ActionBlocked || e.endpointURL == "" {
		return localResult, nil
	}

	sidecarRequest := req
	if strings.TrimSpace(localResult.RedactedPrompt) != "" {
		sidecarRequest.Prompt = localResult.RedactedPrompt
	}
	sidecarResult, err := e.detect(ctx, sidecarRequest)
	if err != nil {
		return localResult, nil
	}
	if e.mode == ModeShadow {
		return mergeSidecarShadowResult(localResult, sidecarResult), nil
	}
	return mergeSidecarResult(localResult, sidecarResult), nil
}

func (e MaskingEngine) detect(ctx context.Context, req maskdomain.ApplyRequest) (detectResponse, error) {
	prompt := req.Prompt
	if strings.TrimSpace(prompt) == "" {
		return detectResponse{}, errSidecarUnavailable
	}
	callCtx, cancel := context.WithTimeout(ctx, e.timeout)
	defer cancel()

	payload, err := json.Marshal(detectRequest{
		ContractVersion: ContractVersion,
		Mode:            e.mode,
		Model: detectModel{
			ModelID: e.modelID,
			Runtime: DefaultRuntime,
		},
		Input: detectInput{
			PromptText: prompt,
			Locale:     e.locale,
		},
		DetectorConfig: detectConfig{
			DetectorSet:      e.detectorSet,
			ReturnConfidence: false,
			DetectorPolicies: detectorPolicies(req.DetectorPolicies),
		},
	})
	if err != nil {
		return detectResponse{}, errSidecarUnavailable
	}

	httpReq, err := http.NewRequestWithContext(callCtx, http.MethodPost, e.endpointURL, bytes.NewReader(payload))
	if err != nil {
		return detectResponse{}, errSidecarUnavailable
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	resp, err := e.httpClient.Do(httpReq)
	if err != nil {
		return detectResponse{}, errSidecarUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return detectResponse{}, errSidecarUnavailable
	}

	var decoded detectResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1024*1024)).Decode(&decoded); err != nil {
		return detectResponse{}, errSidecarUnavailable
	}
	if decoded.ContractVersion != ContractVersion {
		return detectResponse{}, errSidecarUnavailable
	}
	if decoded.Mode != e.mode {
		return detectResponse{}, errSidecarUnavailable
	}
	if strings.TrimSpace(decoded.LogSafePrompt) == "" {
		return detectResponse{}, errSidecarUnavailable
	}
	switch decoded.Outcome {
	case "passed", "redacted", "blocked":
		return decoded, nil
	default:
		return detectResponse{}, errSidecarUnavailable
	}
}

func maskingMode(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), ModeShadow) {
		return ModeShadow
	}
	return ModeEnforce
}

func mergeSidecarShadowResult(local maskdomain.Result, sidecar detectResponse) maskdomain.Result {
	return mergeSidecarObservation(local, sidecar)
}

func mergeSidecarResult(local maskdomain.Result, sidecar detectResponse) maskdomain.Result {
	if sidecar.Outcome == "passed" {
		return mergeSidecarObservation(local, sidecar)
	}

	action := local.Action
	switch sidecar.Outcome {
	case "blocked":
		action = maskdomain.ActionBlocked
	case "redacted":
		if action != maskdomain.ActionBlocked {
			action = maskdomain.ActionRedacted
		}
	}

	redactedPrompt := strings.TrimSpace(sidecar.RedactedPrompt)
	if redactedPrompt == "" {
		redactedPrompt = local.RedactedPrompt
	}
	if redactedPrompt == "" {
		redactedPrompt = local.LogSafePrompt
	}
	detectedTypes := mergeDetectorTypes(local.DetectedTypes, sidecar.detectorCategories())
	detectedCount := sidecar.DetectorSummary.DetectedCount
	if detectedCount < local.DetectedCount {
		detectedCount = local.DetectedCount
	}
	if detectedCount < len(detectedTypes) {
		detectedCount = len(detectedTypes)
	}

	result := maskdomain.Result{
		Action:                  action,
		DetectedTypes:           detectedTypes,
		DetectedCount:           detectedCount,
		PolicyAllowedTypes:      append([]string(nil), local.PolicyAllowedTypes...),
		PolicyAllowedCount:      local.PolicyAllowedCount,
		MandatoryProtectedTypes: append([]string(nil), local.MandatoryProtectedTypes...),
		RedactedPrompt:          redactedPrompt,
		SecurityPolicyVersionID: local.SecurityPolicyVersionID,
	}
	return withSidecarLogSafe(result, sidecar)
}

func mergeSidecarObservation(local maskdomain.Result, sidecar detectResponse) maskdomain.Result {
	detectedTypes := mergeDetectorTypes(local.DetectedTypes, sidecar.detectorCategories())
	if len(detectedTypes) > 0 {
		detectedCount := sidecar.DetectorSummary.DetectedCount
		if detectedCount < local.DetectedCount {
			detectedCount = local.DetectedCount
		}
		if detectedCount < len(detectedTypes) {
			detectedCount = len(detectedTypes)
		}
		local.DetectedTypes = detectedTypes
		local.DetectedCount = detectedCount
	}
	return withSidecarLogSafe(local, sidecar)
}

func withSidecarLogSafe(result maskdomain.Result, sidecar detectResponse) maskdomain.Result {
	result.LogSafePrompt = strings.TrimSpace(sidecar.LogSafePrompt)
	preview := strings.TrimSpace(sidecar.RedactedPromptPreview)
	if preview == "" {
		preview = maskdomain.PreviewRedactedPrompt(result.LogSafePrompt)
	}
	result.RedactedPromptPreview = preview
	return result
}

func mergeDetectorTypes(groups ...[]string) []string {
	seen := map[string]struct{}{}
	for _, group := range groups {
		for _, value := range group {
			value = strings.TrimSpace(value)
			if value == "" {
				continue
			}
			seen[value] = struct{}{}
		}
	}
	if len(seen) == 0 {
		return nil
	}
	values := make([]string, 0, len(seen))
	for value := range seen {
		values = append(values, value)
	}
	sort.Strings(values)
	return values
}

type detectRequest struct {
	ContractVersion string       `json:"contractVersion"`
	Mode            string       `json:"mode"`
	Model           detectModel  `json:"model"`
	Input           detectInput  `json:"input"`
	DetectorConfig  detectConfig `json:"detectorConfig"`
}

type detectModel struct {
	ModelID string `json:"modelId"`
	Runtime string `json:"runtime"`
}

type detectInput struct {
	PromptText string `json:"promptText"`
	Locale     string `json:"locale,omitempty"`
}

type detectConfig struct {
	DetectorSet      string         `json:"detectorSet"`
	ReturnConfidence bool           `json:"returnConfidence"`
	DetectorPolicies []detectPolicy `json:"detectorPolicies,omitempty"`
}

type detectPolicy struct {
	DetectorType string `json:"detectorType"`
	Action       string `json:"action"`
}

func detectorPolicies(policies []maskdomain.DetectorPolicy) []detectPolicy {
	if len(policies) == 0 {
		return nil
	}
	result := make([]detectPolicy, 0, len(policies))
	for _, policy := range policies {
		detectorType := strings.TrimSpace(policy.DetectorType)
		action := strings.TrimSpace(string(policy.Action))
		if detectorType == "" {
			continue
		}
		switch maskdomain.PolicyAction(action) {
		case maskdomain.PolicyActionAllow, maskdomain.PolicyActionRedact, maskdomain.PolicyActionBlock:
			result = append(result, detectPolicy{DetectorType: detectorType, Action: action})
		}
	}
	return result
}

type detectResponse struct {
	ContractVersion       string                `json:"contractVersion"`
	Model                 detectModel           `json:"model"`
	Outcome               string                `json:"outcome"`
	Mode                  string                `json:"mode"`
	RedactedPrompt        string                `json:"redactedPrompt"`
	LogSafePrompt         string                `json:"logSafePrompt"`
	RedactedPromptPreview string                `json:"redactedPromptPreview"`
	DetectorSummary       detectDetectorSummary `json:"detectorSummary"`
	Detections            []detectDetection     `json:"detections"`
	LatencyMs             int                   `json:"latencyMs"`
}

func (r detectResponse) detectorCategories() []string {
	categories := append([]string(nil), r.DetectorSummary.DetectorCategories...)
	for _, detection := range r.Detections {
		categories = append(categories, detection.DetectorType)
	}
	return mergeDetectorTypes(categories)
}

type detectDetectorSummary struct {
	DetectedCount      int      `json:"detectedCount"`
	DetectorCategories []string `json:"detectorCategories"`
}

type detectDetection struct {
	DetectorType string  `json:"detectorType"`
	Source       string  `json:"source"`
	Confidence   float64 `json:"confidence,omitempty"`
	Action       string  `json:"action"`
	Mode         string  `json:"mode"`
}
