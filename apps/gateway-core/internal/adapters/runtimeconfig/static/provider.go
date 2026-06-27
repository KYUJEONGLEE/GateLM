package static

import (
	"context"
	"fmt"

	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
)

type Provider struct {
	config runtimeconfig.ActiveConfig
}

func NewProvider(config runtimeconfig.ActiveConfig) *Provider {
	return &Provider{config: config.Normalize()}
}

func (p *Provider) GetActiveConfig(_ context.Context, tenantID string, projectID string, applicationID string) (runtimeconfig.ActiveConfig, error) {
	if p == nil {
		return runtimeconfig.ActiveConfig{}, runtimeconfig.ErrInactiveConfig
	}

	config := p.config.Normalize()
	if err := config.ValidateActive(); err != nil {
		return runtimeconfig.ActiveConfig{}, fmt.Errorf("static active runtime config: %w", err)
	}
	if !config.MatchesScope(tenantID, projectID, applicationID) {
		return runtimeconfig.ActiveConfig{}, runtimeconfig.ErrScopeMismatch
	}

	return config, nil
}
