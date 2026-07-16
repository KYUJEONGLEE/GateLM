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

func TestDispatchTrackerAndNotStartedError(t *testing.T) {
	tracker := &DispatchTracker{}
	if tracker.Observed() || tracker.Started() {
		t.Fatal("new dispatch tracker must be empty")
	}
	tracker.Observe()
	if !tracker.Observed() || tracker.Started() {
		t.Fatal("observe must not mark provider dispatch as started")
	}
	tracker.MarkStarted()
	if !tracker.Started() {
		t.Fatal("expected provider dispatch to be marked started")
	}

	err := NewNotStartedError(errors.New("pre-call failed"))
	if !IsDispatchNotStarted(err) {
		t.Fatal("expected bounded not-started evidence")
	}
	if SafeErrorCode(err) != ErrorCodeProviderError {
		t.Fatalf("unexpected safe error code: %s", SafeErrorCode(err))
	}
}
