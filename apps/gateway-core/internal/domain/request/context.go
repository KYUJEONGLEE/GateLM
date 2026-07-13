package request

import (
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/employeepolicy"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/domain/stagetiming"
)

type GatewayContext struct {
	Request    RequestContext
	Identity   IdentityContext
	Budget     budget.Scope
	Runtime    RuntimeContext
	Governance GovernanceContext
	Masking    MaskingContext
	Routing    RoutingContext
	Cache      CacheContext
	Status     StatusContext

	StageTimings stagetiming.Timings
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
	TenantID       string
	ProjectID      string
	ApplicationID  string
	APIKeyID       string
	AppTokenID     string
	TrustedActorID string
	EmployeeID     string
	EndUserID      string
	FeatureID      string
}

type RuntimeContext struct {
	ConfigHash         string
	SecurityPolicyHash string
	RoutingPolicyHash  string
	Snapshot           runtimeconfig.RuntimeSnapshotProvenance
	SafetyPolicy       runtimeconfig.SafetyPolicy
	EmployeePolicy     employeepolicy.Policy
	HasEmployeePolicy  bool

	RateLimitConfig    ratelimit.Config
	HasRateLimitConfig bool
	BudgetPolicy       budget.Policy
	HasBudgetPolicy    bool
	RoutingPolicy      runtimeconfig.RoutingPolicy
	HasRoutingPolicy   bool
	CachePolicy        runtimeconfig.CachePolicy
	HasCachePolicy     bool
	PromptCapture      runtimeconfig.PromptCapturePolicy
	HasPromptCapture   bool
	ResponseCapture    runtimeconfig.ResponseCapturePolicy
	HasResponseCapture bool
}

type GovernanceContext struct {
	RateLimitDecision      *ratelimit.Decision
	BudgetDecision         *budget.Decision
	EmployeePolicyDecision *employeepolicy.Decision
}

type MaskingContext struct {
	Action                  string
	DetectedTypes           []string
	DetectedCount           int
	PolicyAllowedTypes      []string
	MandatoryProtectedTypes []string
	RedactedPrompt          string
	RedactedPromptPreview   string
	SecurityPolicyVersionID string
}

type RoutingContext struct {
	RequestedModel          string
	ModelRef                string
	CandidateModelRefs      []string
	RoutingDecisionKeyHash  string
	RoutingDecisionMaterial map[string]string
	RoutingReason           string
	RoutingPolicyHash       string
	CategoryDiagnostics     routing.CategoryDiagnostics
}

type CacheContext struct {
	CacheStatus         string
	CacheType           string
	CacheKeyHash        string
	CacheHitRequestID   string
	CacheKeyVersion     string
	CacheDecisionReason string
	FallbackOccurred    bool
	SavedCostMicroUSD   int64
	Payload             []byte
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
		Status:       "failed",
		HTTPStatus:   httpStatus,
		ErrorCode:    code,
		ErrorMessage: message,
		ErrorStage:   stage,
	}
}

func (c *GatewayContext) BypassCache() {
	if c == nil {
		return
	}
	c.Cache.CacheStatus = "bypass"
	c.Cache.CacheType = "none"
	c.Cache.CacheKeyHash = ""
	c.Cache.CacheHitRequestID = ""
	c.Cache.CacheKeyVersion = ""
	c.Cache.CacheDecisionReason = "bypassed"
	c.Cache.FallbackOccurred = false
	c.Cache.SavedCostMicroUSD = 0
	c.Cache.Payload = nil
}
