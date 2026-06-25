package request

type GatewayContext struct {
	Request  RequestContext
	Identity IdentityContext
	Routing  RoutingContext
	Status   StatusContext
}

type RequestContext struct {
	RequestID      string
	TraceID        string
	Endpoint       string
	Method         string
	Stream         bool
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
