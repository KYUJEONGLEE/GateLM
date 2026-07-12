package tenantchat

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/adapters/tenantchat/workloadauth"
	domain "gatelm/apps/gateway-core/internal/domain/tenantchat"
	"gatelm/apps/gateway-core/internal/services/tenantchat/requestauth"
)

type fakeAuthenticator struct {
	verified workloadauth.VerifiedToken
	err      error
	calls    int
}

func (a *fakeAuthenticator) Authenticate(
	_ context.Context,
	_ string,
	_ domain.Phase,
	_ domain.RequestContext,
	_ any,
) (workloadauth.VerifiedToken, error) {
	a.calls++
	return a.verified, a.err
}

type fakeAdmissionService struct {
	admission domain.Admission
	cancel    domain.AdmissionCancellation
	err       error
}

func (s *fakeAdmissionService) Admit(
	_ context.Context,
	_ domain.RequestContext,
	_ workloadauth.Claims,
) (domain.Admission, error) {
	return s.admission, s.err
}

func (s *fakeAdmissionService) Cancel(
	_ context.Context,
	_ domain.RequestContext,
) (domain.AdmissionCancellation, error) {
	return s.cancel, s.err
}

func TestAdmissionHTTPStatusDistinguishesCreateAndReplay(t *testing.T) {
	for _, test := range []struct {
		name     string
		replayed bool
		status   int
	}{
		{name: "created", status: http.StatusCreated},
		{name: "replayed", replayed: true, status: http.StatusOK},
	} {
		t.Run(test.name, func(t *testing.T) {
			auth := &fakeAuthenticator{}
			service := &fakeAdmissionService{admission: domain.Admission{
				AdmissionID: "00000000-0000-4000-8000-000000000001",
				RequestID:   "request_fixture_001",
				State:       "active",
				ExpiresAt:   time.Date(2026, 7, 13, 0, 0, 30, 0, time.UTC),
				Replayed:    test.replayed,
			}}
			router := NewRouter(auth, service, 64*1024)
			recorder := performJSONRequest(t, router, "/internal/v1/tenant-chat/admissions", domain.AdmissionRequest{})
			if recorder.Code != test.status {
				t.Fatalf("want status %d, got %d: %s", test.status, recorder.Code, recorder.Body.String())
			}
			var response domain.AdmissionResponse
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode admission response: %v", err)
			}
			if response.Replayed != test.replayed || response.AdmissionID != service.admission.AdmissionID {
				t.Fatalf("unexpected admission response: %+v", response)
			}
		})
	}
}

func TestPrivateHandlerRejectsUnknownFieldsBeforeAuthentication(t *testing.T) {
	auth := &fakeAuthenticator{}
	router := NewRouter(auth, &fakeAdmissionService{}, 64*1024)
	request := httptest.NewRequest(
		http.MethodPost,
		"/internal/v1/tenant-chat/admissions",
		strings.NewReader(`{"context":{},"unexpected":true}`),
	)
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest || auth.calls != 0 {
		t.Fatalf("unknown field was not rejected before auth: status=%d calls=%d", recorder.Code, auth.calls)
	}
}

func TestPrivateHandlerReturnsSafeContractErrors(t *testing.T) {
	auth := &fakeAuthenticator{err: requestauth.ErrGuardUnavailable}
	router := NewRouter(auth, &fakeAdmissionService{}, 64*1024)
	recorder := performJSONRequest(t, router, "/internal/v1/tenant-chat/admissions", domain.AdmissionRequest{})
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503, got %d", recorder.Code)
	}
	if strings.Contains(recorder.Body.String(), "redis") || strings.Contains(recorder.Body.String(), "JWT") {
		t.Fatalf("unsafe internal detail leaked: %s", recorder.Body.String())
	}
	var response domain.ErrorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if response.Code != "CHAT_USAGE_GUARD_UNAVAILABLE" {
		t.Fatalf("unexpected safe error response: %+v", response)
	}
}

func TestCancelRequiresPathAndBoundAdmissionToMatch(t *testing.T) {
	auth := &fakeAuthenticator{}
	router := NewRouter(auth, &fakeAdmissionService{}, 64*1024)
	recorder := performJSONRequest(t, router,
		"/internal/v1/tenant-chat/admissions/admission_path/cancel",
		domain.CancelRequest{Context: domain.RequestContext{AdmissionID: "admission_body"}},
	)
	if recorder.Code != http.StatusBadRequest || auth.calls != 0 {
		t.Fatalf("path mismatch was not rejected: status=%d calls=%d", recorder.Code, auth.calls)
	}
}

func TestServiceErrorMapping(t *testing.T) {
	tests := []struct {
		err  error
		code string
	}{
		{err: domain.ErrIdempotencyConflict, code: "CHAT_IDEMPOTENCY_CONFLICT"},
		{err: domain.ErrRateLimited, code: "CHAT_RATE_LIMITED"},
		{err: domain.ErrConcurrencyLimited, code: "CHAT_CONCURRENCY_LIMITED"},
		{err: errors.New("database detail"), code: "CHAT_USAGE_GUARD_UNAVAILABLE"},
	}
	for _, test := range tests {
		t.Run(test.code, func(t *testing.T) {
			router := NewRouter(&fakeAuthenticator{}, &fakeAdmissionService{err: test.err}, 64*1024)
			recorder := performJSONRequest(t, router, "/internal/v1/tenant-chat/admissions", domain.AdmissionRequest{})
			var response domain.ErrorResponse
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode error response: %v", err)
			}
			if response.Code != test.code || strings.Contains(recorder.Body.String(), "database detail") {
				t.Fatalf("unexpected safe error mapping: %+v", response)
			}
		})
	}
}

func performJSONRequest(t *testing.T, router http.Handler, path string, payload any) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("encode request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(string(body)))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer signed-token")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}
