package openai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/credentials"
	"gatelm/apps/gateway-core/internal/domain/embedding"
)

const configurationValidationAPIKey = "configuration-validation-only"

// ResolvingProvider resolves the server-owned credential reference once per
// logical Embed call. The resulting Client is deliberately scoped to that call
// so a credential rotation or revocation is observed before the next request,
// while retries inside Client continue to use one consistent credential.
type ResolvingProvider struct {
	resolver      credentials.Resolver
	credentialRef credentials.Ref
	clients       *clientFactory
}

type clientFactory struct {
	config Config
}

var _ embedding.Provider = (*ResolvingProvider)(nil)

func NewResolvingProvider(
	resolver credentials.Resolver,
	credentialRef credentials.Ref,
	clientConfig Config,
) (*ResolvingProvider, error) {
	if resolver == nil {
		return nil, embedding.ErrCredentialUnavailable
	}
	credentialRef = credentialRef.Normalize()
	if err := credentialRef.ValidateActive(); err != nil {
		return nil, mapCredentialError(context.Background(), err)
	}
	clients, err := newClientFactory(clientConfig)
	if err != nil {
		return nil, err
	}
	return &ResolvingProvider{
		resolver:      resolver,
		credentialRef: credentialRef,
		clients:       clients,
	}, nil
}

func (p *ResolvingProvider) ProviderName() string {
	return embedding.ProviderOpenAI
}

func (p *ResolvingProvider) Embed(ctx context.Context, request embedding.Request) (embedding.Result, error) {
	if p == nil || p.resolver == nil || p.clients == nil {
		return embedding.Result{}, embedding.ErrCredentialUnavailable
	}
	if err := ctx.Err(); err != nil {
		return embedding.Result{}, err
	}

	resolved, err := p.resolver.Resolve(ctx, p.credentialRef)
	if err != nil {
		return embedding.Result{}, mapCredentialError(ctx, err)
	}
	apiKey := strings.TrimSpace(resolved.Value)
	if apiKey == "" {
		return embedding.Result{}, embedding.ErrCredentialUnavailable
	}

	client, err := p.clients.newClient(apiKey)
	if err != nil {
		if errors.Is(err, embedding.ErrCredentialRequired) {
			return embedding.Result{}, embedding.ErrCredentialUnavailable
		}
		return embedding.Result{}, err
	}
	return client.Embed(ctx, request)
}

func newClientFactory(config Config) (*clientFactory, error) {
	// A plaintext key in static provider configuration would recreate the
	// startup credential cache this boundary is intended to prevent.
	if strings.TrimSpace(config.APIKey) != "" {
		return nil, fmt.Errorf("%w: credential must be resolver-owned", embedding.ErrInvalidRequest)
	}

	validationConfig := config
	validationConfig.APIKey = configurationValidationAPIKey
	if _, err := NewClient(validationConfig); err != nil {
		return nil, err
	}
	config.APIKey = ""
	return &clientFactory{config: config}, nil
}

func (f *clientFactory) newClient(apiKey string) (*Client, error) {
	if f == nil {
		return nil, embedding.ErrCredentialUnavailable
	}
	config := f.config
	config.APIKey = apiKey
	return NewClient(config)
}

func mapCredentialError(ctx context.Context, err error) error {
	if ctx != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return contextErr
		}
	}
	if errors.Is(err, credentials.ErrMissingReference) {
		return embedding.ErrCredentialRequired
	}
	return embedding.ErrCredentialUnavailable
}
