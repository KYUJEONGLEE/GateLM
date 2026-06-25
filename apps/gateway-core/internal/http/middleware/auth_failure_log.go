package middleware

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func AuthFailureLogMiddleware(writer invocationlog.AuthFailureLogWriter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if writer == nil {
				next.ServeHTTP(w, r)
				return
			}

			startedAt := time.Now().UTC()
			capture := &authFailureCaptureWriter{ResponseWriter: w}
			next.ServeHTTP(capture, r)
			completedAt := time.Now().UTC()

			status := capture.status
			if status == 0 {
				status = http.StatusOK
			}

			payload := decodeGatewayError(capture.body.Bytes())
			if invocationlog.IsAuthFailure(status, payload.Error.Code) {
				requestID := NormalizeRequestID(payload.Error.RequestID)
				if requestID == "" {
					requestID = NormalizeRequestID(capture.Header().Get(RequestIDHeader))
				}
				if requestID == "" {
					requestID = NormalizeRequestID(r.Header.Get(RequestIDHeader))
				}
				if requestID == "" {
					requestID = NewRequestID()
				}

				// P0 shortcut: 이 작성기는 인증 실패 로그를 직접 남기기 위한 연결 지점이다.
				// 정제된 요청/오류 메타데이터만 기록하고, 저장이 실패해도 응답 경로를 막지 않는다.
				_ = writer.WriteAuthFailureLog(r.Context(), invocationlog.BuildAuthFailureLog(invocationlog.AuthFailureInput{
					RequestID:    requestID,
					TraceID:      requestID,
					EndUserID:    r.Header.Get("X-GateLM-End-User-Id"),
					FeatureID:    r.Header.Get("X-GateLM-Feature-Id"),
					Endpoint:     r.URL.Path,
					Method:       r.Method,
					Source:       invocationlog.SourceCustomerApp,
					HTTPStatus:   status,
					ErrorCode:    payload.Error.Code,
					ErrorMessage: payload.Error.Message,
					ErrorStage:   invocationlog.AuthFailureStage(payload.Error.Code),
					StartedAt:    startedAt,
					CompletedAt:  completedAt,
				}))
			}

			w.WriteHeader(status)
			_, _ = w.Write(capture.body.Bytes())
		})
	}
}

type authFailureCaptureWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
	body        bytes.Buffer
}

func (w *authFailureCaptureWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
	w.wroteHeader = true
}

func (w *authFailureCaptureWriter) Write(body []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	_, _ = w.body.Write(body)
	return len(body), nil
}

type gatewayErrorPayload struct {
	Error struct {
		Message   string `json:"message"`
		Code      string `json:"code"`
		RequestID string `json:"request_id"`
	} `json:"error"`
}

func decodeGatewayError(body []byte) gatewayErrorPayload {
	var payload gatewayErrorPayload
	_ = json.Unmarshal(body, &payload)
	return payload
}
