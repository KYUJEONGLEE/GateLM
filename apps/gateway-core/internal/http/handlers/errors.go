package handlers

import (
	"encoding/json"
	"net/http"
)

type gatewayErrorResponse struct {
	Error gatewayError `json:"error"`
}

type gatewayError struct {
	Message   string  `json:"message"`
	Type      string  `json:"type"`
	Param     *string `json:"param"`
	Code      string  `json:"code"`
	RequestID string  `json:"request_id"`
}

func writeGatewayError(w http.ResponseWriter, status int, requestID string, code string, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-GateLM-Request-Id", requestID)
	w.WriteHeader(status)

	_ = json.NewEncoder(w).Encode(gatewayErrorResponse{
		Error: gatewayError{
			Message:   message,
			Type:      "gatelm_gateway_error",
			Param:     nil,
			Code:      code,
			RequestID: requestID,
		},
	})
}
