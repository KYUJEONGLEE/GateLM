package ratelimit

import (
	"context"
	"time"
)

const (
	ScopeApplication     = "application"
	AlgorithmFixedWindow = "fixed_window"

	ReasonWithinLimit       = "within_limit"
	ReasonLimitExceeded     = "limit_exceeded"
	ReasonRateLimitDisabled = "rate_limit_disabled"
	ReasonConfigMissing     = "config_missing"
	ReasonInternalError     = "internal_error"
)

type Config struct {
	Enabled       bool
	Scope         string
	Algorithm     string
	WindowSeconds int
	Limit         int
}

type Request struct {
	TenantID      string
	ProjectID     string
	ApplicationID string
	Config        Config
	Now           time.Time
}

type Decision struct {
	Allowed           bool      `json:"allowed"`
	Scope             string    `json:"scope"`
	ScopeID           string    `json:"scopeId"`
	Limit             int       `json:"limit"`
	Remaining         int       `json:"remaining"`
	WindowSeconds     int       `json:"windowSeconds"`
	WindowStart       time.Time `json:"windowStart"`
	ResetAt           time.Time `json:"resetAt"`
	RetryAfterSeconds int       `json:"retryAfterSeconds"`
	Reason            string    `json:"reason"`
	DurationMS        int64     `json:"durationMs"`
}

func (d *Decision) Clone() *Decision {
	if d == nil {
		return nil
	}
	cloned := *d
	return &cloned
}

type Limiter interface {
	Check(ctx context.Context, req Request) (Decision, error)
}

func NormalizeConfig(config Config) Config {
	if config.Scope == "" {
		config.Scope = ScopeApplication
	}
	if config.Algorithm == "" {
		config.Algorithm = AlgorithmFixedWindow
	}
	if config.WindowSeconds <= 0 {
		config.WindowSeconds = 60
	}
	return config
}

func NormalizeDecision(decision Decision, req Request) Decision {
	config := NormalizeConfig(req.Config)
	if decision.Scope == "" {
		decision.Scope = config.Scope
	}
	if decision.ScopeID == "" {
		decision.ScopeID = req.ApplicationID
	}
	if decision.WindowSeconds <= 0 {
		decision.WindowSeconds = config.WindowSeconds
	}
	if decision.Limit == 0 {
		decision.Limit = config.Limit
	}
	if decision.Reason == "" {
		if decision.Allowed {
			decision.Reason = ReasonWithinLimit
		} else {
			decision.Reason = ReasonLimitExceeded
		}
	}
	return decision
}
