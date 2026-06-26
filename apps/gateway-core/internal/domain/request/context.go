package request

import "time"

type GatewayContext struct {
	Request  RequestContext
	Identity IdentityContext
	Masking  MaskingContext
	Routing  RoutingContext
	Cache    CacheContext
	Status   StatusContext
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
}

type RoutingContext struct {
	RequestedModel    string
	SelectedProvider  string
	SelectedModel     string
	RoutingReason     string
	RoutingPolicyHash string
}

type MaskingContext struct {
	Action                  string
	DetectedTypes           []string
	DetectedCount           int
	RedactedPrompt          string
	RedactedPromptPreview   string
	SecurityPolicyVersionID string
}

type CacheContext struct {
	Status       string
	Type         string
	KeyHash      string
	HitRequestID string
	Payload      []byte
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
