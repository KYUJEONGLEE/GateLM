package tenantchat

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"gatelm/apps/gateway-core/internal/adapters/tenantchat/workloadauth"
	domain "gatelm/apps/gateway-core/internal/domain/tenantchat"
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

type Handler struct {
	auth         authenticator
	admissions   admissionService
	maxBodyBytes int64
}

func NewRouter(auth authenticator, admissions admissionService, maxBodyBytes int64) http.Handler {
	handler := &Handler{auth: auth, admissions: admissions, maxBodyBytes: maxBodyBytes}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /internal/v1/tenant-chat/admissions", handler.admit)
	mux.HandleFunc("POST /internal/v1/tenant-chat/admissions/{admissionId}/cancel", handler.cancel)
	return mux
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
	case errors.Is(err, domain.ErrTenantDisabled):
		writeError(w, http.StatusForbidden, "CHAT_TENANT_DISABLED", "Tenant is disabled.", 0)
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
	default:
		writeError(w, http.StatusServiceUnavailable, "CHAT_USAGE_GUARD_UNAVAILABLE", "Tenant chat usage guard is unavailable.", 1)
	}
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
