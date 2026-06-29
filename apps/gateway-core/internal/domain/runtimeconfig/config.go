package runtimeconfig

import (
	"context"
	"errors"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/routing"
)

const (
	PublishStateActive = "active"
	StatusActive       = "active"

	CacheTypeExact = "exact"
	SemanticCacheModeEvidenceOnly = "evidence_only"
	SemanticCacheModeDisabled = "disabled"

	SafetyModeEnforce = "enforce"
	SafetyModeDisabled = "disabled"
	SafetyActionAllow = "allow"
	SafetyActionRedact = "redact"
	SafetyActionBlock = "block"

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
	ErrEditableRuntimeConfig    = errors.New("editable runtime config is not executable")
	ErrMissingRuntimeSnapshot   = errors.New("published runtime snapshot provenance is missing")
	ErrInvalidSafetyPolicy      = errors.New("runtime snapshot safety policy is invalid")
	ErrInvalidCachePolicy       = errors.New("runtime snapshot cache policy is invalid")
	ErrInvalidBudgetPolicy      = errors.New("runtime snapshot budget policy is invalid")
)

type Provider interface {
	GetActiveConfig(ctx context.Context, tenantID string, projectID string, applicationID string) (ActiveConfig, error)
}

type ActiveConfig struct {
	ConfigVersion string
	ConfigHash    string
	PublishState  string
	PublishedRuntimeSnapshot bool
	Snapshot      RuntimeSnapshotProvenance
	BudgetResolution budget.Scope

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

type RuntimeSnapshotProvenance struct {
	RuntimeSnapshotID      string
	RuntimeSnapshotVersion int
	ContentHash            string
	RuntimeState           string
	PublishedAt            time.Time
	PublishedBy            string
	GatewayInstanceID      string
	LegacyHashes           LegacyHashes
}

type LegacyHashes struct {
	ConfigHash         string
	SecurityPolicyHash string
	RoutingPolicyHash  string
}

type SafetyPolicy struct {
	SecurityPolicyHash string
	Enabled            bool
	Mode               string
	RequestSideRequired bool
	PolicyHash         string
	DetectorSet        []SafetyDetector
}

type SafetyDetector struct {
	DetectorType string
	Action       string
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
	Enabled           bool
	Type              string
	TTLSeconds        int
	SemanticCacheMode string
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
	c.BudgetResolution = budget.NormalizeScope(c.BudgetResolution, c.ApplicationID)
	c.ApplicationStatus = strings.TrimSpace(c.ApplicationStatus)
	c.APIKeyID = strings.TrimSpace(c.APIKeyID)
	c.APIKeyStatus = strings.TrimSpace(c.APIKeyStatus)
	c.AppTokenID = strings.TrimSpace(c.AppTokenID)
	c.AppTokenStatus = strings.TrimSpace(c.AppTokenStatus)
	c.RateLimit = ratelimit.NormalizeConfig(c.RateLimit)
	c.BudgetPolicy = budget.NormalizePolicy(c.BudgetPolicy)
	c.SafetyPolicy.SecurityPolicyHash = strings.TrimSpace(c.SafetyPolicy.SecurityPolicyHash)
	c.SafetyPolicy.Mode = strings.TrimSpace(c.SafetyPolicy.Mode)
	c.SafetyPolicy.PolicyHash = strings.TrimSpace(c.SafetyPolicy.PolicyHash)
	for index := range c.SafetyPolicy.DetectorSet {
		c.SafetyPolicy.DetectorSet[index].DetectorType = strings.TrimSpace(c.SafetyPolicy.DetectorSet[index].DetectorType)
		c.SafetyPolicy.DetectorSet[index].Action = strings.TrimSpace(c.SafetyPolicy.DetectorSet[index].Action)
	}
	c.RoutingPolicy.DefaultProvider = strings.TrimSpace(c.RoutingPolicy.DefaultProvider)
	c.RoutingPolicy.DefaultModel = strings.TrimSpace(c.RoutingPolicy.DefaultModel)
	c.RoutingPolicy.LowCostProvider = strings.TrimSpace(c.RoutingPolicy.LowCostProvider)
	c.RoutingPolicy.LowCostModel = strings.TrimSpace(c.RoutingPolicy.LowCostModel)
	c.RoutingPolicy.FallbackProvider = strings.TrimSpace(c.RoutingPolicy.FallbackProvider)
	c.RoutingPolicy.FallbackModel = strings.TrimSpace(c.RoutingPolicy.FallbackModel)
	c.RoutingPolicy.RoutingPolicyHash = strings.TrimSpace(c.RoutingPolicy.RoutingPolicyHash)
	c.CachePolicy.Type = strings.TrimSpace(c.CachePolicy.Type)
	c.CachePolicy.SemanticCacheMode = strings.TrimSpace(c.CachePolicy.SemanticCacheMode)
	return c
}

func (c ActiveConfig) ValidateActive() error {
	if err := validateBudgetPolicy(c.BudgetPolicy); err != nil {
		return err
	}
	c = c.Normalize()
	if !c.PublishedRuntimeSnapshot {
		return ErrEditableRuntimeConfig
	}
	if c.TenantID == "" || c.ProjectID == "" || c.ApplicationID == "" {
		return ErrMissingScope
	}
	if c.APIKeyID == "" || c.AppTokenID == "" {
		return ErrMissingCredentialBinding
	}
	if c.ConfigHash == "" || c.SafetyPolicy.SecurityPolicyHash == "" || c.RoutingPolicy.RoutingPolicyHash == "" {
		return ErrMissingRuntimeHash
	}
	if c.Snapshot.RuntimeSnapshotID == "" || c.Snapshot.RuntimeSnapshotVersion <= 0 || c.Snapshot.ContentHash == "" {
		return ErrMissingRuntimeSnapshot
	}
	if err := c.SafetyPolicy.Validate(); err != nil {
		return err
	}
	if err := c.CachePolicy.Validate(); err != nil {
		return err
	}
	if err := validateBudgetPolicy(c.BudgetPolicy); err != nil {
		return err
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

func (p RoutingPolicy) SimpleRouterConfig() routing.SimpleRouterConfig {
	return routing.SimpleRouterConfig{
		DefaultProvider:     p.DefaultProvider,
		DefaultModel:        p.DefaultModel,
		LowCostModel:        p.LowCostModel,
		HighQualityModel:    p.FallbackModel,
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

func (p SafetyPolicy) Normalize() SafetyPolicy {
	p.SecurityPolicyHash = strings.TrimSpace(p.SecurityPolicyHash)
	p.Mode = strings.TrimSpace(p.Mode)
	p.PolicyHash = strings.TrimSpace(p.PolicyHash)
	for index := range p.DetectorSet {
		p.DetectorSet[index].DetectorType = strings.TrimSpace(p.DetectorSet[index].DetectorType)
		p.DetectorSet[index].Action = strings.TrimSpace(p.DetectorSet[index].Action)
	}
	if p.PolicyHash == "" {
		p.PolicyHash = p.SecurityPolicyHash
	}
	return p
}

func (p SafetyPolicy) Validate() error {
	p = p.Normalize()
	if p.PolicyHash == "" || p.SecurityPolicyHash == "" {
		return ErrMissingRuntimeHash
	}
	if p.Mode != SafetyModeEnforce && p.Mode != SafetyModeDisabled {
		return ErrInvalidSafetyPolicy
	}
	if p.Enabled && p.Mode == SafetyModeDisabled {
		return ErrInvalidSafetyPolicy
	}
	for _, detector := range p.DetectorSet {
		if !isSanitizedLowCardinalityLabel(detector.DetectorType) {
			return ErrInvalidSafetyPolicy
		}
		switch detector.Action {
		case SafetyActionAllow, SafetyActionRedact, SafetyActionBlock:
		default:
			return ErrInvalidSafetyPolicy
		}
	}
	return nil
}

func (p CachePolicy) Normalize() CachePolicy {
	p.Type = strings.TrimSpace(p.Type)
	p.SemanticCacheMode = strings.TrimSpace(p.SemanticCacheMode)
	return p
}

func (p CachePolicy) Validate() error {
	p = p.Normalize()
	switch p.SemanticCacheMode {
	case SemanticCacheModeEvidenceOnly, SemanticCacheModeDisabled:
		return nil
	default:
		return ErrInvalidCachePolicy
	}
}

func validateBudgetPolicy(policy budget.Policy) error {
	mode := strings.TrimSpace(policy.EnforcementMode)
	if mode != "" && !budget.IsAllowedEnforcementMode(mode) {
		return ErrInvalidBudgetPolicy
	}
	return nil
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
	return metadata
}

func (p RuntimeSnapshotProvenance) IsZero() bool {
	p.RuntimeSnapshotID = strings.TrimSpace(p.RuntimeSnapshotID)
	p.ContentHash = strings.TrimSpace(p.ContentHash)
	p.RuntimeState = strings.TrimSpace(p.RuntimeState)
	p.PublishedBy = strings.TrimSpace(p.PublishedBy)
	p.GatewayInstanceID = strings.TrimSpace(p.GatewayInstanceID)
	return p.RuntimeSnapshotID == "" &&
		p.RuntimeSnapshotVersion == 0 &&
		p.ContentHash == "" &&
		p.RuntimeState == "" &&
		p.PublishedAt.IsZero() &&
		p.PublishedBy == "" &&
		p.GatewayInstanceID == "" &&
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

func isSanitizedLowCardinalityLabel(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 80 {
		return false
	}
	for index, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= '0' && r <= '9' && index > 0:
		case r == '_' || r == '-':
		default:
			return false
		}
	}
	return value[0] >= 'a' && value[0] <= 'z'
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
