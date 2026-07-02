package runtimeconfig

import (
	"context"
	"errors"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/routing"
)

const (
	PublishStateActive = "active"
	StatusActive       = "active"

	CacheTypeExact = "exact"

	RuntimeStateSnapshotActive     = "snapshot_active"
	RuntimeStateLastKnownSafeUsed  = "last_known_safe_used"
	RuntimeStateStaleSnapshotUsed  = "stale_snapshot_used"
	DefaultGatewayInstanceIDCompat = "gateway_core_static"
	DefaultPublishedByCompat       = "runtime_config_compat"
)

var (
	ErrMissingScope             = errors.New("runtime config scope is missing")
	ErrScopeMismatch            = errors.New("runtime config scope mismatch")
	ErrMissingCredentialBinding = errors.New("runtime config credential binding is missing")
	ErrInactiveConfig           = errors.New("runtime config is not active")
	ErrMissingRuntimeHash       = errors.New("runtime config hash is missing")
)

type Provider interface {
	GetActiveConfig(ctx context.Context, tenantID string, projectID string, applicationID string) (ActiveConfig, error)
}

type SnapshotProvider interface {
	GetExecutionSnapshot(ctx context.Context, tenantID string, projectID string, applicationID string) (ExecutionSnapshot, error)
}

type ActiveConfig struct {
	ConfigVersion string
	ConfigHash    string
	PublishState  string
	Snapshot      RuntimeSnapshotProvenance

	TenantID          string
	TenantStatus      string
	ProjectID         string
	ProjectStatus     string
	ApplicationID     string
	ApplicationStatus string
	APIKeyID          string
	APIKeyStatus      string
	AppTokenID        string
	AppTokenStatus    string

	RateLimit     ratelimit.Config
	BudgetPolicy  budget.Policy
	SafetyPolicy  SafetyPolicy
	RoutingPolicy RoutingPolicy
	CachePolicy   CachePolicy
}

type ExecutionSnapshot struct {
	ConfigHash    string
	TenantID      string
	ProjectID     string
	ApplicationID string
	BudgetScope   budget.Scope
	Snapshot      RuntimeSnapshotProvenance

	RateLimit     ratelimit.Config
	BudgetPolicy  budget.Policy
	SafetyPolicy  SafetyPolicy
	RoutingPolicy RoutingPolicy
	CachePolicy   CachePolicy
}

type RuntimeSnapshotProvenance struct {
	RuntimeSnapshotID      string
	RuntimeSnapshotVersion int
	ContentHash            string
	RuntimeState           string
	PublishedAt            time.Time
	PublishedBy            string
	GatewayInstanceID      string
	ProviderCatalogRef     providercatalog.Reference
	LegacyHashes           LegacyHashes
}

type LegacyHashes struct {
	ConfigHash         string
	SecurityPolicyHash string
	RoutingPolicyHash  string
}

type SafetyPolicy struct {
	SecurityPolicyHash string
}

type RoutingPolicy struct {
	DefaultProvider     string
	DefaultModel        string
	LowCostProvider     string
	LowCostModel        string
	FallbackProvider    string
	FallbackModel       string
	ShortPromptMaxChars int
	RoutingPolicyHash   string
}

type CachePolicy struct {
	Enabled         bool
	Type            string
	TTLSeconds      int
	CachePolicyHash string
}

func (c ActiveConfig) Normalize() ActiveConfig {
	c.ConfigVersion = strings.TrimSpace(c.ConfigVersion)
	c.ConfigHash = strings.TrimSpace(c.ConfigHash)
	c.PublishState = strings.TrimSpace(c.PublishState)
	c.TenantID = strings.TrimSpace(c.TenantID)
	c.TenantStatus = strings.TrimSpace(c.TenantStatus)
	c.ProjectID = strings.TrimSpace(c.ProjectID)
	c.ProjectStatus = strings.TrimSpace(c.ProjectStatus)
	c.ApplicationID = strings.TrimSpace(c.ApplicationID)
	c.ApplicationStatus = strings.TrimSpace(c.ApplicationStatus)
	c.APIKeyID = strings.TrimSpace(c.APIKeyID)
	c.APIKeyStatus = strings.TrimSpace(c.APIKeyStatus)
	c.AppTokenID = strings.TrimSpace(c.AppTokenID)
	c.AppTokenStatus = strings.TrimSpace(c.AppTokenStatus)
	c.RateLimit = ratelimit.NormalizeConfig(c.RateLimit)
	c.BudgetPolicy = budget.NormalizePolicy(c.BudgetPolicy)
	c.SafetyPolicy.SecurityPolicyHash = strings.TrimSpace(c.SafetyPolicy.SecurityPolicyHash)
	c.RoutingPolicy.DefaultProvider = strings.TrimSpace(c.RoutingPolicy.DefaultProvider)
	c.RoutingPolicy.DefaultModel = strings.TrimSpace(c.RoutingPolicy.DefaultModel)
	c.RoutingPolicy.LowCostProvider = strings.TrimSpace(c.RoutingPolicy.LowCostProvider)
	c.RoutingPolicy.LowCostModel = strings.TrimSpace(c.RoutingPolicy.LowCostModel)
	c.RoutingPolicy.FallbackProvider = strings.TrimSpace(c.RoutingPolicy.FallbackProvider)
	c.RoutingPolicy.FallbackModel = strings.TrimSpace(c.RoutingPolicy.FallbackModel)
	c.RoutingPolicy.RoutingPolicyHash = strings.TrimSpace(c.RoutingPolicy.RoutingPolicyHash)
	c.CachePolicy.Type = strings.TrimSpace(c.CachePolicy.Type)
	c.CachePolicy.CachePolicyHash = strings.TrimSpace(c.CachePolicy.CachePolicyHash)
	return c
}

func (c ActiveConfig) ValidateActive() error {
	c = c.Normalize()
	if c.TenantID == "" || c.ProjectID == "" || c.ApplicationID == "" {
		return ErrMissingScope
	}
	if c.APIKeyID == "" || c.AppTokenID == "" {
		return ErrMissingCredentialBinding
	}
	if c.ConfigHash == "" || c.SafetyPolicy.SecurityPolicyHash == "" || c.RoutingPolicy.RoutingPolicyHash == "" {
		return ErrMissingRuntimeHash
	}
	if c.PublishState != PublishStateActive ||
		c.TenantStatus != StatusActive ||
		c.ProjectStatus != StatusActive ||
		c.ApplicationStatus != StatusActive ||
		c.APIKeyStatus != StatusActive ||
		c.AppTokenStatus != StatusActive {
		return ErrInactiveConfig
	}
	return nil
}

func (c ActiveConfig) MatchesScope(tenantID string, projectID string, applicationID string) bool {
	c = c.Normalize()
	return c.TenantID == strings.TrimSpace(tenantID) &&
		c.ProjectID == strings.TrimSpace(projectID) &&
		c.ApplicationID == strings.TrimSpace(applicationID)
}

func (c ActiveConfig) ExecutionSnapshot() ExecutionSnapshot {
	c = c.Normalize()
	return ExecutionSnapshot{
		ConfigHash:    c.ConfigHash,
		TenantID:      c.TenantID,
		ProjectID:     c.ProjectID,
		ApplicationID: c.ApplicationID,
		BudgetScope:   budget.DefaultScope(c.ApplicationID),
		Snapshot:      c.Snapshot,
		RateLimit:     c.RateLimit,
		BudgetPolicy:  c.BudgetPolicy,
		SafetyPolicy:  c.SafetyPolicy,
		RoutingPolicy: c.RoutingPolicy,
		CachePolicy:   c.CachePolicy,
	}
}

func (s ExecutionSnapshot) Normalize(publishedAt time.Time, gatewayInstanceID string) ExecutionSnapshot {
	s.ConfigHash = strings.TrimSpace(s.ConfigHash)
	s.TenantID = strings.TrimSpace(s.TenantID)
	s.ProjectID = strings.TrimSpace(s.ProjectID)
	s.ApplicationID = strings.TrimSpace(s.ApplicationID)
	s.BudgetScope = budget.NormalizeScope(s.BudgetScope, s.ApplicationID)
	s.RateLimit = ratelimit.NormalizeConfig(s.RateLimit)
	s.BudgetPolicy = budget.NormalizePolicy(s.BudgetPolicy)
	s.SafetyPolicy.SecurityPolicyHash = strings.TrimSpace(s.SafetyPolicy.SecurityPolicyHash)
	s.RoutingPolicy.DefaultProvider = strings.TrimSpace(s.RoutingPolicy.DefaultProvider)
	s.RoutingPolicy.DefaultModel = strings.TrimSpace(s.RoutingPolicy.DefaultModel)
	s.RoutingPolicy.LowCostProvider = strings.TrimSpace(s.RoutingPolicy.LowCostProvider)
	s.RoutingPolicy.LowCostModel = strings.TrimSpace(s.RoutingPolicy.LowCostModel)
	s.RoutingPolicy.FallbackProvider = strings.TrimSpace(s.RoutingPolicy.FallbackProvider)
	s.RoutingPolicy.FallbackModel = strings.TrimSpace(s.RoutingPolicy.FallbackModel)
	s.RoutingPolicy.RoutingPolicyHash = strings.TrimSpace(s.RoutingPolicy.RoutingPolicyHash)
	s.CachePolicy.Type = strings.TrimSpace(s.CachePolicy.Type)
	s.CachePolicy.CachePolicyHash = strings.TrimSpace(s.CachePolicy.CachePolicyHash)
	s.Snapshot = s.Snapshot.Normalize(ActiveConfig{
		ConfigHash:    s.ConfigHash,
		SafetyPolicy:  s.SafetyPolicy,
		RoutingPolicy: s.RoutingPolicy,
	}, publishedAt, gatewayInstanceID)
	return s
}

func (s ExecutionSnapshot) Validate() error {
	s = s.Normalize(time.Time{}, "")
	if s.TenantID == "" || s.ProjectID == "" || s.ApplicationID == "" {
		return ErrMissingScope
	}
	if s.ConfigHash == "" || s.SafetyPolicy.SecurityPolicyHash == "" || s.RoutingPolicy.RoutingPolicyHash == "" {
		return ErrMissingRuntimeHash
	}
	return nil
}

func (s ExecutionSnapshot) MatchesScope(tenantID string, projectID string, applicationID string) bool {
	s = s.Normalize(time.Time{}, "")
	return s.TenantID == strings.TrimSpace(tenantID) &&
		s.ProjectID == strings.TrimSpace(projectID) &&
		s.ApplicationID == strings.TrimSpace(applicationID)
}

func (p RoutingPolicy) SimpleRouterConfig() routing.SimpleRouterConfig {
	return routing.SimpleRouterConfig{
		DefaultProvider:     p.DefaultProvider,
		DefaultModel:        p.DefaultModel,
		LowCostModel:        p.LowCostModel,
		HighQualityModel:    p.DefaultModel,
		PolicyHash:          p.RoutingPolicyHash,
		ShortPromptMaxChars: p.ShortPromptMaxChars,
	}
}

func (c ActiveConfig) RuntimeSnapshotProvenance(publishedAt time.Time, gatewayInstanceID string) RuntimeSnapshotProvenance {
	return c.Snapshot.Normalize(c, publishedAt, gatewayInstanceID)
}

func (p RuntimeSnapshotProvenance) Normalize(config ActiveConfig, publishedAt time.Time, gatewayInstanceID string) RuntimeSnapshotProvenance {
	p.RuntimeSnapshotID = strings.TrimSpace(p.RuntimeSnapshotID)
	p.ContentHash = strings.TrimSpace(p.ContentHash)
	p.RuntimeState = strings.TrimSpace(p.RuntimeState)
	p.PublishedBy = strings.TrimSpace(p.PublishedBy)
	p.GatewayInstanceID = strings.TrimSpace(p.GatewayInstanceID)
	p.ProviderCatalogRef = p.ProviderCatalogRef.Normalize()
	p.LegacyHashes = p.LegacyHashes.Normalize()

	if p.RuntimeSnapshotID == "" {
		p.RuntimeSnapshotID = firstNonEmptyString(config.ConfigVersion, "runtime_snapshot_compat")
	}
	if p.RuntimeSnapshotVersion <= 0 {
		p.RuntimeSnapshotVersion = 1
	}
	if p.ContentHash == "" {
		p.ContentHash = firstNonEmptyString(config.ConfigHash, p.LegacyHashes.ConfigHash)
	}
	if !IsActualRuntimeState(p.RuntimeState) {
		p.RuntimeState = RuntimeStateSnapshotActive
	}
	if p.PublishedAt.IsZero() {
		p.PublishedAt = publishedAt
	}
	if p.PublishedAt.IsZero() {
		p.PublishedAt = time.Unix(0, 0).UTC()
	} else {
		p.PublishedAt = p.PublishedAt.UTC()
	}
	if p.PublishedBy == "" {
		p.PublishedBy = DefaultPublishedByCompat
	}
	if p.GatewayInstanceID == "" {
		p.GatewayInstanceID = firstNonEmptyString(gatewayInstanceID, DefaultGatewayInstanceIDCompat)
	}
	if p.LegacyHashes.ConfigHash == "" {
		p.LegacyHashes.ConfigHash = strings.TrimSpace(config.ConfigHash)
	}
	if p.LegacyHashes.SecurityPolicyHash == "" {
		p.LegacyHashes.SecurityPolicyHash = strings.TrimSpace(config.SafetyPolicy.SecurityPolicyHash)
	}
	if p.LegacyHashes.RoutingPolicyHash == "" {
		p.LegacyHashes.RoutingPolicyHash = strings.TrimSpace(config.RoutingPolicy.RoutingPolicyHash)
	}
	return p
}

func (p RuntimeSnapshotProvenance) Metadata() map[string]any {
	metadata := map[string]any{
		"runtimeSnapshotId":      p.RuntimeSnapshotID,
		"runtimeSnapshotVersion": p.RuntimeSnapshotVersion,
		"contentHash":            p.ContentHash,
		"runtimeState":           p.RuntimeState,
		"publishedAt":            p.PublishedAt.UTC().Format(time.RFC3339Nano),
		"publishedBy":            p.PublishedBy,
		"gatewayInstanceId":      p.GatewayInstanceID,
	}
	if !p.LegacyHashes.IsZero() {
		metadata["legacyHashes"] = p.LegacyHashes.Metadata()
	}
	if !p.ProviderCatalogRef.IsZero() {
		metadata["providerCatalogRef"] = map[string]any{
			"catalogId":      p.ProviderCatalogRef.CatalogID,
			"catalogVersion": p.ProviderCatalogRef.CatalogVersion,
			"contentHash":    p.ProviderCatalogRef.ContentHash,
		}
	}
	return metadata
}

func (p RuntimeSnapshotProvenance) IsZero() bool {
	p.RuntimeSnapshotID = strings.TrimSpace(p.RuntimeSnapshotID)
	p.ContentHash = strings.TrimSpace(p.ContentHash)
	p.RuntimeState = strings.TrimSpace(p.RuntimeState)
	p.PublishedBy = strings.TrimSpace(p.PublishedBy)
	p.GatewayInstanceID = strings.TrimSpace(p.GatewayInstanceID)
	p.ProviderCatalogRef = p.ProviderCatalogRef.Normalize()
	return p.RuntimeSnapshotID == "" &&
		p.RuntimeSnapshotVersion == 0 &&
		p.ContentHash == "" &&
		p.RuntimeState == "" &&
		p.PublishedAt.IsZero() &&
		p.PublishedBy == "" &&
		p.GatewayInstanceID == "" &&
		p.ProviderCatalogRef.IsZero() &&
		p.LegacyHashes.IsZero()
}

func (h LegacyHashes) Normalize() LegacyHashes {
	return LegacyHashes{
		ConfigHash:         strings.TrimSpace(h.ConfigHash),
		SecurityPolicyHash: strings.TrimSpace(h.SecurityPolicyHash),
		RoutingPolicyHash:  strings.TrimSpace(h.RoutingPolicyHash),
	}
}

func (h LegacyHashes) IsZero() bool {
	h = h.Normalize()
	return h.ConfigHash == "" && h.SecurityPolicyHash == "" && h.RoutingPolicyHash == ""
}

func (h LegacyHashes) Metadata() map[string]string {
	h = h.Normalize()
	return map[string]string{
		"configHash":         h.ConfigHash,
		"securityPolicyHash": h.SecurityPolicyHash,
		"routingPolicyHash":  h.RoutingPolicyHash,
	}
}

func IsActualRuntimeState(value string) bool {
	switch strings.TrimSpace(value) {
	case RuntimeStateSnapshotActive, RuntimeStateLastKnownSafeUsed, RuntimeStateStaleSnapshotUsed:
		return true
	default:
		return false
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
