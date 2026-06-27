package request

import (
	"time"

	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
)

type GatewayContext struct {
	Request    RequestContext
	Identity   IdentityContext
	Runtime    RuntimeContext
	Governance GovernanceContext
	Masking    MaskingContext
	Routing    RoutingContext
	Cache      CacheContext
	Status     StatusContext
}

type RequestContext struct {
	RequestID      string
	TraceID        string
	Endpoint       string
	Method         string
	Stream         bool
	StartedAt      time.Time
	RequestedModel string
	PromptText     string
}

type IdentityContext struct {
	TenantID      string
	ProjectID     string
	ApplicationID string
	APIKeyID      string
	AppTokenID    string
	EndUserID     string
	FeatureID     string
}

type RuntimeContext struct {
	ConfigHash         string
	SecurityPolicyHash string
	RoutingPolicyHash  string

	RateLimitConfig    ratelimit.Config
	HasRateLimitConfig bool
	RoutingPolicy      runtimeconfig.RoutingPolicy
	HasRoutingPolicy   bool
	CachePolicy        runtimeconfig.CachePolicy
	HasCachePolicy     bool
}

type GovernanceContext struct {
	RateLimitDecision *ratelimit.Decision
}

type MaskingContext struct {
	Action                  string
	DetectedTypes           []string
	DetectedCount           int
	RedactedPrompt          string
	RedactedPromptPreview   string
	SecurityPolicyVersionID string
}

type RoutingContext struct {
	RequestedModel    string
	SelectedProvider  string
	SelectedModel     string
	RoutingReason     string
	RoutingPolicyHash string
}

type CacheContext struct {
	CacheStatus       string
	CacheType         string
	CacheKeyHash      string
	CacheHitRequestID string
	SavedCostMicroUSD int64
	Payload           []byte
}

type StatusContext struct {
	Status       string
	HTTPStatus   int
	ErrorCode    string
	ErrorMessage string
	ErrorStage   string
}

func (c *GatewayContext) SetError(httpStatus int, code string, message string, stage string) {
	c.Status = StatusContext{
		Status:       "error",
		HTTPStatus:   httpStatus,
		ErrorCode:    code,
		ErrorMessage: message,
		ErrorStage:   stage,
	}
}
