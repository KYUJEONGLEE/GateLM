package provider

import (
	"context"
	"errors"
	"testing"
)

func TestAllowsFallbackExcludesContextCanceled(t *testing.T) {
	cancelledErr := NewError(ErrorKindError, ErrorCodeProviderError, context.Canceled)
	if AllowsFallback(cancelledErr) {
		t.Fatal("context cancellation must not allow fallback")
	}
	if AllowsFallback(context.Canceled) {
		t.Fatal("direct context cancellation must not allow fallback")
	}
}

func TestAllowsFallbackOnlyForProviderTimeoutOrError(t *testing.T) {
	if !AllowsFallback(NewError(ErrorKindTimeout, ErrorCodeProviderTimeout, errors.New("timeout"))) {
		t.Fatal("provider timeout should allow fallback")
	}
	if !AllowsFallback(NewError(ErrorKindError, ErrorCodeProviderError, errors.New("provider error"))) {
		t.Fatal("provider error should allow fallback")
	}
	if AllowsFallback(NewError(ErrorKindUnauthorized, ErrorCodeProviderUnauthorized, errors.New("unauthorized"))) {
		t.Fatal("provider unauthorized must not allow fallback")
	}
	if AllowsFallback(NewError(ErrorKindCredential, ErrorCodeProviderCredentialUnavailable, errors.New("credential unavailable"))) {
		t.Fatal("credential resolution failure must not allow fallback")
	}
}
