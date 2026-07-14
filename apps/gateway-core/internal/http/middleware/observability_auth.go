package middleware

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"
)

const ObservabilityTokenHeader = "X-GateLM-Observability-Token"

type observabilityAuthErrorResponse struct {
	Error observabilityAuthError `json:"error"`
}

type observabilityAuthError struct {
	Message   string  `json:"message"`
	Type      string  `json:"type"`
	Param     *string `json:"param"`
	Code      string  `json:"code"`
	RequestID string  `json:"request_id"`
}

// ObservabilityAuthMiddleware protects the Gateway's internal observability
// read routes. Supplying a token enables the boundary even when required is
// false; required with an empty token deliberately rejects every request.
func ObservabilityAuthMiddleware(expectedToken string, required bool) func(http.Handler) http.Handler {
	expectedToken = strings.TrimSpace(expectedToken)
	enabled := required || expectedToken != ""
	expectedDigest := sha256.Sum256([]byte(expectedToken))

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !enabled {
				next.ServeHTTP(w, r)
				return
			}

			providedToken := r.Header.Get(ObservabilityTokenHeader)
			providedDigest := sha256.Sum256([]byte(providedToken))
			valid := expectedToken != "" && providedToken != "" &&
				subtle.ConstantTimeCompare(providedDigest[:], expectedDigest[:]) == 1
			if !valid {
				writeObservabilityUnauthorized(w, r)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func writeObservabilityUnauthorized(w http.ResponseWriter, r *http.Request) {
	requestID := NormalizeRequestID(r.Header.Get(RequestIDHeader))
	if requestID == "" {
		requestID = NewRequestID()
	}

	w.Header().Set(RequestIDHeader, requestID)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(observabilityAuthErrorResponse{
		Error: observabilityAuthError{
			Message:   "Observability authorization failed.",
			Type:      "gatelm_gateway_error",
			Param:     nil,
			Code:      "observability_unauthorized",
			RequestID: requestID,
		},
	})
}
