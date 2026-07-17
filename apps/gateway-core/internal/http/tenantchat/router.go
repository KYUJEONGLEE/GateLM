package tenantchat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"gatelm/apps/gateway-core/internal/adapters/tenantchat/workloadauth"
	"gatelm/apps/gateway-core/internal/domain/provider"
	domain "gatelm/apps/gateway-core/internal/domain/tenantchat"
	completionservice "gatelm/apps/gateway-core/internal/services/tenantchat/completion"
	"gatelm/apps/gateway-core/internal/services/tenantchat/requestauth"
)

type authenticator interface {
	Authenticate(
		ctx context.Context,
		authorization string,
		expectedPhase domain.Phase,
		requestContext domain.RequestContext,
		payload any,
	) (workloadauth.VerifiedToken, error)
}

type admissionService interface {
	Admit(ctx context.Context, requestContext domain.RequestContext) (domain.Admission, error)
	Cancel(ctx context.Context, requestContext domain.RequestContext) (domain.AdmissionCancellation, error)
}

type completionService interface {
	Prepare(ctx context.Context, request domain.CompletionRequest) (completionservice.Execution, error)
}

type sanitizationService interface {
	Sanitize(ctx context.Context, request domain.SanitizationRequest) (domain.SanitizationResponse, error)
}

type usageReceiptAuthenticator interface {
	Authenticate(authorization string) bool
}

type usageReceiptService interface {
	RecordUsageReceipt(ctx context.Context, receipt domain.UsageReceipt) (domain.UsageReceiptResult, error)
}

type Handler struct {
	auth          authenticator
	admissions    admissionService
	completions   completionService
	sanitizations sanitizationService
	receiptAuth   usageReceiptAuthenticator
	receipts      usageReceiptService
	maxBodyBytes  int64
}

type Option func(*Handler)

func WithCompletionService(completions completionService) Option {
	return func(handler *Handler) {
		handler.completions = completions
	}
}

func WithSanitizationService(sanitizations sanitizationService) Option {
	return func(handler *Handler) {
		handler.sanitizations = sanitizations
	}
}

func WithUsageReceipts(auth usageReceiptAuthenticator, receipts usageReceiptService) Option {
	return func(handler *Handler) {
		handler.receiptAuth = auth
		handler.receipts = receipts
	}
}

func NewRouter(auth authenticator, admissions admissionService, maxBodyBytes int64, options ...Option) http.Handler {
	handler := &Handler{auth: auth, admissions: admissions, maxBodyBytes: maxBodyBytes}
	for _, option := range options {
		if option != nil {
			option(handler)
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /internal/v1/tenant-chat/admissions", handler.admit)
	mux.HandleFunc("POST /internal/v1/tenant-chat/admissions/{admissionId}/cancel", handler.cancel)
	mux.HandleFunc("POST /internal/v1/tenant-chat/admissions/{admissionId}/sanitizations", handler.sanitize)
	mux.HandleFunc("POST /internal/v1/tenant-chat/completions", handler.complete)
	if handler.receiptAuth != nil && handler.receipts != nil {
		mux.HandleFunc("POST /internal/v1/tenant-chat/usage-receipts", handler.recordUsageReceipt)
	}
	return mux
}

func (h *Handler) sanitize(w http.ResponseWriter, r *http.Request) {
	request := domain.SanitizationRequest{}
	if err := h.decodeJSON(w, r, &request); err != nil ||
		request.Context.AdmissionID != r.PathValue("admissionId") ||
		domain.ValidateSanitizationInput(request.Input) != nil {
		writeError(w, http.StatusBadRequest, "CHAT_INVALID_REQUEST", "Invalid tenant chat request.", 0)
		return
	}
	if _, err := h.auth.Authenticate(
		r.Context(),
		r.Header.Get("Authorization"),
		domain.PhaseSanitization,
		request.Context,
		request.Input,
	); err != nil {
		writeAuthenticationError(w, err)
		return
	}
	if h.sanitizations == nil {
		writeError(w, http.StatusServiceUnavailable, "CHAT_RUNTIME_UNAVAILABLE", "Tenant chat runtime is unavailable.", 1)
		return
	}
	response, err := h.sanitizations.Sanitize(r.Context(), request)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) recordUsageReceipt(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.receiptAuth == nil || !h.receiptAuth.Authenticate(r.Header.Get("Authorization")) {
		writeError(w, http.StatusUnauthorized, "CHAT_TOKEN_INVALID", "Tenant chat service authorization failed.", 0)
		return
	}
	receipt := domain.UsageReceipt{}
	if err := h.decodeJSON(w, r, &receipt); err != nil || domain.ValidateUsageReceipt(receipt) != nil {
		writeError(w, http.StatusBadRequest, "CHAT_INVALID_REQUEST", "Invalid tenant chat request.", 0)
		return
	}
	result, err := h.receipts.RecordUsageReceipt(r.Context(), receipt)
	if errors.Is(err, domain.ErrIdempotencyConflict) {
		writeError(w, http.StatusConflict, "CHAT_IDEMPOTENCY_CONFLICT", "Usage receipt conflicts with an existing attempt.", 0)
		return
	}
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "CHAT_USAGE_GUARD_UNAVAILABLE", "Tenant chat usage guard is unavailable.", 1)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) admit(w http.ResponseWriter, r *http.Request) {
	request := domain.AdmissionRequest{}
	if err := h.decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "CHAT_INVALID_REQUEST", "Invalid tenant chat request.", 0)
		return
	}
	_, err := h.auth.Authenticate(
		r.Context(),
		r.Header.Get("Authorization"),
		domain.PhaseAdmission,
		request.Context,
		nil,
	)
	if err != nil {
		writeAuthenticationError(w, err)
		return
	}
	result, err := h.admissions.Admit(r.Context(), request.Context)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	status := http.StatusCreated
	if result.Replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, domain.AdmissionResponse{
		AdmissionID: result.AdmissionID,
		RequestID:   result.RequestID,
		State:       result.State,
		ExpiresAt:   result.ExpiresAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		Replayed:    result.Replayed,
	})
}

func (h *Handler) cancel(w http.ResponseWriter, r *http.Request) {
	request := domain.CancelRequest{}
	if err := h.decodeJSON(w, r, &request); err != nil ||
		request.Context.AdmissionID != r.PathValue("admissionId") {
		writeError(w, http.StatusBadRequest, "CHAT_INVALID_REQUEST", "Invalid tenant chat request.", 0)
		return
	}
	if _, err := h.auth.Authenticate(
		r.Context(),
		r.Header.Get("Authorization"),
		domain.PhaseCancel,
		request.Context,
		nil,
	); err != nil {
		writeAuthenticationError(w, err)
		return
	}
	result, err := h.admissions.Cancel(r.Context(), request.Context)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.CancelResponse{
		AdmissionID:  result.AdmissionID,
		RequestID:    result.RequestID,
		State:        result.State,
		SlotReleased: result.SlotReleased,
		Replayed:     result.Replayed,
	})
}

func (h *Handler) complete(w http.ResponseWriter, r *http.Request) {
	if _, ok := w.(http.Flusher); !ok {
		writeError(w, http.StatusServiceUnavailable, "CHAT_USAGE_GUARD_UNAVAILABLE", "Tenant chat streaming is unavailable.", 1)
		return
	}
	request := domain.CompletionRequest{}
	if err := h.decodeJSON(w, r, &request); err != nil || domain.ValidateCompletionInput(request.Input) != nil {
		writeError(w, http.StatusBadRequest, "CHAT_INVALID_REQUEST", "Invalid tenant chat request.", 0)
		return
	}
	if _, err := h.auth.Authenticate(
		r.Context(),
		r.Header.Get("Authorization"),
		domain.PhaseCompletion,
		request.Context,
		request.Input,
	); err != nil {
		writeAuthenticationError(w, err)
		return
	}
	if h.completions == nil {
		writeError(w, http.StatusServiceUnavailable, "CHAT_USAGE_GUARD_UNAVAILABLE", "Tenant chat completion is unavailable.", 1)
		return
	}
	execution, err := h.completions.Prepare(r.Context(), request)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	defer execution.Close()

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Content-Encoding", "identity")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Idempotency-Replayed", fmt.Sprintf("%t", execution.IsReplay()))
	w.WriteHeader(http.StatusOK)
	w.(http.Flusher).Flush()
	err = execution.Relay(r.Context(), func(event domain.CompletionEvent) error {
		if err := writeSSEEvent(w, event); err != nil {
			return err
		}
		w.(http.Flusher).Flush()
		return nil
	})
	if err != nil && !errors.Is(err, context.Canceled) {
		log.Printf(
			"tenant chat completion relay failed request_id=%s error_code=%s",
			request.Context.RequestID,
			safeRelayErrorCode(err),
		)
	}
}

func safeRelayErrorCode(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded), isProviderErrorKind(err, provider.ErrorKindTimeout):
		return "CHAT_PROVIDER_TIMEOUT"
	case isProviderError(err):
		return "CHAT_PROVIDER_FAILED"
	default:
		return "CHAT_USAGE_GUARD_UNAVAILABLE"
	}
}

func (h *Handler) decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	if h == nil || h.auth == nil || h.admissions == nil || h.maxBodyBytes <= 0 ||
		!strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		return errors.New("invalid private handler request")
	}
	r.Body = http.MaxBytesReader(w, r.Body, h.maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body contains more than one JSON value")
		}
		return err
	}
	return nil
}

func writeAuthenticationError(w http.ResponseWriter, err error) {
	if errors.Is(err, requestauth.ErrInvalidRequest) {
		writeError(w, http.StatusBadRequest, "CHAT_INVALID_REQUEST", "Invalid tenant chat request.", 0)
		return
	}
	if errors.Is(err, requestauth.ErrGuardUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "CHAT_USAGE_GUARD_UNAVAILABLE", "Tenant chat usage guard is unavailable.", 1)
		return
	}
	writeError(w, http.StatusUnauthorized, "CHAT_TOKEN_INVALID", "Tenant chat service authorization failed.", 0)
}

func writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, context.Canceled):
		return
	case errors.Is(err, context.DeadlineExceeded):
		writeError(w, http.StatusServiceUnavailable, "CHAT_RUNTIME_UNAVAILABLE", "Tenant chat runtime is unavailable.", 1)
	case errors.Is(err, domain.ErrTenantDisabled):
		writeError(w, http.StatusForbidden, "CHAT_TENANT_DISABLED", "Tenant is disabled.", 0)
	case errors.Is(err, domain.ErrSafetyBlocked):
		writeError(w, http.StatusForbidden, "CHAT_SAFETY_BLOCKED", "Tenant chat safety policy blocked the request.", 0)
	case errors.Is(err, domain.ErrRuntimeUnavailable):
		writeError(w, http.StatusServiceUnavailable, "CHAT_RUNTIME_UNAVAILABLE", "Tenant chat runtime is unavailable.", 1)
	case errors.Is(err, domain.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "CHAT_IDEMPOTENCY_CONFLICT", "Idempotency key conflicts with an existing request.", 0)
	case errors.Is(err, domain.ErrAdmissionExpired):
		writeError(w, http.StatusConflict, "CHAT_ADMISSION_EXPIRED", "Tenant chat admission expired or was consumed.", 0)
	case errors.Is(err, domain.ErrRateLimited):
		writeError(w, http.StatusTooManyRequests, "CHAT_RATE_LIMITED", "Tenant chat request rate is limited.", 1)
	case errors.Is(err, domain.ErrConcurrencyLimited):
		writeError(w, http.StatusTooManyRequests, "CHAT_CONCURRENCY_LIMITED", "Tenant chat active request limit was reached.", 1)
	case errors.Is(err, domain.ErrQuotaHardLimit):
		writeError(w, http.StatusForbidden, "CHAT_QUOTA_HARD_LIMIT", "Tenant chat user quota was reached.", 0)
	case errors.Is(err, domain.ErrEmployeeWeeklyTokenQuotaHardLimit):
		writeError(w, http.StatusForbidden, "CHAT_EMPLOYEE_WEEKLY_TOKEN_QUOTA_HARD_LIMIT", "이번 주 사용 한도에 도달했습니다. 조직 관리자에게 문의해 주세요.", 0)
	case errors.Is(err, domain.ErrBudgetHardLimit):
		writeError(w, http.StatusForbidden, "CHAT_BUDGET_HARD_LIMIT", "Tenant chat tenant budget was reached.", 0)
	case errors.Is(err, domain.ErrNoEligibleRoute):
		writeError(w, http.StatusServiceUnavailable, "CHAT_NO_ELIGIBLE_ROUTE", "Tenant chat has no eligible route.", 1)
	case isProviderErrorKind(err, provider.ErrorKindTimeout):
		writeError(w, http.StatusGatewayTimeout, "CHAT_PROVIDER_TIMEOUT", "Tenant chat provider timed out.", 0)
	case isProviderError(err):
		writeError(w, http.StatusBadGateway, "CHAT_PROVIDER_FAILED", "Tenant chat provider failed.", 0)
	default:
		writeError(w, http.StatusServiceUnavailable, "CHAT_USAGE_GUARD_UNAVAILABLE", "Tenant chat usage guard is unavailable.", 1)
	}
}

func isProviderError(err error) bool {
	var providerErr *provider.Error
	return errors.As(err, &providerErr)
}

func isProviderErrorKind(err error, kind provider.ErrorKind) bool {
	var providerErr *provider.Error
	return errors.As(err, &providerErr) && providerErr.Kind == kind
}

func writeSSEEvent(w io.Writer, event domain.CompletionEvent) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(
		w,
		"id: %s:%d\nevent: %s\ndata: %s\n\n",
		event.RequestID,
		event.Sequence,
		event.Type,
		payload,
	)
	return err
}

func writeError(w http.ResponseWriter, status int, code, message string, retryAfterSeconds int) {
	writeJSON(w, status, domain.ErrorResponse{
		Code:              code,
		Message:           message,
		RetryAfterSeconds: retryAfterSeconds,
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	response, err := json.Marshal(payload)
	if err != nil {
		status = http.StatusServiceUnavailable
		response = []byte(`{"code":"CHAT_USAGE_GUARD_UNAVAILABLE","message":"Tenant chat response is unavailable."}`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(response)
}
