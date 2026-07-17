package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"

	"gatelm/apps/gateway-core/internal/domain/embedding"
)

const (
	defaultBaseURL          = "https://api.openai.com/v1"
	defaultTimeout          = 3 * time.Second
	defaultMaxAttempts      = 3
	maximumMaxAttempts      = 5
	defaultRetryBaseDelay   = 25 * time.Millisecond
	maximumRetryBaseDelay   = 5 * time.Second
	defaultMaxResponseBytes = int64(8 * 1024 * 1024)
	maximumResponseBytes    = int64(64 * 1024 * 1024)
	defaultMaxInputs        = 128
	maximumUsageTokens      = 1_000_000_000
)

// SleepFunc makes retry timing deterministic in tests without exposing
// provider request material to a retry hook.
type SleepFunc func(ctx context.Context, delay time.Duration) error

// ResponseValidationMode separates the strict RAG provider contract from the
// deliberately narrow response compatibility required by the pre-existing
// Semantic Cache integration.
type ResponseValidationMode string

const (
	ResponseValidationStrict              ResponseValidationMode = "strict"
	ResponseValidationLegacySemanticCache ResponseValidationMode = "legacy-semantic-cache"
)

type Config struct {
	APIKey                 string
	BaseURL                string
	Model                  string
	Dimensions             int
	Timeout                time.Duration
	MaxAttempts            int
	RetryBaseDelay         time.Duration
	MaxResponseBytes       int64
	MaxInputs              int
	ResponseValidationMode ResponseValidationMode
	HTTPClient             *http.Client
	Sleep                  SleepFunc
}

type Client struct {
	apiKey           string
	baseURL          string
	model            string
	dimensions       int
	timeout          time.Duration
	maxAttempts      int
	retryBaseDelay   time.Duration
	maxResponseBytes int64
	maxInputs        int
	validationMode   ResponseValidationMode
	httpClient       *http.Client
	sleep            SleepFunc
}

var _ embedding.Provider = (*Client)(nil)

func NewClient(config Config) (*Client, error) {
	apiKey := strings.TrimSpace(config.APIKey)
	if apiKey == "" {
		return nil, embedding.ErrCredentialRequired
	}
	if config.Dimensions < 0 {
		return nil, fmt.Errorf("%w: dimensions", embedding.ErrInvalidRequest)
	}

	baseURL := strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	parsedBaseURL, err := url.Parse(baseURL)
	if err != nil || parsedBaseURL.Scheme == "" || parsedBaseURL.Host == "" {
		return nil, fmt.Errorf("%w: base url", embedding.ErrInvalidRequest)
	}

	timeout := config.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	maxAttempts := config.MaxAttempts
	if maxAttempts == 0 {
		maxAttempts = defaultMaxAttempts
	}
	if maxAttempts < 1 || maxAttempts > maximumMaxAttempts {
		return nil, fmt.Errorf("%w: max attempts", embedding.ErrInvalidRequest)
	}
	retryBaseDelay := config.RetryBaseDelay
	if retryBaseDelay <= 0 {
		retryBaseDelay = defaultRetryBaseDelay
	}
	if retryBaseDelay > maximumRetryBaseDelay {
		return nil, fmt.Errorf("%w: retry delay", embedding.ErrInvalidRequest)
	}
	maxResponseBytes := config.MaxResponseBytes
	if maxResponseBytes == 0 {
		maxResponseBytes = defaultMaxResponseBytes
	}
	if maxResponseBytes < 1 || maxResponseBytes > maximumResponseBytes {
		return nil, fmt.Errorf("%w: response limit", embedding.ErrInvalidRequest)
	}
	maxInputs := config.MaxInputs
	if maxInputs == 0 {
		maxInputs = defaultMaxInputs
	}
	if maxInputs < 1 {
		return nil, fmt.Errorf("%w: input limit", embedding.ErrInvalidRequest)
	}
	validationMode := config.ResponseValidationMode
	if validationMode == "" {
		validationMode = ResponseValidationStrict
	}
	if validationMode != ResponseValidationStrict && validationMode != ResponseValidationLegacySemanticCache {
		return nil, fmt.Errorf("%w: response validation mode", embedding.ErrInvalidRequest)
	}

	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{}
	}
	sleep := config.Sleep
	if sleep == nil {
		sleep = sleepWithContext
	}

	return &Client{
		apiKey:           apiKey,
		baseURL:          baseURL,
		model:            strings.TrimSpace(config.Model),
		dimensions:       config.Dimensions,
		timeout:          timeout,
		maxAttempts:      maxAttempts,
		retryBaseDelay:   retryBaseDelay,
		maxResponseBytes: maxResponseBytes,
		maxInputs:        maxInputs,
		validationMode:   validationMode,
		httpClient:       httpClient,
		sleep:            sleep,
	}, nil
}

func (c *Client) ProviderName() string {
	return embedding.ProviderOpenAI
}

func (c *Client) Embed(ctx context.Context, request embedding.Request) (embedding.Result, error) {
	if err := ctx.Err(); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return embedding.Result{}, timeoutFailure()
		}
		return embedding.Result{}, err
	}
	request, err := c.normalizeRequest(request)
	if err != nil {
		return embedding.Result{}, err
	}
	body, err := encodeRequest(request)
	if err != nil {
		return embedding.Result{}, fmt.Errorf("%w: encode", embedding.ErrRequestFailed)
	}

	var lastErr error
	for attempt := 1; attempt <= c.maxAttempts; attempt++ {
		result, retryable, attemptErr := c.doAttempt(ctx, request, body)
		if attemptErr == nil {
			return result, nil
		}
		lastErr = attemptErr
		if !retryable || attempt == c.maxAttempts {
			return embedding.Result{}, attemptErr
		}
		if err := c.sleep(ctx, retryDelay(c.retryBaseDelay, attempt)); err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				if errors.Is(ctxErr, context.DeadlineExceeded) {
					return embedding.Result{}, timeoutFailure()
				}
				return embedding.Result{}, ctxErr
			}
			return embedding.Result{}, fmt.Errorf("%w: retry wait", embedding.ErrRequestFailed)
		}
	}
	return embedding.Result{}, lastErr
}

func (c *Client) normalizeRequest(request embedding.Request) (embedding.Request, error) {
	if c == nil || c.httpClient == nil || c.sleep == nil {
		return embedding.Request{}, fmt.Errorf("%w: provider unavailable", embedding.ErrRequestFailed)
	}
	if len(request.Inputs) == 0 || len(request.Inputs) > c.maxInputs {
		return embedding.Request{}, fmt.Errorf("%w: input count", embedding.ErrInvalidRequest)
	}
	inputs := make([]string, len(request.Inputs))
	for index, input := range request.Inputs {
		if strings.TrimSpace(input) == "" {
			return embedding.Request{}, embedding.ErrInputEmpty
		}
		inputs[index] = input
	}
	model := strings.TrimSpace(request.Model)
	if model == "" {
		model = c.model
	}
	if model == "" {
		return embedding.Request{}, fmt.Errorf("%w: model", embedding.ErrInvalidRequest)
	}
	dimensions := request.Dimensions
	if dimensions == 0 {
		dimensions = c.dimensions
	}
	if dimensions < 0 {
		return embedding.Request{}, fmt.Errorf("%w: dimensions", embedding.ErrInvalidRequest)
	}
	return embedding.Request{Inputs: inputs, Model: model, Dimensions: dimensions}, nil
}

func (c *Client) doAttempt(ctx context.Context, request embedding.Request, body []byte) (embedding.Result, bool, error) {
	attemptCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	httpRequest, err := http.NewRequestWithContext(
		attemptCtx,
		http.MethodPost,
		embeddingEndpoint(c.baseURL),
		bytes.NewReader(body),
	)
	if err != nil {
		return embedding.Result{}, false, fmt.Errorf("%w: build request", embedding.ErrRequestFailed)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", "Bearer "+c.apiKey)

	response, err := c.httpClient.Do(httpRequest)
	if err != nil {
		if response != nil && response.Body != nil {
			response.Body.Close()
		}
		return classifyTransportFailure(ctx, attemptCtx, err)
	}
	defer response.Body.Close()

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		drainBody(response.Body)
		return embedding.Result{}, retryableStatus(response.StatusCode), statusFailure(response.StatusCode)
	}

	payload, err := readResponse(response.Body, c.maxResponseBytes)
	if err != nil {
		if errors.Is(err, embedding.ErrInvalidResponse) || errors.Is(err, embedding.ErrResponseTooLarge) {
			return embedding.Result{}, false, err
		}
		return classifyTransportFailure(ctx, attemptCtx, err)
	}
	decoded, err := decodeResponse(payload)
	if err != nil {
		return embedding.Result{}, false, err
	}
	result, err := c.validateResponse(decoded, request)
	if err != nil {
		return embedding.Result{}, false, err
	}
	return result, false, nil
}

type requestBody struct {
	Input      any    `json:"input"`
	Model      string `json:"model"`
	Dimensions *int   `json:"dimensions,omitempty"`
}

func encodeRequest(request embedding.Request) ([]byte, error) {
	var input any = append([]string(nil), request.Inputs...)
	if len(request.Inputs) == 1 {
		input = request.Inputs[0]
	}
	return json.Marshal(requestBody{
		Input:      input,
		Model:      request.Model,
		Dimensions: optionalPositiveInt(request.Dimensions),
	})
}

type responseBody struct {
	Model string `json:"model"`
	Data  []struct {
		Index     *int      `json:"index"`
		Embedding []float64 `json:"embedding"`
	} `json:"data"`
	Usage *responseUsage `json:"usage"`
}

type responseUsage struct {
	PromptTokens *int `json:"prompt_tokens"`
	TotalTokens  *int `json:"total_tokens"`
}

func readResponse(body io.Reader, limit int64) ([]byte, error) {
	if body == nil {
		return nil, fmt.Errorf("%w: empty body", embedding.ErrInvalidResponse)
	}
	payload, err := io.ReadAll(io.LimitReader(body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(payload)) > limit {
		return nil, embedding.ErrResponseTooLarge
	}
	return payload, nil
}

func decodeResponse(payload []byte) (responseBody, error) {
	var decoded responseBody
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return responseBody{}, fmt.Errorf("%w: decode", embedding.ErrInvalidResponse)
	}
	return decoded, nil
}

func (c *Client) validateResponse(decoded responseBody, request embedding.Request) (embedding.Result, error) {
	if c.validationMode == ResponseValidationLegacySemanticCache {
		return validateLegacySemanticCacheResponse(decoded, request.Model)
	}
	return validateStrictResponse(decoded, len(request.Inputs), request.Dimensions, request.Model)
}

func validateStrictResponse(decoded responseBody, expectedCount int, dimensions int, model string) (embedding.Result, error) {
	if decoded.Model != model {
		return embedding.Result{}, fmt.Errorf("%w: model", embedding.ErrInvalidResponse)
	}
	if len(decoded.Data) != expectedCount {
		return embedding.Result{}, fmt.Errorf("%w: vector count", embedding.ErrInvalidResponse)
	}
	if decoded.Usage == nil || decoded.Usage.PromptTokens == nil || decoded.Usage.TotalTokens == nil {
		return embedding.Result{}, fmt.Errorf("%w: usage fields", embedding.ErrInvalidResponse)
	}
	promptTokens := *decoded.Usage.PromptTokens
	totalTokens := *decoded.Usage.TotalTokens
	if promptTokens <= 0 || totalTokens <= 0 ||
		promptTokens > maximumUsageTokens || totalTokens > maximumUsageTokens ||
		promptTokens > totalTokens {
		return embedding.Result{}, fmt.Errorf("%w: usage", embedding.ErrInvalidResponse)
	}

	vectors := make([][]float64, expectedCount)
	seen := make([]bool, expectedCount)
	for _, item := range decoded.Data {
		if item.Index == nil || *item.Index < 0 || *item.Index >= expectedCount || seen[*item.Index] {
			return embedding.Result{}, fmt.Errorf("%w: vector index", embedding.ErrInvalidResponse)
		}
		if len(item.Embedding) == 0 {
			return embedding.Result{}, embedding.ErrEmptyVector
		}
		if dimensions > 0 && len(item.Embedding) != dimensions {
			return embedding.Result{}, fmt.Errorf("%w: vector dimensions", embedding.ErrInvalidResponse)
		}
		vector := make([]float64, len(item.Embedding))
		for index, value := range item.Embedding {
			if math.IsNaN(value) || math.IsInf(value, 0) {
				return embedding.Result{}, fmt.Errorf("%w: vector value", embedding.ErrInvalidResponse)
			}
			vector[index] = value
		}
		vectors[*item.Index] = vector
		seen[*item.Index] = true
	}
	for _, present := range seen {
		if !present {
			return embedding.Result{}, fmt.Errorf("%w: missing vector", embedding.ErrInvalidResponse)
		}
	}

	return embedding.Result{
		Vectors: vectors,
		Model:   model,
		Usage: embedding.Usage{
			PromptTokens: promptTokens,
			TotalTokens:  totalTokens,
		},
	}, nil
}

func validateLegacySemanticCacheResponse(decoded responseBody, model string) (embedding.Result, error) {
	if len(decoded.Data) == 0 || len(decoded.Data[0].Embedding) == 0 {
		return embedding.Result{}, embedding.ErrEmptyVector
	}
	return embedding.Result{
		Vectors: [][]float64{append([]float64(nil), decoded.Data[0].Embedding...)},
		Model:   model,
	}, nil
}

func classifyTransportFailure(parent context.Context, attempt context.Context, err error) (embedding.Result, bool, error) {
	if parentErr := parent.Err(); parentErr != nil {
		if errors.Is(parentErr, context.DeadlineExceeded) {
			return embedding.Result{}, false, timeoutFailure()
		}
		return embedding.Result{}, false, parentErr
	}
	if errors.Is(attempt.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
		return embedding.Result{}, true, timeoutFailure()
	}
	if errors.Is(err, context.Canceled) {
		return embedding.Result{}, false, context.Canceled
	}
	var networkError net.Error
	if errors.As(err, &networkError) && networkError.Timeout() {
		return embedding.Result{}, true, timeoutFailure()
	}
	if errors.As(err, &networkError) && networkError.Temporary() {
		return embedding.Result{}, true, fmt.Errorf("%w: transient transport", embedding.ErrRequestFailed)
	}
	if errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, syscall.ECONNRESET) || errors.Is(err, syscall.EPIPE) {
		return embedding.Result{}, true, fmt.Errorf("%w: transient transport", embedding.ErrRequestFailed)
	}
	return embedding.Result{}, false, fmt.Errorf("%w: transport", embedding.ErrRequestFailed)
}

func statusFailure(status int) error {
	requestFailure := fmt.Errorf("%w: status %d", embedding.ErrRequestFailed, status)
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		return errors.Join(embedding.ErrUnauthorized, requestFailure)
	case http.StatusRequestTimeout:
		return errors.Join(embedding.ErrTimeout, requestFailure)
	case http.StatusTooManyRequests:
		return errors.Join(embedding.ErrRateLimited, requestFailure)
	default:
		return requestFailure
	}
}

func timeoutFailure() error {
	return errors.Join(embedding.ErrTimeout, context.DeadlineExceeded)
}

func retryableStatus(status int) bool {
	return status == http.StatusRequestTimeout || status == http.StatusTooManyRequests ||
		(status >= 500 && status <= 599)
}

func retryDelay(base time.Duration, completedAttempt int) time.Duration {
	delay := base
	for multiplier := 1; multiplier < completedAttempt; multiplier++ {
		if delay >= maximumRetryBaseDelay/2 {
			return maximumRetryBaseDelay
		}
		delay *= 2
	}
	if delay > maximumRetryBaseDelay {
		return maximumRetryBaseDelay
	}
	return delay
}

func sleepWithContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func optionalPositiveInt(value int) *int {
	if value <= 0 {
		return nil
	}
	copied := value
	return &copied
}

func embeddingEndpoint(baseURL string) string {
	return strings.TrimRight(strings.TrimSpace(baseURL), "/") + "/embeddings"
}

func drainBody(body io.Reader) {
	if body == nil {
		return
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(body, 4096))
}
