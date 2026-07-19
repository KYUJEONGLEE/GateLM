package aiservice

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"

	routingdomain "gatelm/apps/gateway-core/internal/domain/routing"
)

const (
	ContractVersion          = "gatelm.internal.routing-difficulty-inference.v1"
	RuleVectorVersion        = "difficulty-feature-vector.v1"
	ModelVersion             = "difficulty-offline.model-path-5000.2026-07-16.42d-rule-vector-v1-plus-projection.shadow.v1"
	ModelContentHash         = "sha256:4c2c4f516206530d3b3f9c393b0633b7694a2e0aa5e20400d65faf088a184f5d"
	ServiceTokenHeader       = "X-GateLM-AI-Service-Token"
	DefaultTimeout           = 250 * time.Millisecond
	DefaultMaximumConcurrent = 64
	maximumResponseBytes     = 4096
)

type Config struct {
	EndpointURL       string
	ServiceToken      string
	HTTPClient        *http.Client
	Timeout           time.Duration
	MaximumConcurrent int
	Observer          Observer
}

// Observation contains aggregate-only remote inference telemetry. It deliberately
// excludes request text, feature vectors, model scores, and identifiers.
type Observation struct {
	Status   string
	Duration time.Duration
}

type Observer func(Observation)

// Classifier calls the private AI Service E5 runtime without persisting or
// logging instruction text, rule vectors, or response material. Any transport,
// timeout, saturation, or validation failure returns a bounded status so the
// caller can retain the existing rule-based difficulty.
type Classifier struct {
	endpointURL  string
	serviceToken string
	httpClient   *http.Client
	timeout      time.Duration
	gate         chan struct{}
	observer     Observer
	closed       atomic.Bool
}

func NewClassifier(config Config) (*Classifier, error) {
	endpointURL := strings.TrimSpace(config.EndpointURL)
	parsed, err := url.Parse(endpointURL)
	if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
		return nil, errors.New("remote difficulty endpoint is invalid")
	}
	serviceToken := strings.TrimSpace(config.ServiceToken)
	if serviceToken == "" {
		return nil, errors.New("remote difficulty service token is required")
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
	return &Classifier{
		endpointURL:  endpointURL,
		serviceToken: serviceToken,
		httpClient:   httpClient,
		timeout:      timeout,
		gate:         make(chan struct{}, maximumConcurrent),
		observer:     config.Observer,
	}, nil
}

func (classifier *Classifier) Classify(
	ctx context.Context,
	features routingdomain.PromptFeatures,
	category string,
) (result routingdomain.DifficultySemanticShadowResult) {
	started := time.Now()
	defer func() {
		classifier.notify(Observation{
			Status:   result.Status,
			Duration: time.Since(started),
		})
	}()
	if classifier == nil || classifier.closed.Load() {
		return statusResult(routingdomain.DifficultySemanticShadowUnavailable)
	}
	remoteInput, ok := routingdomain.BuildDifficultyRemoteInput(features, category)
	if !ok {
		return statusResult(routingdomain.DifficultySemanticShadowNotApplicable)
	}
	select {
	case classifier.gate <- struct{}{}:
		defer func() { <-classifier.gate }()
	default:
		return statusResult(routingdomain.DifficultySemanticShadowBusy)
	}
	if ctx == nil {
		ctx = context.Background()
	}
	callCtx, cancel := context.WithTimeout(ctx, classifier.timeout)
	defer cancel()

	payload, err := json.Marshal(classifyRequest{
		ContractVersion:   ContractVersion,
		ModelContentHash:  ModelContentHash,
		RuleVectorVersion: RuleVectorVersion,
		InstructionText:   remoteInput.InstructionText,
		RuleVector:        remoteInput.RuleVector[:],
	})
	if err != nil {
		return statusResult(routingdomain.DifficultySemanticShadowInferenceFailed)
	}
	httpRequest, err := http.NewRequestWithContext(
		callCtx,
		http.MethodPost,
		classifier.endpointURL,
		bytes.NewReader(payload),
	)
	if err != nil {
		return statusResult(routingdomain.DifficultySemanticShadowInferenceFailed)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Accept", "application/json")
	httpRequest.Header.Set(ServiceTokenHeader, classifier.serviceToken)

	response, err := classifier.httpClient.Do(httpRequest)
	if err != nil {
		return statusResult(remoteTransportStatus(ctx, callCtx, err))
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maximumResponseBytes))
		if response.StatusCode == http.StatusTooManyRequests {
			return statusResult(routingdomain.DifficultySemanticShadowBusy)
		}
		if response.StatusCode == http.StatusServiceUnavailable || response.StatusCode == http.StatusBadGateway || response.StatusCode == http.StatusGatewayTimeout {
			return statusResult(routingdomain.DifficultySemanticShadowUnavailable)
		}
		return statusResult(routingdomain.DifficultySemanticShadowInferenceFailed)
	}

	decoder := json.NewDecoder(io.LimitReader(response.Body, maximumResponseBytes+1))
	decoder.DisallowUnknownFields()
	var decoded classifyResponse
	if err := decoder.Decode(&decoded); err != nil {
		return statusResult(routingdomain.DifficultySemanticShadowInferenceFailed)
	}
	if err := ensureJSONEOF(decoder); err != nil || !validResponse(decoded) {
		return statusResult(routingdomain.DifficultySemanticShadowInferenceFailed)
	}
	return routingdomain.DifficultySemanticShadowResult{
		Status: routingdomain.DifficultySemanticShadowReady,
		Difficulty: routingdomain.DifficultyResult{
			Difficulty: decoded.Difficulty,
		},
	}
}

func (classifier *Classifier) notify(observation Observation) {
	if classifier == nil || classifier.observer == nil {
		return
	}
	defer func() {
		_ = recover()
	}()
	classifier.observer(observation)
}

func (classifier *Classifier) Close(_ context.Context) error {
	if classifier != nil {
		classifier.closed.Store(true)
	}
	return nil
}

func validResponse(response classifyResponse) bool {
	if response.ContractVersion != ContractVersion || response.Status != routingdomain.DifficultySemanticShadowReady ||
		response.ModelVersion != ModelVersion || response.ModelContentHash != ModelContentHash {
		return false
	}
	return response.Difficulty == routingdomain.DifficultySimple || response.Difficulty == routingdomain.DifficultyComplex
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var trailing json.RawMessage
	err := decoder.Decode(&trailing)
	if err == io.EOF {
		return nil
	}
	if err == nil {
		return errors.New("remote difficulty response contains trailing JSON")
	}
	return err
}

func remoteTransportStatus(parentCtx context.Context, callCtx context.Context, cause error) string {
	if parentCtx != nil && errors.Is(parentCtx.Err(), context.DeadlineExceeded) {
		return routingdomain.DifficultySemanticShadowTimeout
	}
	var networkError net.Error
	if errors.Is(callCtx.Err(), context.DeadlineExceeded) || errors.Is(cause, context.DeadlineExceeded) ||
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
