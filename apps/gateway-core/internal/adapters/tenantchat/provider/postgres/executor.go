package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/credentials"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/jackc/pgx/v5"
)

type Queryer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Executor struct {
	db          Queryer
	providers   *provider.Registry
	credentials credentials.Resolver
}

type providerConnection struct {
	ID             string
	ProviderName   string
	DisplayName    string
	BaseURL        string
	TimeoutMs      int
	SecretRef      *string
	Resolver       string
	ProviderConfig []byte
}

type providerConfig struct {
	AdapterType   string `json:"adapterType"`
	RequestFormat string `json:"requestFormat"`
	APIVersion    string `json:"apiVersion"`
}

func NewExecutor(db Queryer, providers *provider.Registry, credentialResolver credentials.Resolver) *Executor {
	return &Executor{db: db, providers: providers, credentials: credentialResolver}
}

func (e *Executor) OpenStream(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	route tenantchat.SelectedRoute,
	input tenantchat.CompletionInput,
) (provider.ChatCompletionStreamReader, tenantchat.ProviderCallStartStatus, error) {
	if e == nil || e.db == nil || e.providers == nil || requestContext.UsageIntent == nil {
		return nil, tenantchat.ProviderCallNotStarted, tenantchat.ErrUsageGuardUnavailable
	}
	connection, err := e.resolveConnection(ctx, requestContext.ExecutionScope.TenantID, route.ProviderID)
	if err != nil {
		return nil, tenantchat.ProviderCallNotStarted, err
	}
	config, err := parseProviderConfig(connection.ProviderConfig)
	if err != nil {
		return nil, tenantchat.ProviderCallNotStarted, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, err)
	}
	adapter, err := e.providers.Get(config.AdapterType)
	if err != nil {
		return nil, tenantchat.ProviderCallNotStarted, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, err)
	}
	streamingAdapter, ok := adapter.(provider.StreamingAdapter)
	if !ok {
		return nil, tenantchat.ProviderCallNotStarted, provider.NewError(
			provider.ErrorKindError,
			provider.ErrorCodeProviderError,
			errors.New("tenant chat provider does not support streaming"),
		)
	}

	credential, err := e.resolveCredential(ctx, connection)
	if err != nil {
		return nil, tenantchat.ProviderCallNotStarted, err
	}
	messages := make([]provider.ChatMessage, 0, len(input.Messages))
	for _, message := range input.Messages {
		content, marshalErr := json.Marshal(message.Content)
		if marshalErr != nil {
			return nil, tenantchat.ProviderCallNotStarted, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, marshalErr)
		}
		messages = append(messages, provider.ChatMessage{Role: message.Role, Content: content})
	}
	maxOutputTokens := int(requestContext.UsageIntent.MaxOutputTokens)
	providerRequest := provider.ChatCompletionRequest{
		RequestID:     requestContext.RequestID,
		Model:         route.ModelKey,
		Messages:      messages,
		MaxTokens:     &maxOutputTokens,
		Stream:        true,
		StreamOptions: &provider.ChatCompletionStreamOptions{IncludeUsage: true},
	}
	executionConfig := provider.ExecutionConfig{
		ProviderID:         connection.ID,
		ProviderName:       connection.ProviderName,
		AdapterType:        config.AdapterType,
		BaseURL:            connection.BaseURL,
		Timeout:            time.Duration(connection.TimeoutMs) * time.Millisecond,
		CredentialRequired: credential != nil,
		Credential:         credential,
		AdapterConfig: provider.AdapterConfig{
			RequestFormat: config.RequestFormat,
			APIVersion:    config.APIVersion,
		},
	}
	stream, err := streamingAdapter.CreateChatCompletionStream(ctx, executionConfig, providerRequest)
	if err == nil && stream == nil {
		err = provider.NewError(
			provider.ErrorKindError,
			provider.ErrorCodeProviderError,
			errors.New("tenant chat provider returned no stream"),
		)
	}
	return stream, tenantchat.ProviderCallStartedOrUnknown, err
}

func (e *Executor) resolveConnection(
	ctx context.Context,
	tenantID string,
	providerID string,
) (providerConnection, error) {
	var result providerConnection
	err := e.db.QueryRow(ctx, `
		SELECT id::text, provider, "displayName", "baseUrl", "timeoutMs",
		       "secretRef", resolver, COALESCE("providerConfig", '{}'::jsonb)
		FROM provider_connections
		WHERE "tenantId" = $1::uuid
		  AND "projectId" IS NULL
		  AND id::text = $2
		  AND status = 'ACTIVE'
		LIMIT 1
	`, tenantID, providerID).Scan(
		&result.ID,
		&result.ProviderName,
		&result.DisplayName,
		&result.BaseURL,
		&result.TimeoutMs,
		&result.SecretRef,
		&result.Resolver,
		&result.ProviderConfig,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return providerConnection{}, tenantchat.ErrNoEligibleRoute
		}
		if contextErr := ctx.Err(); contextErr != nil {
			return providerConnection{}, contextErr
		}
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return providerConnection{}, err
		}
		return providerConnection{}, tenantchat.ErrRuntimeUnavailable
	}
	if err := validateBaseURL(result.BaseURL); err != nil {
		return providerConnection{}, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, err)
	}
	if result.TimeoutMs < 1_000 || result.TimeoutMs > 120_000 {
		return providerConnection{}, tenantchat.ErrRuntimeUnavailable
	}
	return result, nil
}

func (e *Executor) resolveCredential(
	ctx context.Context,
	connection providerConnection,
) (*provider.ResolvedCredential, error) {
	resolver := strings.TrimSpace(connection.Resolver)
	if resolver == "" || strings.EqualFold(resolver, "none") {
		return nil, nil
	}
	if connection.SecretRef == nil || strings.TrimSpace(*connection.SecretRef) == "" {
		return nil, provider.NewError(
			provider.ErrorKindCredential,
			provider.ErrorCodeProviderCredentialUnavailable,
			credentials.ErrMissingReference,
		)
	}
	if e.credentials == nil {
		return nil, provider.NewError(
			provider.ErrorKindCredential,
			provider.ErrorCodeProviderCredentialUnavailable,
			credentials.ErrUnavailable,
		)
	}
	resolved, err := e.credentials.Resolve(ctx, credentials.Ref{
		CredentialRefID:   strings.TrimSpace(*connection.SecretRef),
		CredentialVersion: 1,
		CredentialState:   credentials.StateActive,
	})
	if err != nil {
		return nil, provider.NewError(
			provider.ErrorKindCredential,
			provider.ErrorCodeProviderCredentialUnavailable,
			err,
		)
	}
	return &provider.ResolvedCredential{Value: resolved.Value}, nil
}

func parseProviderConfig(document []byte) (providerConfig, error) {
	var config providerConfig
	if err := json.Unmarshal(document, &config); err != nil {
		return providerConfig{}, fmt.Errorf("decode tenant provider config: %w", err)
	}
	config.AdapterType = strings.TrimSpace(config.AdapterType)
	config.RequestFormat = strings.TrimSpace(config.RequestFormat)
	config.APIVersion = strings.TrimSpace(config.APIVersion)
	if config.AdapterType == "" {
		return providerConfig{}, errors.New("tenant provider adapter type is unavailable")
	}
	if config.RequestFormat == "" {
		switch config.AdapterType {
		case providercatalog.AdapterTypeMock:
			config.RequestFormat = providercatalog.RequestFormatMockChatCompletions
		case providercatalog.AdapterTypeAnthropic:
			config.RequestFormat = providercatalog.RequestFormatAnthropicMessages
		default:
			config.RequestFormat = providercatalog.RequestFormatOpenAIChatCompletions
		}
	}
	return config, nil
}

func validateBaseURL(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("tenant provider base URL is invalid")
	}
	return nil
}
