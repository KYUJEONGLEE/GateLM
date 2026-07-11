package employeepolicy

import (
	"context"
	"errors"
	"strings"
	"time"
)

const (
	QuotaOutcomeAllowed  = "allowed"
	QuotaOutcomeWarned   = "warned"
	QuotaOutcomeExceeded = "exceeded"
	QuotaOutcomeNotUsed  = "not_used"

	QuotaReasonWithinLimit             = "employee_quota_within_limit"
	QuotaReasonWarningThresholdReached = "employee_quota_warning_threshold_reached"
	QuotaReasonExceededQualityGuard    = "employee_quota_exceeded_quality_guard"
	QuotaReasonNotConfigured           = "employee_quota_not_configured"
)

var (
	ErrNotFound    = errors.New("employee policy not found")
	ErrUnavailable = errors.New("employee policy resolver unavailable")
)

type ResolveRequest struct {
	TenantID  string
	ProjectID string
	ActorID   string
	Now       time.Time
}

type RateLimitPolicy struct {
	Enabled       bool `json:"enabled"`
	Limit         int  `json:"limit"`
	WindowSeconds int  `json:"windowSeconds"`
}

type QuotaPolicy struct {
	Enabled                 bool  `json:"enabled"`
	LimitMicroUSD           int64 `json:"limitMicroUsd"`
	UsedMicroUSD            int64 `json:"usedMicroUsd"`
	WarningThresholdPercent int   `json:"warningThresholdPercent"`
}

type Policy struct {
	TenantID   string          `json:"tenantId"`
	ProjectID  string          `json:"projectId"`
	EmployeeID string          `json:"employeeId"`
	RateLimit  RateLimitPolicy `json:"rateLimit"`
	Quota      QuotaPolicy     `json:"quota"`
}

type Decision struct {
	EmployeeID              string `json:"employeeId"`
	QuotaOutcome            string `json:"quotaOutcome"`
	QuotaReason             string `json:"quotaReason"`
	QuotaLimitMicroUSD      int64  `json:"quotaLimitMicroUsd"`
	QuotaUsedMicroUSD       int64  `json:"quotaUsedMicroUsd"`
	QuotaRemainingMicroUSD  int64  `json:"quotaRemainingMicroUsd"`
	WarningThresholdPercent int    `json:"warningThresholdPercent"`
}

type Resolver interface {
	Resolve(ctx context.Context, req ResolveRequest) (Policy, error)
}

func Normalize(policy Policy) Policy {
	policy.TenantID = strings.TrimSpace(policy.TenantID)
	policy.ProjectID = strings.TrimSpace(policy.ProjectID)
	policy.EmployeeID = strings.TrimSpace(policy.EmployeeID)
	if policy.RateLimit.Limit <= 0 ||
		policy.RateLimit.Limit > 100000 ||
		policy.RateLimit.WindowSeconds <= 0 ||
		policy.RateLimit.WindowSeconds > 3600 {
		policy.RateLimit.Enabled = false
	}
	if policy.Quota.LimitMicroUSD <= 0 {
		policy.Quota.Enabled = false
	}
	if policy.Quota.UsedMicroUSD < 0 {
		policy.Quota.UsedMicroUSD = 0
	}
	if policy.Quota.WarningThresholdPercent < 0 || policy.Quota.WarningThresholdPercent > 100 {
		policy.Quota.WarningThresholdPercent = 80
	}
	return policy
}

func Evaluate(policy Policy) Decision {
	policy = Normalize(policy)
	decision := Decision{
		EmployeeID:              policy.EmployeeID,
		QuotaOutcome:            QuotaOutcomeNotUsed,
		QuotaReason:             QuotaReasonNotConfigured,
		QuotaLimitMicroUSD:      policy.Quota.LimitMicroUSD,
		QuotaUsedMicroUSD:       policy.Quota.UsedMicroUSD,
		QuotaRemainingMicroUSD:  policy.Quota.LimitMicroUSD - policy.Quota.UsedMicroUSD,
		WarningThresholdPercent: policy.Quota.WarningThresholdPercent,
	}
	if !policy.Quota.Enabled {
		return decision
	}
	if policy.Quota.UsedMicroUSD >= policy.Quota.LimitMicroUSD {
		decision.QuotaOutcome = QuotaOutcomeExceeded
		decision.QuotaReason = QuotaReasonExceededQualityGuard
		return decision
	}
	warningAt := policy.Quota.LimitMicroUSD * int64(policy.Quota.WarningThresholdPercent) / 100
	if policy.Quota.WarningThresholdPercent > 0 && policy.Quota.UsedMicroUSD >= warningAt {
		decision.QuotaOutcome = QuotaOutcomeWarned
		decision.QuotaReason = QuotaReasonWarningThresholdReached
		return decision
	}
	decision.QuotaOutcome = QuotaOutcomeAllowed
	decision.QuotaReason = QuotaReasonWithinLimit
	return decision
}

func RestrictsHighQuality(decision *Decision) bool {
	return decision != nil && decision.QuotaOutcome == QuotaOutcomeExceeded
}

func (d *Decision) Clone() *Decision {
	if d == nil {
		return nil
	}
	cloned := *d
	return &cloned
}
