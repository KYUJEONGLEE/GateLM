package tenantchat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/adapters/tenantchat/workloadauth"
	"gatelm/apps/gateway-core/internal/domain/provider"
	domain "gatelm/apps/gateway-core/internal/domain/tenantchat"
	completionservice "gatelm/apps/gateway-core/internal/services/tenantchat/completion"
	"gatelm/apps/gateway-core/internal/services/tenantchat/requestauth"
)

type fakeAuthenticator struct {
	verified workloadauth.VerifiedToken
	err      error
	calls    int
	phase    domain.Phase
	payload  any
}

func (a *fakeAuthenticator) Authenticate(
	_ context.Context,
	_ string,
	phase domain.Phase,
	_ domain.RequestContext,
	payload any,
) (workloadauth.VerifiedToken, error) {
	a.calls++
	a.phase = phase
	a.payload = payload
	return a.verified, a.err
}

type fakeAdmissionService struct {
	admission domain.Admission
	cancel    domain.AdmissionCancellation
	err       error
	context   domain.RequestContext
}

type fakeCompletionService struct {
	execution completionservice.Execution
	err       error
	request   domain.CompletionRequest
}

type fakeReceiptAuth struct{ allowed bool }

func (a *fakeReceiptAuth) Authenticate(string) bool { return a.allowed }

type fakeReceiptService struct {
	result  domain.UsageReceiptResult
	err     error
	receipt domain.UsageReceipt
}

func (s *fakeReceiptService) RecordUsageReceipt(_ context.Context, receipt domain.UsageReceipt) (domain.UsageReceiptResult, error) {
	s.receipt = receipt
	return s.result, s.err
}

func (s *fakeCompletionService) Prepare(
	_ context.Context,
	request domain.CompletionRequest,
) (completionservice.Execution, error) {
	s.request = request
	return s.execution, s.err
}

type fakeCompletionExecution struct {
	events []domain.CompletionEvent
	err    error
	closed bool
}

func (e *fakeCompletionExecution) Relay(_ context.Context, emit completionservice.EventEmitter) error {
	for _, event := range e.events {
		if err := emit(event); err != nil {
			return err
		}
	}
	return e.err
}

func (e *fakeCompletionExecution) Close() { e.closed = true }

func (e *fakeCompletionExecution) IsReplay() bool { return false }

func TestCompletionReportsRelayFailureWithoutRawProviderDetail(t *testing.T) {
	previousWriter := log.Writer()
	previousFlags := log.Flags()
	var logs bytes.Buffer
	log.SetOutput(&logs)
	log.SetFlags(0)
	defer func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
	}()

	execution := &fakeCompletionExecution{err: provider.NewError(
		provider.ErrorKindError,
		provider.ErrorCodeProviderError,
		errors.New("raw provider detail must not be logged"),
	)}
	request := domain.CompletionRequest{
		Context: domain.RequestContext{Phase: domain.PhaseCompletion, RequestID: "request_relay_failure"},
		Input: domain.CompletionInput{
			Messages: []domain.EphemeralMessage{{Role: "user", Content: "안녕하세요"}}, Stream: true,
		},
	}
	recorder := performJSONRequest(
		t,
		NewRouter(
			&fakeAuthenticator{},
			&fakeAdmissionService{},
			64*1024,
			WithCompletionService(&fakeCompletionService{execution: execution}),
		),
		"/internal/v1/tenant-chat/completions",
		request,
	)

	if recorder.Code != http.StatusOK {
		t.Fatalf("want started SSE response, got %d", recorder.Code)
	}
	if !strings.Contains(logs.String(), "request_id=request_relay_failure") ||
		!strings.Contains(logs.String(), "error_code=CHAT_PROVIDER_FAILED") ||
		strings.Contains(logs.String(), "raw provider detail") {
		t.Fatalf("unexpected safe relay log: %s", logs.String())
	}
}

func TestCompletionDoesNotReportClientCancellation(t *testing.T) {
	previousWriter := log.Writer()
	previousFlags := log.Flags()
	var logs bytes.Buffer
	log.SetOutput(&logs)
	log.SetFlags(0)
	defer func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
	}()

	request := domain.CompletionRequest{
		Context: domain.RequestContext{Phase: domain.PhaseCompletion, RequestID: "request_client_cancel"},
		Input: domain.CompletionInput{
			Messages: []domain.EphemeralMessage{{Role: "user", Content: "안녕하세요"}}, Stream: true,
		},
	}
	performJSONRequest(
		t,
		NewRouter(
			&fakeAuthenticator{},
			&fakeAdmissionService{},
			64*1024,
			WithCompletionService(&fakeCompletionService{
				execution: &fakeCompletionExecution{err: context.Canceled},
			}),
		),
		"/internal/v1/tenant-chat/completions",
		request,
	)

	if logs.Len() != 0 {
		t.Fatalf("client cancellation must not be reported as a relay failure: %s", logs.String())
	}
}

func TestCompletionAuthenticatesBoundPayloadAndStreamsContractEvents(t *testing.T) {
	auth := &fakeAuthenticator{}
	replayed := false
	modelKey := "model-standard"
	execution := &fakeCompletionExecution{events: []domain.CompletionEvent{
		{
			Type: domain.CompletionEventDelta, SchemaVersion: 1,
			RequestID: "request_completion_001", TurnID: "turn_completion_001",
			Sequence: 1, Delta: "안녕하세요",
		},
		{
			Type: domain.CompletionEventFinal, SchemaVersion: 1,
			RequestID: "request_completion_001", TurnID: "turn_completion_001",
			Sequence: 2, TerminalOutcome: "succeeded", EffectiveModelKey: &modelKey,
			Usage: &domain.CompletionUsage{
				InputTokens: 4, OutputTokens: 2, TotalTokens: 6, UsageQuality: "confirmed",
			},
			QuotaState: "normal", BudgetState: "normal", CacheOutcome: "off", Replayed: &replayed,
		},
	}}
	completions := &fakeCompletionService{execution: execution}
	request := domain.CompletionRequest{
		Context: domain.RequestContext{
			Phase: domain.PhaseCompletion, RequestID: "request_completion_001", TurnID: "turn_completion_001",
		},
		Input: domain.CompletionInput{
			Messages: []domain.EphemeralMessage{{Role: "user", Content: "안녕하세요"}}, Stream: true,
		},
	}
	recorder := performJSONRequest(
		t,
		NewRouter(auth, &fakeAdmissionService{}, 64*1024, WithCompletionService(completions)),
		"/internal/v1/tenant-chat/completions",
		request,
	)

	if recorder.Code != http.StatusOK {
		t.Fatalf("want completion success, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if auth.phase != domain.PhaseCompletion || !reflect.DeepEqual(auth.payload, completions.request.Input) {
		t.Fatalf("completion auth did not receive exact phase/payload: phase=%s payload=%#v", auth.phase, auth.payload)
	}
	if contentType := recorder.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/event-stream") {
		t.Fatalf("unexpected completion content type: %q", contentType)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, "event: tenant_chat.delta") ||
		!strings.Contains(body, "event: tenant_chat.final") ||
		!strings.Contains(body, `"replayed":false`) {
		t.Fatalf("completion stream does not satisfy SSE contract: %s", body)
	}
	if !execution.closed {
		t.Fatal("completion execution was not closed")
	}
}

func (s *fakeAdmissionService) Admit(
	_ context.Context,
	requestContext domain.RequestContext,
) (domain.Admission, error) {
	s.context = requestContext
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

func TestUsageReceiptUsesDedicatedBearerAndReturnsReplayState(t *testing.T) {
	service := &fakeReceiptService{result: domain.UsageReceiptResult{
		RequestID: "request_receipt_001", AttemptNo: 1, State: "settled", Replayed: true,
	}}
	router := NewRouter(
		&fakeAuthenticator{}, &fakeAdmissionService{}, 64*1024,
		WithUsageReceipts(&fakeReceiptAuth{allowed: true}, service),
	)
	receipt := domain.UsageReceipt{
		RequestID: "request_receipt_001", AttemptNo: 1, ProviderID: "provider_001",
		InputTokens: 10, OutputTokens: 4, CacheReadInputTokens: 2,
	}
	recorder := performJSONRequest(t, router, "/internal/v1/tenant-chat/usage-receipts", receipt)
	if recorder.Code != http.StatusOK || service.receipt != receipt {
		t.Fatalf("unexpected usage receipt result: status=%d receipt=%+v body=%s", recorder.Code, service.receipt, recorder.Body.String())
	}

	unauthorized := NewRouter(
		&fakeAuthenticator{}, &fakeAdmissionService{}, 64*1024,
		WithUsageReceipts(&fakeReceiptAuth{}, service),
	)
	if got := performJSONRequest(t, unauthorized, "/internal/v1/tenant-chat/usage-receipts", receipt); got.Code != http.StatusUnauthorized {
		t.Fatalf("dedicated receipt bearer was not enforced: %d", got.Code)
	}
}

func TestAdmissionUsesWorkloadBoundActorWithoutReevaluation(t *testing.T) {
	auth := &fakeAuthenticator{verified: workloadauth.VerifiedToken{Claims: workloadauth.Claims{
		UserID: "different-user-that-must-not-be-reinterpreted",
	}}}
	service := &fakeAdmissionService{admission: domain.Admission{
		AdmissionID: "00000000-0000-4000-8000-000000000001",
		RequestID:   "request_fixture_001",
		State:       "active",
		ExpiresAt:   time.Date(2026, 7, 13, 0, 0, 30, 0, time.UTC),
	}}
	requestContext := domain.RequestContext{ExecutionScope: domain.ExecutionScope{
		TenantID: "00000000-0000-4000-8000-000000000100",
		Actor: domain.Actor{
			UserID:     "00000000-0000-4000-8000-000000000200",
			ActorKind:  "employee",
			EmployeeID: "00000000-0000-4000-8000-000000000300",
		},
	}}
	recorder := performJSONRequest(t, NewRouter(auth, service, 64*1024),
		"/internal/v1/tenant-chat/admissions", domain.AdmissionRequest{Context: requestContext})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("want admission success, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if service.context.ExecutionScope.Actor != requestContext.ExecutionScope.Actor {
		t.Fatalf("Gateway reinterpreted the workload-bound actor: got %+v want %+v",
			service.context.ExecutionScope.Actor, requestContext.ExecutionScope.Actor)
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

func TestPrivateHandlerMapsInvalidPersistenceIdentityToTokenInvalid(t *testing.T) {
	auth := &fakeAuthenticator{err: requestauth.ErrTokenInvalid}
	router := NewRouter(auth, &fakeAdmissionService{}, 64*1024)
	recorder := performJSONRequest(t, router, "/internal/v1/tenant-chat/admissions", domain.AdmissionRequest{})
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", recorder.Code)
	}
	var response domain.ErrorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode token error response: %v", err)
	}
	if response.Code != "CHAT_TOKEN_INVALID" {
		t.Fatalf("unexpected token error response: %+v", response)
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
		{err: domain.ErrTenantDisabled, code: "CHAT_TENANT_DISABLED"},
		{err: domain.ErrSafetyBlocked, code: "CHAT_SAFETY_BLOCKED"},
		{err: domain.ErrRuntimeUnavailable, code: "CHAT_RUNTIME_UNAVAILABLE"},
		{err: context.DeadlineExceeded, code: "CHAT_RUNTIME_UNAVAILABLE"},
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

func TestServiceCancellationDoesNotWriteResponse(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeServiceError(recorder, context.Canceled)
	if recorder.Body.Len() != 0 || recorder.Header().Get("Content-Type") != "" {
		t.Fatalf("canceled request wrote a response: headers=%v body=%q", recorder.Header(), recorder.Body.String())
	}
}

func TestWriteJSONMarshalsBeforeSendingSuccessStatus(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeJSON(recorder, http.StatusOK, struct {
		Unsupported chan int `json:"unsupported"`
	}{Unsupported: make(chan int)})

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("want safe 503 when response marshal fails, got %d", recorder.Code)
	}
	var response domain.ErrorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode safe fallback response: %v", err)
	}
	if response.Code != "CHAT_USAGE_GUARD_UNAVAILABLE" {
		t.Fatalf("unexpected safe fallback response: %+v", response)
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
