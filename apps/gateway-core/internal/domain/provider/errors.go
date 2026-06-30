package provider

import (
	"context"
	"errors"
	"fmt"
)

const (
	ErrorCodeProviderTimeout               = "provider_timeout"
	ErrorCodeProviderError                 = "provider_error"
	ErrorCodeProviderUnauthorized          = "provider_unauthorized"
	ErrorCodeProviderCredentialUnavailable = "provider_credential_unavailable"
)

type ErrorKind string

const (
	ErrorKindTimeout      ErrorKind = "timeout"
	ErrorKindError        ErrorKind = "error"
	ErrorKindUnauthorized ErrorKind = "unauthorized"
	ErrorKindCredential   ErrorKind = "credential"
)

type Error struct {
	Kind ErrorKind
	Code string
	Err  error
}

func NewError(kind ErrorKind, code string, err error) *Error {
	if code == "" {
		code = safeCodeForKind(kind)
	}
	return &Error{Kind: kind, Code: code, Err: err}
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	if e.Err == nil {
		return e.Code
	}
	return fmt.Sprintf("%s: %v", e.Code, e.Err)
}

func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func SafeErrorCode(err error) string {
	var providerErr *Error
	if errors.As(err, &providerErr) && providerErr.Code != "" {
		return providerErr.Code
	}
	return ErrorCodeProviderError
}

func ErrorKindOf(err error) ErrorKind {
	var providerErr *Error
	if errors.As(err, &providerErr) {
		return providerErr.Kind
	}
	return ErrorKindError
}

func AllowsFallback(err error) bool {
	if errors.Is(err, context.Canceled) {
		return false
	}
	switch ErrorKindOf(err) {
	case ErrorKindTimeout, ErrorKindError:
		return true
	default:
		return false
	}
}

func safeCodeForKind(kind ErrorKind) string {
	switch kind {
	case ErrorKindTimeout:
		return ErrorCodeProviderTimeout
	case ErrorKindUnauthorized:
		return ErrorCodeProviderUnauthorized
	case ErrorKindCredential:
		return ErrorCodeProviderCredentialUnavailable
	default:
		return ErrorCodeProviderError
	}
}
