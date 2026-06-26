package gatewayerrors

import "fmt"

const StatusClientClosedRequest = 499

type GatewayError struct {
	HTTPStatus int
	Code       string
	Message    string
	Stage      string
	Cause      error
}

func (e GatewayError) Error() string {
	return fmt.Sprintf("%s: %s (stage=%s)", e.Code, e.Message, e.Stage)
}

func (e GatewayError) Unwrap() error {
	return e.Cause
}

func New(httpStatus int, code string, message string, stage string) GatewayError {
	return NewWithCause(httpStatus, code, message, stage, nil)
}

func NewWithCause(httpStatus int, code string, message string, stage string, cause error) GatewayError {
	return GatewayError{
		HTTPStatus: httpStatus,
		Code:       code,
		Message:    message,
		Stage:      stage,
		Cause:      cause,
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

func RequestCancelled(stage string, cause error) GatewayError {
	return NewWithCause(StatusClientClosedRequest, "internal_error", "Request was cancelled.", stage, cause)
}

func InternalError(stage string, message string, cause error) GatewayError {
	return NewWithCause(500, "internal_error", message, stage, cause)
}
