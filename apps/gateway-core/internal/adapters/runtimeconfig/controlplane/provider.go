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

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
)

const maxRuntimeSnapshotBodyBytes = 1 << 20

type Provider struct {
	baseURL    string
	httpClient *http.Client

	mu        sync.RWMutex
	lastKnown map[lookupKey]runtimeconfig.ExecutionSnapshot
}

type lookupKey struct {
	tenantID      string
	projectID     string
	applicationID string
}

func NewProvider(baseURL string, httpClient *http.Client) *Provider {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 2 * time.Second}
	}
	return &Provider{
		baseURL:    strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		httpClient: httpClient,
		lastKnown:  make(map[lookupKey]runtimeconfig.ExecutionSnapshot),
	}
}

func (p *Provider) GetExecutionSnapshot(ctx context.Context, tenantID string, projectID string, applicationID string) (runtimeconfig.ExecutionSnapshot, error) {
	if p == nil || p.baseURL == "" || p.httpClient == nil {
		return runtimeconfig.ExecutionSnapshot{}, runtimeconfig.ErrInactiveConfig
	}
	key := newLookupKey(tenantID, projectID, applicationID)
	if key.tenantID == "" || key.projectID == "" || key.applicationID == "" {
		return runtimeconfig.ExecutionSnapshot{}, runtimeconfig.ErrMissingScope
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.endpoint("/admin/v1/applications/"+url.PathEscape(key.applicationID)+"/runtime-snapshot/active"), nil)
	if err != nil {
		return runtimeconfig.ExecutionSnapshot{}, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return p.lastKnownIfTransient(ctx, key, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		err := fmt.Errorf("%w: control plane runtime snapshot status %d", runtimeconfig.ErrInactiveConfig, resp.StatusCode)
		if isTransientStatus(resp.StatusCode) {
			return p.lastKnownIfTransient(ctx, key, err)
		}
		return runtimeconfig.ExecutionSnapshot{}, err
	}

	var body runtimeSnapshotResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxRuntimeSnapshotBodyBytes)).Decode(&body); err != nil {
		return runtimeconfig.ExecutionSnapshot{}, fmt.Errorf("%w: decode runtime snapshot response: %v", runtimeconfig.ErrInactiveConfig, err)
	}

	snapshot, err := body.executionSnapshot(key)
	if err != nil {
		return runtimeconfig.ExecutionSnapshot{}, err
	}
	snapshot = snapshot.Normalize(time.Now().UTC(), runtimeconfig.DefaultGatewayInstanceIDCompat)
	if err := snapshot.Validate(); err != nil {
		return runtimeconfig.ExecutionSnapshot{}, err
	}

	p.mu.Lock()
	p.lastKnown[key] = snapshot
	p.mu.Unlock()
	return snapshot, nil
}

func (p *Provider) endpoint(path string) string {
	return p.baseURL + path
}

func (p *Provider) lastKnownIfTransient(ctx context.Context, key lookupKey, err error) (runtimeconfig.ExecutionSnapshot, error) {
	if errors.Is(err, context.Canceled) || ctx.Err() != nil {
		return runtimeconfig.ExecutionSnapshot{}, err
	}
	p.mu.RLock()
	snapshot, ok := p.lastKnown[key]
	p.mu.RUnlock()
	if !ok {
		return runtimeconfig.ExecutionSnapshot{}, err
	}
	snapshot.Snapshot.RuntimeState = runtimeconfig.RuntimeStateLastKnownSafeUsed
	return snapshot, nil
}

func newLookupKey(tenantID string, projectID string, applicationID string) lookupKey {
	return lookupKey{
		tenantID:      strings.TrimSpace(tenantID),
		projectID:     strings.TrimSpace(projectID),
		applicationID: strings.TrimSpace(applicationID),
	}
}

func isTransientStatus(status int) bool {
	return status >= 500 && status <= 599
}

type runtimeSnapshotResponse struct {
	RuntimeSnapshotID      string                     `json:"runtimeSnapshotId"`
	RuntimeSnapshotVersion int                        `json:"runtimeSnapshotVersion"`
	ContentHash            string                     `json:"contentHash"`
	RuntimeState           string                     `json:"runtimeState"`
	PublishedAt            time.Time                  `json:"publishedAt"`
	PublishedBy            string                     `json:"publishedBy"`
	GatewayInstanceID      string                     `json:"gatewayInstanceId"`
	LookupKey              runtimeSnapshotLookupKey   `json:"lookupKey"`
	BudgetResolution       runtimeSnapshotBudget      `json:"budgetResolution"`
	ProviderCatalogRef     providercatalog.Reference  `json:"providerCatalogRef"`
	Policies               runtimeSnapshotPolicies    `json:"policies"`
	LegacyHashes           runtimeconfig.LegacyHashes `json:"legacyHashes"`
}

type runtimeSnapshotLookupKey struct {
	TenantID      string `json:"tenantId"`
	ProjectID     string `json:"projectId"`
	ApplicationID string `json:"applicationId"`
}

type runtimeSnapshotBudget struct {
	BudgetScopeType string `json:"budgetScopeType"`
	BudgetScopeID   string `json:"budgetScopeId"`
	ResolvedBy      string `json:"resolvedBy"`
}

type runtimeSnapshotPolicies struct {
	Safety    runtimeSnapshotSafetyPolicy    `json:"safety"`
	Routing   runtimeSnapshotRoutingPolicy   `json:"routing"`
	Cache     runtimeSnapshotCachePolicy     `json:"cache"`
	RateLimit runtimeSnapshotRateLimitPolicy `json:"rateLimit"`
	Fallback  runtimeSnapshotFallbackPolicy  `json:"fallback"`
}

type runtimeSnapshotSafetyPolicy struct {
	PolicyHash string `json:"policyHash"`
}

type runtimeSnapshotRoutingPolicy struct {
	DefaultProvider   string `json:"defaultProvider"`
	DefaultModel      string `json:"defaultModel"`
	RoutingPolicyHash string `json:"routingPolicyHash"`
}

type runtimeSnapshotCachePolicy struct {
	ExactCacheEnabled bool   `json:"exactCacheEnabled"`
	CachePolicyHash   string `json:"cachePolicyHash"`
}

type runtimeSnapshotRateLimitPolicy struct {
	Enabled       bool   `json:"enabled"`
	Scope         string `json:"scope"`
	WindowSeconds int    `json:"windowSeconds"`
	Limit         int    `json:"limit"`
}

type runtimeSnapshotFallbackPolicy struct {
	FallbackProvider string `json:"fallbackProvider"`
	FallbackModel    string `json:"fallbackModel"`
}

func (r runtimeSnapshotResponse) executionSnapshot(expected lookupKey) (runtimeconfig.ExecutionSnapshot, error) {
	actual := newLookupKey(r.LookupKey.TenantID, r.LookupKey.ProjectID, r.LookupKey.ApplicationID)
	if actual != expected {
		return runtimeconfig.ExecutionSnapshot{}, fmt.Errorf("%w: runtime snapshot lookup key mismatch", runtimeconfig.ErrScopeMismatch)
	}

	configHash := firstNonEmpty(r.LegacyHashes.ConfigHash, r.ContentHash)
	securityPolicyHash := firstNonEmpty(r.Policies.Safety.PolicyHash, r.LegacyHashes.SecurityPolicyHash)
	routingPolicyHash := firstNonEmpty(r.Policies.Routing.RoutingPolicyHash, r.LegacyHashes.RoutingPolicyHash)
	cacheType := ""
	if r.Policies.Cache.ExactCacheEnabled {
		cacheType = runtimeconfig.CacheTypeExact
	}

	defaultProvider := strings.TrimSpace(r.Policies.Routing.DefaultProvider)
	defaultModel := strings.TrimSpace(r.Policies.Routing.DefaultModel)
	fallbackProvider := firstNonEmpty(r.Policies.Fallback.FallbackProvider, defaultProvider)
	fallbackModel := firstNonEmpty(r.Policies.Fallback.FallbackModel, defaultModel)

	return runtimeconfig.ExecutionSnapshot{
		ConfigHash:    configHash,
		TenantID:      actual.tenantID,
		ProjectID:     actual.projectID,
		ApplicationID: actual.applicationID,
		BudgetScope: budget.Scope{
			Type:       r.BudgetResolution.BudgetScopeType,
			ID:         r.BudgetResolution.BudgetScopeID,
			ResolvedBy: r.BudgetResolution.ResolvedBy,
		},
		Snapshot: runtimeconfig.RuntimeSnapshotProvenance{
			RuntimeSnapshotID:      r.RuntimeSnapshotID,
			RuntimeSnapshotVersion: r.RuntimeSnapshotVersion,
			ContentHash:            r.ContentHash,
			RuntimeState:           r.RuntimeState,
			PublishedAt:            r.PublishedAt,
			PublishedBy:            r.PublishedBy,
			GatewayInstanceID:      r.GatewayInstanceID,
			ProviderCatalogRef:     r.ProviderCatalogRef,
			LegacyHashes:           r.LegacyHashes,
		},
		RateLimit: ratelimit.Config{
			Enabled:       r.Policies.RateLimit.Enabled,
			Scope:         firstNonEmpty(r.Policies.RateLimit.Scope, ratelimit.ScopeApplication),
			Algorithm:     ratelimit.AlgorithmFixedWindow,
			WindowSeconds: r.Policies.RateLimit.WindowSeconds,
			Limit:         r.Policies.RateLimit.Limit,
		},
		SafetyPolicy: runtimeconfig.SafetyPolicy{
			SecurityPolicyHash: securityPolicyHash,
		},
		RoutingPolicy: runtimeconfig.RoutingPolicy{
			DefaultProvider:   defaultProvider,
			DefaultModel:      defaultModel,
			LowCostProvider:   defaultProvider,
			LowCostModel:      defaultModel,
			FallbackProvider:  fallbackProvider,
			FallbackModel:     fallbackModel,
			RoutingPolicyHash: routingPolicyHash,
		},
		CachePolicy: runtimeconfig.CachePolicy{
			Enabled:         r.Policies.Cache.ExactCacheEnabled,
			Type:            cacheType,
			CachePolicyHash: r.Policies.Cache.CachePolicyHash,
		},
	}, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
