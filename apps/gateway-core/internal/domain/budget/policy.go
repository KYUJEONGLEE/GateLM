package budget

import (
	"context"
	"strings"
	"time"
)

const (
	EnforcementModeWarn     = "warn"
	EnforcementModeBlock    = "block"
	EnforcementModeDisabled = "disabled"

	OutcomeAllowed    = "allowed"
	OutcomeWarned     = "warned"
	OutcomeDegraded   = "degraded"
	OutcomeBlocked    = "blocked"
	OutcomeNotUsed    = "not_used"
	OutcomeNotChecked = "not_checked"

	DefaultWarningThresholdPercent = 80
)

type Policy struct {
	Enabled                 bool
	EnforcementMode         string
	WarningThresholdPercent int
}

type Request struct {
	TenantID      string
	ProjectID     string
	ApplicationID string
	Scope         Scope
	Policy        Policy
	Now           time.Time
}

type Decision struct {
	Allowed                 bool
	Outcome                 string
	Scope                   Scope
	Policy                  Policy
	WarningThresholdPercent int
	Reason                  string
	UsageKnown              bool
	LimitMicroUSD           int64
	UsedMicroUSD            int64
	RemainingMicroUSD       int64
	UsagePercent            float64
}

type Checker interface {
	Check(ctx context.Context, req Request) (Decision, error)
}

// AllowChecker is the default no-op checker until a real ledger/limit source is wired.
type AllowChecker struct{}

func (AllowChecker) Check(_ context.Context, req Request) (Decision, error) {
	policy := NormalizePolicy(req.Policy)
	outcome := OutcomeNotChecked
	if !policy.Enabled {
		outcome = OutcomeNotUsed
	}
	return NormalizeDecision(Decision{
		Allowed:                 true,
		Outcome:                 outcome,
		Scope:                   req.Scope,
		Policy:                  policy,
		WarningThresholdPercent: policy.WarningThresholdPercent,
	}, req), nil
}

func NormalizePolicy(policy Policy) Policy {
	mode := strings.TrimSpace(policy.EnforcementMode)
	if !policy.Enabled && mode == "" && policy.WarningThresholdPercent == 0 {
		return Policy{
			Enabled:                 false,
			EnforcementMode:         EnforcementModeDisabled,
			WarningThresholdPercent: DefaultWarningThresholdPercent,
		}
	}

	switch mode {
	case EnforcementModeWarn, EnforcementModeBlock:
		if policy.Enabled {
			policy.EnforcementMode = mode
		} else {
			policy.EnforcementMode = EnforcementModeDisabled
		}
	case EnforcementModeDisabled:
		policy.Enabled = false
		policy.EnforcementMode = EnforcementModeDisabled
	default:
		if policy.Enabled {
			policy.EnforcementMode = EnforcementModeWarn
		} else {
			policy.EnforcementMode = EnforcementModeDisabled
		}
	}

	if !policy.Enabled {
		policy.EnforcementMode = EnforcementModeDisabled
	}
	if policy.WarningThresholdPercent < 0 || policy.WarningThresholdPercent > 100 {
		policy.WarningThresholdPercent = DefaultWarningThresholdPercent
	}
	return policy
}

func NormalizeDecision(decision Decision, req Request) Decision {
	req.Policy = NormalizePolicy(req.Policy)
	if isZeroPolicy(decision.Policy) {
		decision.Policy = req.Policy
	}
	decision.Policy = NormalizePolicy(decision.Policy)
	decision.Scope = NormalizeScope(decision.Scope, req.ApplicationID)
	if strings.TrimSpace(decision.Scope.ID) == "" {
		decision.Scope = NormalizeScope(req.Scope, req.ApplicationID)
	}
	if decision.WarningThresholdPercent < 0 || decision.WarningThresholdPercent > 100 {
		decision.WarningThresholdPercent = decision.Policy.WarningThresholdPercent
	}
	switch strings.TrimSpace(decision.Outcome) {
	case OutcomeBlocked:
		decision.Outcome = OutcomeBlocked
		decision.Allowed = false
	case OutcomeWarned:
		decision.Outcome = OutcomeWarned
		decision.Allowed = true
	case OutcomeDegraded:
		decision.Outcome = OutcomeDegraded
		decision.Allowed = true
	case OutcomeAllowed:
		decision.Outcome = OutcomeAllowed
		decision.Allowed = true
	case OutcomeNotUsed:
		decision.Outcome = OutcomeNotUsed
		decision.Allowed = true
	case OutcomeNotChecked:
		decision.Outcome = OutcomeNotChecked
		decision.Allowed = true
	default:
		if !decision.Policy.Enabled {
			decision.Outcome = OutcomeNotUsed
		} else {
			decision.Outcome = OutcomeAllowed
		}
		decision.Allowed = true
	}
	return decision
}

func RestrictsHighQuality(decision *Decision) bool {
	if decision == nil {
		return false
	}
	switch strings.TrimSpace(decision.Outcome) {
	case OutcomeWarned, OutcomeDegraded, OutcomeBlocked:
		return true
	default:
		return false
	}
}

func (d *Decision) Clone() *Decision {
	if d == nil {
		return nil
	}
	cloned := *d
	return &cloned
}

func isZeroPolicy(policy Policy) bool {
	return !policy.Enabled &&
		strings.TrimSpace(policy.EnforcementMode) == "" &&
		policy.WarningThresholdPercent == 0
}
