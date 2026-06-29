package budget

import (
	"context"
	"strings"
)

const (
	ScopeTypeApplication = "application"
	ScopeTypeProject     = "project"
	ScopeTypeTeam        = "team"

	ResolvedByDefaultApplication = "default_application"
	ResolvedByRuntimeSnapshot    = "runtime_snapshot"
	ResolvedByControlPlaneRule   = "control_plane_rule"

	EnforcementModeWarn     = "warn"
	EnforcementModeBlock    = "block"
	EnforcementModeDisabled = "disabled"

	OutcomeAllowed = "allowed"
	OutcomeWarned  = "warned"
	OutcomeBlocked = "blocked"
	OutcomeNotUsed = "not_used"
)

type Scope struct {
	Type       string
	ID         string
	ResolvedBy string
}

type Policy struct {
	Enabled                 bool
	EnforcementMode         string
	WarningThresholdPercent float64
}

type Request struct {
	TenantID      string
	ProjectID     string
	ApplicationID string
	Scope         Scope
	Policy        Policy
}

type Decision struct {
	Outcome string
	Scope   Scope
}

type Checker interface {
	CheckBudget(ctx context.Context, req Request) (Decision, error)
}

type AllowAllChecker struct{}

func (AllowAllChecker) CheckBudget(_ context.Context, req Request) (Decision, error) {
	policy := NormalizePolicy(req.Policy)
	scope := NormalizeScope(req.Scope, req.ApplicationID)
	if !policy.Enabled || policy.EnforcementMode == EnforcementModeDisabled {
		return Decision{Outcome: OutcomeNotUsed, Scope: scope}, nil
	}
	if policy.EnforcementMode == EnforcementModeWarn {
		return Decision{Outcome: OutcomeWarned, Scope: scope}, nil
	}
	return Decision{Outcome: OutcomeAllowed, Scope: scope}, nil
}

func DefaultScope(applicationID string) Scope {
	return Scope{
		Type:       ScopeTypeApplication,
		ID:         strings.TrimSpace(applicationID),
		ResolvedBy: ResolvedByDefaultApplication,
	}
}

func NormalizeScope(scope Scope, applicationID string) Scope {
	scope.Type = strings.TrimSpace(scope.Type)
	scope.ID = strings.TrimSpace(scope.ID)
	scope.ResolvedBy = strings.TrimSpace(scope.ResolvedBy)

	if !IsAllowedScopeType(scope.Type) || scope.ID == "" || !IsAllowedResolvedBy(scope.ResolvedBy) {
		return DefaultScope(applicationID)
	}
	return scope
}

func NormalizePolicy(policy Policy) Policy {
	policy.EnforcementMode = strings.TrimSpace(policy.EnforcementMode)
	if policy.EnforcementMode == "" {
		if policy.Enabled {
			policy.EnforcementMode = EnforcementModeWarn
		} else {
			policy.EnforcementMode = EnforcementModeDisabled
		}
	}
	if !IsAllowedEnforcementMode(policy.EnforcementMode) {
		policy.Enabled = false
		policy.EnforcementMode = EnforcementModeDisabled
	}
	if policy.WarningThresholdPercent < 0 {
		policy.WarningThresholdPercent = 0
	}
	if policy.WarningThresholdPercent > 100 {
		policy.WarningThresholdPercent = 100
	}
	return policy
}

func NormalizeDecision(decision Decision, req Request) Decision {
	decision.Outcome = strings.TrimSpace(decision.Outcome)
	if !IsAllowedOutcome(decision.Outcome) {
		decision.Outcome = OutcomeAllowed
	}
	decision.Scope = NormalizeScope(decision.Scope, req.ApplicationID)
	if decision.Scope.ID == "" {
		decision.Scope = NormalizeScope(req.Scope, req.ApplicationID)
	}
	return decision
}

func ToMetadata(scope Scope, applicationID string) map[string]string {
	normalized := NormalizeScope(scope, applicationID)
	return map[string]string{
		"budgetScopeType": normalized.Type,
		"budgetScopeId":   normalized.ID,
		"resolvedBy":      normalized.ResolvedBy,
	}
}

func IsAllowedEnforcementMode(value string) bool {
	switch value {
	case EnforcementModeWarn, EnforcementModeBlock, EnforcementModeDisabled:
		return true
	default:
		return false
	}
}

func IsAllowedOutcome(value string) bool {
	switch value {
	case OutcomeAllowed, OutcomeWarned, OutcomeBlocked, OutcomeNotUsed:
		return true
	default:
		return false
	}
}

func IsAllowedScopeType(value string) bool {
	switch value {
	case ScopeTypeApplication, ScopeTypeProject, ScopeTypeTeam:
		return true
	default:
		return false
	}
}

func IsAllowedResolvedBy(value string) bool {
	switch value {
	case ResolvedByDefaultApplication, ResolvedByRuntimeSnapshot, ResolvedByControlPlaneRule:
		return true
	default:
		return false
	}
}
