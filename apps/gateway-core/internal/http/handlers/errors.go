package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/pipeline"
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

type gatewayHeaderValues struct {
	RequestID        string
	CacheStatus      string
	RoutedProvider   string
	RoutedModel      string
	MaskingAction    string
	EstimatedCostUSD string
}

func writeGatewayError(w http.ResponseWriter, status int, requestID string, code string, message string) {
	writeGatewayErrorWithHeaders(w, status, defaultGatewayHeaderValues(requestID), code, message)
}

func writeGatewayErrorWithContext(w http.ResponseWriter, reqCtx *pipeline.RequestContext, status int, code string, message string, stage string) {
	if reqCtx == nil {
		writeGatewayError(w, status, "", code, message)
		return
	}

	reqCtx.Status = terminalStatusForErrorCode(code)
	reqCtx.HTTPStatus = status
	reqCtx.ErrorCode = code
	reqCtx.ErrorMessage = message
	reqCtx.ErrorStage = stage

	writeGatewayErrorWithHeaders(w, status, gatewayHeaderValuesFromContext(reqCtx), code, message)
}

func terminalStatusForErrorCode(code string) string {
	if code == "rate_limited" {
		return "rate_limited"
	}
	return "error"
}

func writeGatewayDomainError(w http.ResponseWriter, reqCtx *pipeline.RequestContext, err error) bool {
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		return false
	}

	writeGatewayErrorWithContext(w, reqCtx, gatewayErr.HTTPStatus, gatewayErr.Code, gatewayErr.Message, gatewayErr.Stage)
	return true
}

func writeGatewayErrorWithHeaders(w http.ResponseWriter, status int, headers gatewayHeaderValues, code string, message string) {
	setGatewayHeaderValues(w, headers)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	_ = json.NewEncoder(w).Encode(gatewayErrorResponse{
		Error: gatewayError{
			Message:   message,
			Type:      "gatelm_gateway_error",
			Param:     nil,
			Code:      code,
			RequestID: headers.RequestID,
		},
	})
}

func setGatewayHeaders(w http.ResponseWriter, reqCtx *pipeline.RequestContext) {
	setGatewayHeaderValues(w, gatewayHeaderValuesFromContext(reqCtx))
}

func setGatewayHeaderValues(w http.ResponseWriter, headers gatewayHeaderValues) {
	if headers.RequestID != "" {
		w.Header().Set(middleware.RequestIDHeader, headers.RequestID)
	}
	w.Header().Set("X-GateLM-Cache-Status", headers.CacheStatus)
	w.Header().Set("X-GateLM-Routed-Provider", headers.RoutedProvider)
	w.Header().Set("X-GateLM-Routed-Model", headers.RoutedModel)
	w.Header().Set("X-GateLM-Masking-Action", headers.MaskingAction)
	w.Header().Set("X-GateLM-Estimated-Cost-Usd", headers.EstimatedCostUSD)
}

func gatewayHeaderValuesFromContext(reqCtx *pipeline.RequestContext) gatewayHeaderValues {
	if reqCtx == nil {
		return defaultGatewayHeaderValues("")
	}

	headers := defaultGatewayHeaderValues(reqCtx.RequestID)
	if reqCtx.CacheStatus != "" {
		headers.CacheStatus = reqCtx.CacheStatus
	}
	if reqCtx.SelectedProvider != "" {
		headers.RoutedProvider = reqCtx.SelectedProvider
	}
	if reqCtx.SelectedModel != "" {
		headers.RoutedModel = reqCtx.SelectedModel
	}
	if reqCtx.MaskingAction != "" {
		headers.MaskingAction = reqCtx.MaskingAction
	}
	headers.EstimatedCostUSD = formatCostMicroUSD(reqCtx.CostMicroUSD)

	return headers
}

func defaultGatewayHeaderValues(requestID string) gatewayHeaderValues {
	return gatewayHeaderValues{
		RequestID:        requestID,
		CacheStatus:      "bypass",
		MaskingAction:    "none",
		EstimatedCostUSD: "0.000000",
	}
}

func formatCostMicroUSD(costMicroUSD int64) string {
	if costMicroUSD <= 0 {
		return "0.000000"
	}

	dollars := costMicroUSD / 1_000_000
	micros := costMicroUSD % 1_000_000

	return fmt.Sprintf("%d.%06d", dollars, micros)
}
