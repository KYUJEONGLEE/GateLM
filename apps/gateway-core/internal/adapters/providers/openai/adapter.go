package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
)

const adapterType = providercatalog.AdapterTypeOpenAICompatible

type Adapter struct {
	httpClient *http.Client
}

func NewAdapter(httpClient *http.Client) *Adapter {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Adapter{httpClient: httpClient}
}

func (a *Adapter) AdapterType() string {
	return adapterType
}

func (a *Adapter) ListModels(ctx context.Context, config provider.ExecutionConfig) (*provider.ModelListResponse, error) {
	config = normalizeConfig(config)
	if err := validateConfig(config, false); err != nil {
		return nil, err
	}

	reqCtx, cancel := contextWithTimeout(ctx, config.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, providerEndpoint(config.BaseURL, "/models"), nil)
	if err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("build provider models request: %w", err))
	}
	if config.Credential != nil && strings.TrimSpace(config.Credential.Value) != "" {
		req.Header.Set("Authorization", "Bearer "+config.Credential.Value)
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, classifyTransportError(reqCtx, err)
	}
	defer resp.Body.Close()

	if err := classifyStatus(resp); err != nil {
		return nil, err
	}

	var models provider.ModelListResponse
	if err := json.NewDecoder(resp.Body).Decode(&models); err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("decode provider models response: %w", err))
	}
	return &models, nil
}

func (a *Adapter) CreateChatCompletion(ctx context.Context, config provider.ExecutionConfig, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	config = normalizeConfig(config)
	if err := validateConfig(config, true); err != nil {
		return nil, err
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("encode provider chat request: %w", err))
	}

	reqCtx, cancel := contextWithTimeout(ctx, config.Timeout)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodPost, providerEndpoint(config.BaseURL, "/chat/completions"), bytes.NewReader(body))
	if err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("build provider chat request: %w", err))
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+config.Credential.Value)
	httpReq.Header.Set("X-GateLM-Request-Id", req.RequestID)

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return nil, classifyTransportError(reqCtx, err)
	}
	defer resp.Body.Close()

	if err := classifyStatus(resp); err != nil {
		return nil, err
	}

	var completion provider.ChatCompletionResponse
	if err := json.NewDecoder(resp.Body).Decode(&completion); err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("decode provider chat response: %w", err))
	}

	return &completion, nil
}

func normalizeConfig(config provider.ExecutionConfig) provider.ExecutionConfig {
	config.ProviderID = strings.TrimSpace(config.ProviderID)
	config.ProviderName = strings.TrimSpace(config.ProviderName)
	config.AdapterType = strings.TrimSpace(config.AdapterType)
	config.BaseURL = strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	config.AdapterConfig.RequestFormat = strings.TrimSpace(config.AdapterConfig.RequestFormat)
	config.AdapterConfig.APIVersion = strings.TrimSpace(config.AdapterConfig.APIVersion)
	return config
}

func validateConfig(config provider.ExecutionConfig, requireCredential bool) error {
	if config.BaseURL == "" {
		return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("provider base URL is missing"))
	}
	if config.AdapterConfig.RequestFormat != "" &&
		config.AdapterConfig.RequestFormat != providercatalog.RequestFormatOpenAIChatCompletions {
		return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("provider request format is unsupported"))
	}
	if requireCredential && (config.Credential == nil || strings.TrimSpace(config.Credential.Value) == "") {
		return provider.NewError(provider.ErrorKindCredential, provider.ErrorCodeProviderCredentialUnavailable, errors.New("provider credential is unavailable"))
	}
	return nil
}

func contextWithTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		return context.WithCancel(ctx)
	}
	return context.WithTimeout(ctx, timeout)
}

func providerEndpoint(baseURL string, path string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if !strings.HasSuffix(baseURL, "/v1") {
		baseURL += "/v1"
	}
	return baseURL + path
}

func classifyTransportError(ctx context.Context, err error) error {
	if ctxErr := ctx.Err(); ctxErr != nil {
		if errors.Is(ctxErr, context.Canceled) {
			return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, ctxErr)
		}
		return provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, ctxErr)
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, err)
	}
	return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, err)
}

func classifyStatus(resp *http.Response) error {
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	drainProviderErrorBody(resp.Body)
	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return provider.NewError(provider.ErrorKindUnauthorized, provider.ErrorCodeProviderUnauthorized, fmt.Errorf("provider returned status %d", resp.StatusCode))
	case http.StatusRequestTimeout, http.StatusGatewayTimeout:
		return provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, fmt.Errorf("provider returned status %d", resp.StatusCode))
	default:
		return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("provider returned status %d", resp.StatusCode))
	}
}

func drainProviderErrorBody(body io.Reader) {
	if body == nil {
		return
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(body, 4096))
}
