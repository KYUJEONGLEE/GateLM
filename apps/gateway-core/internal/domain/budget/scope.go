package budget

import "strings"

const (
	ScopeTypeApplication = "application"
	ScopeTypeProject     = "project"
	ScopeTypeTeam        = "team"

	ResolvedByDefaultApplication = "default_application"
	ResolvedByRuntimeSnapshot    = "runtime_snapshot"
	ResolvedByControlPlaneRule   = "control_plane_rule"
)

type Scope struct {
	Type       string
	ID         string
	ResolvedBy string
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

func ToMetadata(scope Scope, applicationID string) map[string]string {
	normalized := NormalizeScope(scope, applicationID)
	return map[string]string{
		"budgetScopeType": normalized.Type,
		"budgetScopeId":   normalized.ID,
		"resolvedBy":      normalized.ResolvedBy,
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
