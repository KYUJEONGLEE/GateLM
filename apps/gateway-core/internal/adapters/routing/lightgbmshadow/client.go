package lightgbmshadow

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	routingdomain "gatelm/apps/gateway-core/internal/domain/routing"
)

const (
	ContractVersion          = "gatelm.internal.routing-difficulty-lightgbm-shadow.v1"
	RuleVectorVersion        = "difficulty-feature-vector.v1"
	ServiceTokenHeader       = "X-GateLM-AI-Service-Token"
	DefaultTimeout           = 500 * time.Millisecond
	DefaultMaximumConcurrent = 4
	maximumResponseBytes     = 4096
)

var (
	modelVersionPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,159}$`)
	contentHashPattern  = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
)

type Config struct {
	EndpointURL       string
	ServiceToken      string
	ModelVersion      string
	ModelContentHash  string
	HTTPClient        *http.Client
	Timeout           time.Duration
	MaximumConcurrent int
}

// Client is an isolated, non-authoritative shadow evaluator. Request-derived
// text and vectors exist only in the bounded request body and are never logged.
type Client struct {
	endpointURL      string
	serviceToken     string
	modelVersion     string
	modelContentHash string
	httpClient       *http.Client
	timeout          time.Duration
	gate             chan struct{}
	closed           atomic.Bool
}

func NewClient(config Config) (*Client, error) {
	endpointURL := strings.TrimSpace(config.EndpointURL)
	parsed, err := url.Parse(endpointURL)
	if err != nil || parsed.Hostname() == "" ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
		return nil, errors.New("LightGBM shadow endpoint is invalid")
	}
	serviceToken := strings.TrimSpace(config.ServiceToken)
	if serviceToken == "" {
		return nil, errors.New("LightGBM shadow service token is required")
	}
	modelVersion := strings.TrimSpace(config.ModelVersion)
	modelContentHash := strings.TrimSpace(config.ModelContentHash)
	if !modelVersionPattern.MatchString(modelVersion) || !contentHashPattern.MatchString(modelContentHash) {
		return nil, errors.New("LightGBM shadow model identity is invalid")
	}
	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	timeout := config.Timeout
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	maximumConcurrent := config.MaximumConcurrent
	if maximumConcurrent <= 0 {
		maximumConcurrent = DefaultMaximumConcurrent
	}
	return &Client{
		endpointURL:      endpointURL,
		serviceToken:     serviceToken,
		modelVersion:     modelVersion,
		modelContentHash: modelContentHash,
		httpClient:       httpClient,
		timeout:          timeout,
		gate:             make(chan struct{}, maximumConcurrent),
	}, nil
}

func (client *Client) Evaluate(
	ctx context.Context,
	features routingdomain.PromptFeatures,
	category string,
) routingdomain.DifficultySemanticShadowResult {
	if client == nil || client.closed.Load() {
		return statusResult(routingdomain.DifficultySemanticShadowUnavailable)
	}
	remoteInput, ok := routingdomain.BuildDifficultyRemoteInput(features, category)
	if !ok {
		return statusResult(routingdomain.DifficultySemanticShadowNotApplicable)
	}
	select {
	case client.gate <- struct{}{}:
		defer func() { <-client.gate }()
	default:
		return statusResult(routingdomain.DifficultySemanticShadowBusy)
	}
	if ctx == nil {
		ctx = context.Background()
	}
	callCtx, cancel := context.WithTimeout(ctx, client.timeout)
	defer cancel()
	payload, err := json.Marshal(classifyRequest{
		ContractVersion:   ContractVersion,
		ModelVersion:      client.modelVersion,
		ModelContentHash:  client.modelContentHash,
		RuleVectorVersion: RuleVectorVersion,
		InstructionText:   remoteInput.InstructionText,
		RuleVector:        remoteInput.RuleVector[:],
	})
	if err != nil {
		return statusResult(routingdomain.DifficultySemanticShadowInferenceFailed)
	}
	request, err := http.NewRequestWithContext(
		callCtx,
		http.MethodPost,
		client.endpointURL,
		bytes.NewReader(payload),
	)
	if err != nil {
		return statusResult(routingdomain.DifficultySemanticShadowInferenceFailed)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set(ServiceTokenHeader, client.serviceToken)

	response, err := client.httpClient.Do(request)
	if err != nil {
		return statusResult(transportStatus(ctx, callCtx, err))
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maximumResponseBytes))
		switch response.StatusCode {
		case http.StatusTooManyRequests:
			return statusResult(routingdomain.DifficultySemanticShadowBusy)
		case http.StatusServiceUnavailable, http.StatusBadGateway, http.StatusGatewayTimeout:
			return statusResult(routingdomain.DifficultySemanticShadowUnavailable)
		default:
			return statusResult(routingdomain.DifficultySemanticShadowInferenceFailed)
		}
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maximumResponseBytes+1))
	if err != nil || len(body) > maximumResponseBytes {
		return statusResult(routingdomain.DifficultySemanticShadowInferenceFailed)
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	var decoded classifyResponse
	if err := decoder.Decode(&decoded); err != nil {
		return statusResult(routingdomain.DifficultySemanticShadowInferenceFailed)
	}
	if err := ensureJSONEOF(decoder); err != nil || !client.validResponse(decoded) {
		return statusResult(routingdomain.DifficultySemanticShadowInferenceFailed)
	}
	return routingdomain.DifficultySemanticShadowResult{
		Status:     routingdomain.DifficultySemanticShadowReady,
		Difficulty: routingdomain.DifficultyResult{Difficulty: decoded.Difficulty},
	}
}

func (client *Client) Close() error {
	if client != nil {
		client.closed.Store(true)
	}
	return nil
}

func (client *Client) validResponse(response classifyResponse) bool {
	if response.ContractVersion != ContractVersion ||
		response.Status != routingdomain.DifficultySemanticShadowReady ||
		response.ModelVersion != client.modelVersion ||
		response.ModelContentHash != client.modelContentHash {
		return false
	}
	return response.Difficulty == routingdomain.DifficultySimple ||
		response.Difficulty == routingdomain.DifficultyComplex
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var trailing json.RawMessage
	err := decoder.Decode(&trailing)
	if err == io.EOF {
		return nil
	}
	if err == nil {
		return errors.New("LightGBM shadow response contains trailing JSON")
	}
	return err
}

func transportStatus(parentCtx context.Context, callCtx context.Context, cause error) string {
	if parentCtx != nil && errors.Is(parentCtx.Err(), context.DeadlineExceeded) {
		return routingdomain.DifficultySemanticShadowTimeout
	}
	var networkError net.Error
	if errors.Is(callCtx.Err(), context.DeadlineExceeded) ||
		errors.Is(cause, context.DeadlineExceeded) ||
		(errors.As(cause, &networkError) && networkError.Timeout()) {
		return routingdomain.DifficultySemanticShadowTimeout
	}
	return routingdomain.DifficultySemanticShadowUnavailable
}

func statusResult(status string) routingdomain.DifficultySemanticShadowResult {
	return routingdomain.DifficultySemanticShadowResult{Status: status}
}

type classifyRequest struct {
	ContractVersion   string    `json:"contractVersion"`
	ModelVersion      string    `json:"modelVersion"`
	ModelContentHash  string    `json:"modelContentHash"`
	RuleVectorVersion string    `json:"ruleVectorVersion"`
	InstructionText   string    `json:"instructionText"`
	RuleVector        []float64 `json:"ruleVector"`
}

type classifyResponse struct {
	ContractVersion  string `json:"contractVersion"`
	Status           string `json:"status"`
	Difficulty       string `json:"difficulty"`
	ModelVersion     string `json:"modelVersion"`
	ModelContentHash string `json:"modelContentHash"`
}
