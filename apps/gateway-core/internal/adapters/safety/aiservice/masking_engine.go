package aiservice

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"slices"
	"sort"
	"strings"
	"time"

	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
	"gatelm/apps/gateway-core/internal/domain/metrics"
)

const (
	ContractVersion       = "ai-safety-detector.v1"
	BatchContractVersion  = "ai-safety-detector-batch.v1"
	DefaultModelID        = "openai/privacy-filter"
	DefaultRuntime        = "cpu_only"
	DefaultDetectorSet    = "privacy-filter-default"
	ModeShadow            = "shadow"
	ModeEnforce           = "enforce"
	DefaultMode           = ModeEnforce
	DefaultTimeout        = 750 * time.Millisecond
	maxBatchItems         = 64
	maxBatchResponseBytes = 16 * 1024 * 1024
)

const (
	sidecarReasonTimeout         = "timeout"
	sidecarReasonTransportError  = "transport_error"
	sidecarReasonHTTPError       = "http_error"
	sidecarReasonInvalidResponse = "invalid_response"
	sidecarReasonCancelled       = "cancelled"
)

type sidecarCallError struct {
	reason string
	cause  error
}

func (e *sidecarCallError) Error() string { return "ai safety sidecar call failed" }
func (e *sidecarCallError) Unwrap() error { return e.cause }

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
	Surface     string
	Metrics     *metrics.Registry
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
	surface     string
	metrics     *metrics.Registry
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
		surface:     config.Surface,
		metrics:     config.Metrics,
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
	startedAt := time.Now()
	sidecarResult, err := e.detect(ctx, sidecarRequest)
	if err != nil {
		reason := sidecarFailureReason(err)
		e.recordSidecarCall(startedAt, reason, "unknown")
		if reason == sidecarReasonCancelled {
			return maskdomain.Result{}, contextError(ctx, err)
		}
		e.recordSidecarFallback(reason)
		return localResult, nil
	}
	e.recordSidecarCall(startedAt, sidecarResult.Outcome, sidecarResult.ExecutionSummary.ExecutionMode)
	if e.mode == ModeShadow {
		return mergeSidecarShadowResult(localResult, sidecarResult), nil
	}
	return mergeSidecarResult(localResult, sidecarResult), nil
}

func (e MaskingEngine) ApplyBatch(
	ctx context.Context,
	requests []maskdomain.ApplyRequest,
) ([]maskdomain.Result, error) {
	if len(requests) == 0 {
		return []maskdomain.Result{}, nil
	}
	localResults := make([]maskdomain.Result, len(requests))
	hasLocalBlock := false
	for index, request := range requests {
		localResult, err := e.local.Apply(ctx, request)
		if err != nil {
			return nil, err
		}
		localResults[index] = localResult
		if localResult.Action == maskdomain.ActionBlocked {
			hasLocalBlock = true
		}
	}
	if hasLocalBlock || e.endpointURL == "" || len(requests) > maxBatchItems {
		return localResults, nil
	}
	policies := detectorPolicies(requests[0].DetectorPolicies)
	for _, request := range requests[1:] {
		if !slices.Equal(policies, detectorPolicies(request.DetectorPolicies)) {
			return localResults, nil
		}
	}

	inputs := make([]detectBatchInput, 0, len(localResults))
	originalIndexes := make([]int, 0, len(localResults))
	for originalIndex, localResult := range localResults {
		prompt := localResult.RedactedPrompt
		if strings.TrimSpace(prompt) == "" {
			prompt = localResult.LogSafePrompt
		}
		if strings.TrimSpace(prompt) == "" {
			continue
		}
		inputs = append(inputs, detectBatchInput{
			ItemIndex:  len(inputs),
			PromptText: prompt,
			Locale:     e.locale,
		})
		originalIndexes = append(originalIndexes, originalIndex)
	}
	if len(inputs) == 0 {
		return localResults, nil
	}

	startedAt := time.Now()
	sidecarResult, err := e.detectBatch(
		ctx,
		inputs,
		policies,
		placeholderCountersForRequests(requests),
	)
	if err != nil {
		reason := sidecarFailureReason(err)
		e.recordSidecarCall(startedAt, reason, "unknown")
		if reason == sidecarReasonCancelled {
			return nil, contextError(ctx, err)
		}
		e.recordSidecarFallback(reason)
		return localResults, nil
	}
	e.recordSidecarCall(
		startedAt,
		batchOutcome(sidecarResult.Results),
		sidecarResult.ExecutionSummary.ExecutionMode,
	)
	summary := &maskdomain.ExecutionSummary{
		ExecutionMode:               sidecarResult.ExecutionSummary.ExecutionMode,
		ModelInvocationCount:        sidecarResult.ExecutionSummary.ModelInvocationCount,
		AcceptedModelDetectionCount: sidecarResult.ExecutionSummary.AcceptedModelDetectionCount,
	}
	merged := append([]maskdomain.Result(nil), localResults...)
	for denseIndex, item := range sidecarResult.Results {
		originalIndex := originalIndexes[denseIndex]
		response := item.asDetectResponse()
		if e.mode == ModeShadow {
			merged[originalIndex] = mergeSidecarShadowResult(localResults[originalIndex], response)
		} else {
			merged[originalIndex] = mergeSidecarResult(localResults[originalIndex], response)
		}
		merged[originalIndex].ExecutionSummary = summary
	}
	return merged, nil
}

func (e MaskingEngine) detect(ctx context.Context, req maskdomain.ApplyRequest) (detectResponse, error) {
	prompt := req.Prompt
	if strings.TrimSpace(prompt) == "" {
		return detectResponse{}, newSidecarCallError(sidecarReasonInvalidResponse, nil)
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
		return detectResponse{}, newSidecarCallError(sidecarReasonInvalidResponse, err)
	}

	httpReq, err := http.NewRequestWithContext(callCtx, http.MethodPost, e.endpointURL, bytes.NewReader(payload))
	if err != nil {
		return detectResponse{}, newSidecarCallError(sidecarReasonInvalidResponse, err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	resp, err := e.httpClient.Do(httpReq)
	if err != nil {
		return detectResponse{}, classifySidecarTransportError(ctx, callCtx, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return detectResponse{}, newSidecarCallError(sidecarReasonHTTPError, nil)
	}

	var decoded detectResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1024*1024)).Decode(&decoded); err != nil {
		return detectResponse{}, newSidecarCallError(sidecarReasonInvalidResponse, err)
	}
	if decoded.ContractVersion != ContractVersion {
		return detectResponse{}, newSidecarCallError(sidecarReasonInvalidResponse, nil)
	}
	if !validResponseModel(decoded.Model, e.modelID) {
		return detectResponse{}, newSidecarCallError(sidecarReasonInvalidResponse, nil)
	}
	if decoded.Mode != e.mode {
		return detectResponse{}, newSidecarCallError(sidecarReasonInvalidResponse, nil)
	}
	if strings.TrimSpace(decoded.LogSafePrompt) == "" {
		return detectResponse{}, newSidecarCallError(sidecarReasonInvalidResponse, nil)
	}
	if !validExecutionSummary(decoded.ExecutionSummary) {
		return detectResponse{}, newSidecarCallError(sidecarReasonInvalidResponse, nil)
	}
	if validResponseOutcome(decoded.Outcome, decoded.RedactedPrompt) {
		return decoded, nil
	}
	return detectResponse{}, newSidecarCallError(sidecarReasonInvalidResponse, nil)
}

func (e MaskingEngine) detectBatch(
	ctx context.Context,
	inputs []detectBatchInput,
	policies []detectPolicy,
	placeholderCounters map[string]int,
) (detectBatchResponse, error) {
	callCtx, cancel := context.WithTimeout(ctx, e.timeout)
	defer cancel()
	payload, err := json.Marshal(detectBatchRequest{
		ContractVersion: BatchContractVersion,
		Mode:            e.mode,
		Model: detectModel{
			ModelID: e.modelID,
			Runtime: DefaultRuntime,
		},
		Inputs:              inputs,
		PlaceholderCounters: placeholderCounters,
		DetectorConfig: detectConfig{
			DetectorSet:      e.detectorSet,
			ReturnConfidence: false,
			DetectorPolicies: policies,
		},
	})
	if err != nil {
		return detectBatchResponse{}, newSidecarCallError(sidecarReasonInvalidResponse, err)
	}

	endpointURL := strings.TrimRight(e.endpointURL, "/") + "/batch"
	httpReq, err := http.NewRequestWithContext(
		callCtx,
		http.MethodPost,
		endpointURL,
		bytes.NewReader(payload),
	)
	if err != nil {
		return detectBatchResponse{}, newSidecarCallError(sidecarReasonInvalidResponse, err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	resp, err := e.httpClient.Do(httpReq)
	if err != nil {
		return detectBatchResponse{}, classifySidecarTransportError(ctx, callCtx, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return detectBatchResponse{}, newSidecarCallError(sidecarReasonHTTPError, nil)
	}
	var decoded detectBatchResponse
	decoder := json.NewDecoder(io.LimitReader(resp.Body, maxBatchResponseBytes))
	if err := decoder.Decode(&decoded); err != nil {
		return detectBatchResponse{}, newSidecarCallError(sidecarReasonInvalidResponse, err)
	}
	if !validBatchResponse(decoded, len(inputs), e.mode, e.modelID) {
		return detectBatchResponse{}, newSidecarCallError(sidecarReasonInvalidResponse, nil)
	}
	return decoded, nil
}

func newSidecarCallError(reason string, cause error) error {
	return &sidecarCallError{reason: reason, cause: cause}
}

func classifySidecarTransportError(parentCtx context.Context, callCtx context.Context, cause error) error {
	if parentCtx.Err() != nil {
		return newSidecarCallError(sidecarReasonCancelled, parentCtx.Err())
	}
	var networkError net.Error
	if errors.Is(callCtx.Err(), context.DeadlineExceeded) ||
		errors.Is(cause, context.DeadlineExceeded) ||
		(errors.As(cause, &networkError) && networkError.Timeout()) {
		return newSidecarCallError(sidecarReasonTimeout, cause)
	}
	return newSidecarCallError(sidecarReasonTransportError, cause)
}

func sidecarFailureReason(err error) string {
	var callErr *sidecarCallError
	if !errors.As(err, &callErr) {
		return sidecarReasonInvalidResponse
	}
	switch callErr.reason {
	case sidecarReasonTimeout,
		sidecarReasonTransportError,
		sidecarReasonHTTPError,
		sidecarReasonInvalidResponse,
		sidecarReasonCancelled:
		return callErr.reason
	default:
		return sidecarReasonInvalidResponse
	}
}

func contextError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return context.Canceled
}

func (e MaskingEngine) recordSidecarCall(startedAt time.Time, outcome string, inferencePath string) {
	if e.metrics == nil {
		return
	}
	e.metrics.RecordAISafetySidecarCall(metrics.AISafetySidecarCall{
		Surface:         e.surface,
		Mode:            e.mode,
		Outcome:         outcome,
		InferencePath:   inferencePath,
		DurationSeconds: time.Since(startedAt).Seconds(),
	})
}

func (e MaskingEngine) recordSidecarFallback(reason string) {
	if e.metrics == nil || reason == sidecarReasonCancelled {
		return
	}
	e.metrics.RecordAISafetySidecarFallback(metrics.AISafetySidecarFallback{
		Surface: e.surface,
		Mode:    e.mode,
		Reason:  reason,
	})
}

func batchOutcome(results []detectBatchResult) string {
	outcome := "passed"
	for _, result := range results {
		switch result.Outcome {
		case "blocked":
			return "blocked"
		case "redacted":
			outcome = "redacted"
		}
	}
	return outcome
}

func validBatchResponse(
	response detectBatchResponse,
	expectedItems int,
	expectedMode string,
	expectedModelID string,
) bool {
	if response.ContractVersion != BatchContractVersion || response.Mode != expectedMode {
		return false
	}
	if !validResponseModel(response.Model, expectedModelID) {
		return false
	}
	if len(response.Results) != expectedItems {
		return false
	}
	for index, item := range response.Results {
		if item.ItemIndex != index || strings.TrimSpace(item.LogSafePrompt) == "" {
			return false
		}
		if !validResponseOutcome(item.Outcome, item.RedactedPrompt) {
			return false
		}
	}
	return validExecutionSummary(response.ExecutionSummary)
}

func validResponseModel(model detectModel, expectedModelID string) bool {
	return model.ModelID == expectedModelID && model.Runtime == DefaultRuntime
}

func validResponseOutcome(outcome string, redactedPrompt string) bool {
	switch outcome {
	case "passed", "blocked":
		return true
	case "redacted":
		return strings.TrimSpace(redactedPrompt) != ""
	default:
		return false
	}
}

func validExecutionSummary(summary detectExecutionSummary) bool {
	if summary.ModelInvocationCount < 0 || summary.AcceptedModelDetectionCount < 0 {
		return false
	}
	switch summary.ExecutionMode {
	case "rules_only":
		return summary.ModelInvocationCount == 0 && summary.AcceptedModelDetectionCount == 0
	case "hybrid":
		return summary.ModelInvocationCount > 0
	default:
		return false
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
	result.ExecutionSummary = &maskdomain.ExecutionSummary{
		ExecutionMode:               sidecar.ExecutionSummary.ExecutionMode,
		ModelInvocationCount:        sidecar.ExecutionSummary.ModelInvocationCount,
		AcceptedModelDetectionCount: sidecar.ExecutionSummary.AcceptedModelDetectionCount,
	}
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

type detectBatchRequest struct {
	ContractVersion     string             `json:"contractVersion"`
	Mode                string             `json:"mode"`
	Model               detectModel        `json:"model"`
	Inputs              []detectBatchInput `json:"inputs"`
	PlaceholderCounters map[string]int     `json:"placeholderCounters,omitempty"`
	DetectorConfig      detectConfig       `json:"detectorConfig"`
}

func placeholderCountersForRequests(requests []maskdomain.ApplyRequest) map[string]int {
	var merged map[string]int
	for _, request := range requests {
		for prefix, count := range request.EntityScope.PlaceholderCounters() {
			if count <= 0 || count <= merged[prefix] {
				continue
			}
			if merged == nil {
				merged = make(map[string]int)
			}
			merged[prefix] = count
		}
	}
	return merged
}

type detectBatchInput struct {
	ItemIndex  int    `json:"itemIndex"`
	PromptText string `json:"promptText"`
	Locale     string `json:"locale,omitempty"`
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
	ContractVersion       string                 `json:"contractVersion"`
	Model                 detectModel            `json:"model"`
	Outcome               string                 `json:"outcome"`
	Mode                  string                 `json:"mode"`
	RedactedPrompt        string                 `json:"redactedPrompt"`
	LogSafePrompt         string                 `json:"logSafePrompt"`
	RedactedPromptPreview string                 `json:"redactedPromptPreview"`
	DetectorSummary       detectDetectorSummary  `json:"detectorSummary"`
	Detections            []detectDetection      `json:"detections"`
	ExecutionSummary      detectExecutionSummary `json:"executionSummary"`
	LatencyMs             int                    `json:"latencyMs"`
}

type detectBatchResponse struct {
	ContractVersion  string                 `json:"contractVersion"`
	Model            detectModel            `json:"model"`
	Mode             string                 `json:"mode"`
	Results          []detectBatchResult    `json:"results"`
	ExecutionSummary detectExecutionSummary `json:"executionSummary"`
	LatencyMs        int                    `json:"latencyMs"`
}

type detectBatchResult struct {
	ItemIndex             int                   `json:"itemIndex"`
	Outcome               string                `json:"outcome"`
	RedactedPrompt        string                `json:"redactedPrompt"`
	LogSafePrompt         string                `json:"logSafePrompt"`
	RedactedPromptPreview string                `json:"redactedPromptPreview"`
	DetectorSummary       detectDetectorSummary `json:"detectorSummary"`
	Detections            []detectDetection     `json:"detections"`
}

func (r detectBatchResult) asDetectResponse() detectResponse {
	return detectResponse{
		Outcome:               r.Outcome,
		RedactedPrompt:        r.RedactedPrompt,
		LogSafePrompt:         r.LogSafePrompt,
		RedactedPromptPreview: r.RedactedPromptPreview,
		DetectorSummary:       r.DetectorSummary,
		Detections:            r.Detections,
	}
}

type detectExecutionSummary struct {
	ExecutionMode               string `json:"executionMode"`
	ModelInvocationCount        int    `json:"modelInvocationCount"`
	AcceptedModelDetectionCount int    `json:"acceptedModelDetectionCount"`
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
