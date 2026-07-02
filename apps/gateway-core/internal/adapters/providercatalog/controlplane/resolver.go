package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"gatelm/apps/gateway-core/internal/domain/credentials"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
)

const maxProviderCatalogBodyBytes = 2 << 20

type Resolver struct {
	baseURL    string
	httpClient *http.Client

	mu        sync.RWMutex
	lastKnown map[providercatalog.Reference]providercatalog.Catalog
}

func NewResolver(baseURL string, httpClient *http.Client) *Resolver {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 2 * time.Second}
	}
	return &Resolver{
		baseURL:    strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		httpClient: httpClient,
		lastKnown:  make(map[providercatalog.Reference]providercatalog.Catalog),
	}
}

func (r *Resolver) GetCatalog(ctx context.Context, ref providercatalog.Reference, scope providercatalog.Scope) (providercatalog.Catalog, error) {
	ref = ref.Normalize()
	if r == nil || r.baseURL == "" || r.httpClient == nil || ref.IsZero() {
		return providercatalog.Catalog{}, providercatalog.ErrUnavailable
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.endpoint("/admin/v1/provider-catalogs/"+url.PathEscape(ref.CatalogID)), nil)
	if err != nil {
		return providercatalog.Catalog{}, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := r.httpClient.Do(req)
	if err != nil {
		return r.lastKnownIfTransient(ctx, ref, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		err := fmt.Errorf("%w: control plane provider catalog status %d", providercatalog.ErrUnavailable, resp.StatusCode)
		if isTransientStatus(resp.StatusCode) {
			return r.lastKnownIfTransient(ctx, ref, err)
		}
		return providercatalog.Catalog{}, err
	}

	var body providerCatalogResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxProviderCatalogBodyBytes)).Decode(&body); err != nil {
		return providercatalog.Catalog{}, fmt.Errorf("%w: decode provider catalog response: %v", providercatalog.ErrUnavailable, err)
	}

	catalog := body.catalog().Normalize()
	if !catalog.Matches(ref) || !catalogMatchesApplication(catalog.CatalogID, scope.ApplicationID) {
		return providercatalog.Catalog{}, fmt.Errorf("%w: %s", providercatalog.ErrMismatch, ref.CatalogID)
	}

	r.mu.Lock()
	r.lastKnown[ref] = catalog
	r.mu.Unlock()
	return catalog, nil
}

func (r *Resolver) endpoint(path string) string {
	return r.baseURL + path
}

func (r *Resolver) lastKnownIfTransient(ctx context.Context, ref providercatalog.Reference, err error) (providercatalog.Catalog, error) {
	if errors.Is(err, context.Canceled) || ctx.Err() != nil {
		return providercatalog.Catalog{}, err
	}
	r.mu.RLock()
	catalog, ok := r.lastKnown[ref]
	r.mu.RUnlock()
	if !ok {
		return providercatalog.Catalog{}, err
	}
	return catalog, nil
}

func isTransientStatus(status int) bool {
	return status >= 500 && status <= 599
}

func catalogMatchesApplication(catalogID string, applicationID string) bool {
	applicationID = strings.TrimSpace(applicationID)
	if applicationID == "" {
		return true
	}
	parts := strings.Split(catalogID, ":")
	if len(parts) != 3 || parts[0] != "provider_catalog" {
		return true
	}
	return parts[1] == applicationID
}

type providerCatalogResponse struct {
	CatalogID      string                    `json:"catalogId"`
	CatalogVersion int                       `json:"catalogVersion"`
	ContentHash    string                    `json:"contentHash"`
	UpdatedAt      time.Time                 `json:"updatedAt"`
	Providers      []providerCatalogProvider `json:"providers"`
}

type providerCatalogProvider struct {
	ProviderID         string                        `json:"providerId"`
	ProviderName       string                        `json:"providerName"`
	AdapterType        string                        `json:"adapterType"`
	Enabled            bool                          `json:"enabled"`
	BaseURL            string                        `json:"baseUrl"`
	TimeoutMs          int                           `json:"timeoutMs"`
	CredentialRequired bool                          `json:"credentialRequired"`
	CredentialRef      *credentials.Ref              `json:"credentialRef"`
	AdapterConfig      providercatalog.AdapterConfig `json:"adapterConfig"`
	FallbackEligible   bool                          `json:"fallbackEligible"`
	Models             []providercatalog.Model       `json:"models"`
}

func (r providerCatalogResponse) catalog() providercatalog.Catalog {
	providers := make([]providercatalog.Provider, 0, len(r.Providers))
	for _, provider := range r.Providers {
		providers = append(providers, providercatalog.Provider{
			ProviderID:         provider.ProviderID,
			ProviderName:       provider.ProviderName,
			AdapterType:        provider.AdapterType,
			Enabled:            provider.Enabled,
			BaseURL:            provider.BaseURL,
			TimeoutMs:          provider.TimeoutMs,
			CredentialRequired: provider.CredentialRequired,
			CredentialRef:      provider.CredentialRef,
			AdapterConfig:      provider.AdapterConfig,
			FallbackEligible:   provider.FallbackEligible,
			Models:             provider.Models,
		})
	}
	return providercatalog.Catalog{
		CatalogID:      r.CatalogID,
		CatalogVersion: r.CatalogVersion,
		ContentHash:    r.ContentHash,
		UpdatedAt:      r.UpdatedAt,
		Providers:      providers,
	}
}
