package runtimeconfig

import (
	"context"
	"errors"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/routing"
)

const (
	PublishStateActive = "active"
	StatusActive       = "active"

	CacheTypeExact = "exact"
)

var (
	ErrMissingScope       = errors.New("runtime config scope is missing")
	ErrScopeMismatch      = errors.New("runtime config scope mismatch")
	ErrInactiveConfig     = errors.New("runtime config is not active")
	ErrMissingRuntimeHash = errors.New("runtime config hash is missing")
)

type Provider interface {
	GetActiveConfig(ctx context.Context, tenantID string, projectID string, applicationID string) (ActiveConfig, error)
}

type ActiveConfig struct {
	ConfigVersion string
	ConfigHash    string
	PublishState  string

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
	SafetyPolicy  SafetyPolicy
	RoutingPolicy RoutingPolicy
	CachePolicy   CachePolicy
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
	Enabled    bool
	Type       string
	TTLSeconds int
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
	c.SafetyPolicy.SecurityPolicyHash = strings.TrimSpace(c.SafetyPolicy.SecurityPolicyHash)
	c.RoutingPolicy.DefaultProvider = strings.TrimSpace(c.RoutingPolicy.DefaultProvider)
	c.RoutingPolicy.DefaultModel = strings.TrimSpace(c.RoutingPolicy.DefaultModel)
	c.RoutingPolicy.LowCostProvider = strings.TrimSpace(c.RoutingPolicy.LowCostProvider)
	c.RoutingPolicy.LowCostModel = strings.TrimSpace(c.RoutingPolicy.LowCostModel)
	c.RoutingPolicy.FallbackProvider = strings.TrimSpace(c.RoutingPolicy.FallbackProvider)
	c.RoutingPolicy.FallbackModel = strings.TrimSpace(c.RoutingPolicy.FallbackModel)
	c.RoutingPolicy.RoutingPolicyHash = strings.TrimSpace(c.RoutingPolicy.RoutingPolicyHash)
	c.CachePolicy.Type = strings.TrimSpace(c.CachePolicy.Type)
	return c
}

func (c ActiveConfig) ValidateActive() error {
	c = c.Normalize()
	if c.TenantID == "" || c.ProjectID == "" || c.ApplicationID == "" {
		return ErrMissingScope
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
