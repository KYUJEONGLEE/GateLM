package gatewayerrors

type GatewayError struct {
	HTTPStatus int
	Code       string
	Message    string
	Stage      string
}

func (e GatewayError) Error() string {
	return e.Code
}

func New(httpStatus int, code string, message string, stage string) GatewayError {
	return GatewayError{
		HTTPStatus: httpStatus,
		Code:       code,
		Message:    message,
		Stage:      stage,
	}
}

func InvalidAPIKey(stage string) GatewayError {
	return New(401, "invalid_api_key", "Invalid Gateway API key.", stage)
}

func InvalidAppToken(stage string) GatewayError {
	return New(403, "invalid_app_token", "Invalid GateLM App Token.", stage)
}

func ScopeMismatch(stage string) GatewayError {
	return New(403, "scope_mismatch", "Tenant, project, or application scope mismatch.", stage)
}
