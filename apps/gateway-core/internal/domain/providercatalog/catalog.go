package providercatalog

import (
	"context"
	"errors"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/credentials"
)

const (
	AdapterTypeOpenAICompatible = "openai_compatible"
	AdapterTypeMock             = "mock"

	RequestFormatOpenAIChatCompletions = "openai_chat_completions"
	RequestFormatMockChatCompletions   = "mock_chat_completions"
)

var (
	ErrUnavailable      = errors.New("provider catalog is unavailable")
	ErrMismatch         = errors.New("provider catalog reference mismatch")
	ErrProviderNotFound = errors.New("provider catalog provider is not found")
	ErrProviderDisabled = errors.New("provider catalog provider is disabled")
	ErrModelNotFound    = errors.New("provider catalog model is not found")
	ErrModelDisabled    = errors.New("provider catalog model is disabled")
)

type Resolver interface {
	GetCatalog(ctx context.Context, ref Reference, scope Scope) (Catalog, error)
}

type Scope struct {
	TenantID      string
	ProjectID     string
	ApplicationID string
}

type Reference struct {
	CatalogID      string
	CatalogVersion int
	ContentHash    string
}

type Catalog struct {
	CatalogID      string
	CatalogVersion int
	ContentHash    string
	UpdatedAt      time.Time
	Providers      []Provider
}

type Provider struct {
	ProviderID         string
	ProviderName       string
	AdapterType        string
	Enabled            bool
	BaseURL            string
	TimeoutMs          int
	CredentialRequired bool
	CredentialRef      *credentials.Ref
	AdapterConfig      AdapterConfig
	FallbackEligible   bool
	Models             []Model
}

type AdapterConfig struct {
	RequestFormat string
	APIVersion    string
}

type Model struct {
	ModelID      string
	ModelName    string
	DisplayName  string
	Enabled      bool
	Capabilities ModelCapabilities
	Routing      ModelRouting
}

type ModelCapabilities struct {
	StreamingSupported bool
	SupportsJSONMode   bool
	MaxInputTokens     int
	MaxOutputTokens    int
}

type ModelRouting struct {
	AutoRoutingEligible bool
	CostTier            string
	FallbackPriority    int
}

func (r Reference) Normalize() Reference {
	return Reference{
		CatalogID:      strings.TrimSpace(r.CatalogID),
		CatalogVersion: r.CatalogVersion,
		ContentHash:    strings.TrimSpace(r.ContentHash),
	}
}

func (r Reference) IsZero() bool {
	r = r.Normalize()
	return r.CatalogID == "" && r.CatalogVersion == 0 && r.ContentHash == ""
}

func (c Catalog) Normalize() Catalog {
	c.CatalogID = strings.TrimSpace(c.CatalogID)
	c.ContentHash = strings.TrimSpace(c.ContentHash)
	for i := range c.Providers {
		c.Providers[i] = c.Providers[i].Normalize()
	}
	return c
}

func (c Catalog) Reference() Reference {
	c = c.Normalize()
	return Reference{
		CatalogID:      c.CatalogID,
		CatalogVersion: c.CatalogVersion,
		ContentHash:    c.ContentHash,
	}
}

func (c Catalog) Matches(ref Reference) bool {
	return c.Reference() == ref.Normalize()
}

func (c Catalog) ProviderByName(providerName string) (Provider, error) {
	providerName = strings.TrimSpace(providerName)
	for _, provider := range c.Normalize().Providers {
		if provider.ProviderName == providerName || provider.ProviderID == providerName {
			if !provider.Enabled {
				return Provider{}, ErrProviderDisabled
			}
			return provider, nil
		}
	}
	return Provider{}, ErrProviderNotFound
}

func (c Catalog) FirstFallbackProvider(excludeProvider string, excludeModel string) (Provider, Model, error) {
	excludeProvider = strings.TrimSpace(excludeProvider)
	excludeModel = strings.TrimSpace(excludeModel)
	for _, provider := range c.Normalize().Providers {
		if !provider.Enabled || !provider.FallbackEligible {
			continue
		}
		model, err := provider.FirstEnabledFallbackModel()
		if err != nil {
			continue
		}
		if (provider.ProviderName == excludeProvider || provider.ProviderID == excludeProvider) && model.ModelID == excludeModel {
			continue
		}
		return provider, model, nil
	}
	return Provider{}, Model{}, ErrProviderNotFound
}

func (p Provider) Normalize() Provider {
	p.ProviderID = strings.TrimSpace(p.ProviderID)
	p.ProviderName = strings.TrimSpace(p.ProviderName)
	p.AdapterType = strings.TrimSpace(p.AdapterType)
	p.BaseURL = strings.TrimSpace(p.BaseURL)
	p.AdapterConfig.RequestFormat = strings.TrimSpace(p.AdapterConfig.RequestFormat)
	p.AdapterConfig.APIVersion = strings.TrimSpace(p.AdapterConfig.APIVersion)
	if p.Models == nil {
		p.Models = []Model{}
	}
	for i := range p.Models {
		p.Models[i] = p.Models[i].Normalize()
	}
	return p
}

func (p Provider) ModelByID(modelID string) (Model, error) {
	modelID = strings.TrimSpace(modelID)
	for _, model := range p.Normalize().Models {
		if model.ModelID == modelID || model.ModelName == modelID {
			if !model.Enabled {
				return Model{}, ErrModelDisabled
			}
			return model, nil
		}
	}
	return Model{}, ErrModelNotFound
}

func (p Provider) FirstEnabledFallbackModel() (Model, error) {
	var selected Model
	found := false
	for _, model := range p.Normalize().Models {
		if !model.Enabled {
			continue
		}
		if !found || model.Routing.FallbackPriority < selected.Routing.FallbackPriority {
			selected = model
			found = true
		}
	}
	if !found {
		return Model{}, ErrModelNotFound
	}
	return selected, nil
}

func (m Model) Normalize() Model {
	m.ModelID = strings.TrimSpace(m.ModelID)
	m.ModelName = strings.TrimSpace(m.ModelName)
	m.DisplayName = strings.TrimSpace(m.DisplayName)
	m.Routing.CostTier = strings.TrimSpace(m.Routing.CostTier)
	return m
}
