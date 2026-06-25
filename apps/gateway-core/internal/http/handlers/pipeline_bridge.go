package handlers

import (
	"context"
	"net/http"

	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/pipeline"
)

type GatewayPipeline interface {
	Execute(ctx context.Context, gatewayCtx *request.GatewayContext) error
}

func newGatewayContext(reqCtx *pipeline.RequestContext, promptText string) *request.GatewayContext {
	if reqCtx == nil {
		return &request.GatewayContext{}
	}

	return &request.GatewayContext{
		Request: request.RequestContext{
			RequestID:      reqCtx.RequestID,
			TraceID:        reqCtx.TraceID,
			Endpoint:       reqCtx.Endpoint,
			Method:         reqCtx.Method,
			Stream:         reqCtx.Stream,
			RequestedModel: reqCtx.RequestedModel,
			PromptText:     promptText,
		},
		Identity: request.IdentityContext{
			TenantID:      reqCtx.TenantID,
			ProjectID:     reqCtx.ProjectID,
			ApplicationID: reqCtx.ApplicationID,
			APIKeyID:      reqCtx.APIKeyID,
			AppTokenID:    reqCtx.AppTokenID,
		},
		Routing: request.RoutingContext{
			RequestedModel:   reqCtx.RequestedModel,
			SelectedProvider: reqCtx.SelectedProvider,
			SelectedModel:    reqCtx.SelectedModel,
			RoutingReason:    reqCtx.RoutingReason,
		},
		Status: request.StatusContext{
			Status:       reqCtx.Status,
			HTTPStatus:   reqCtx.HTTPStatus,
			ErrorCode:    reqCtx.ErrorCode,
			ErrorMessage: reqCtx.ErrorMessage,
			ErrorStage:   reqCtx.ErrorStage,
		},
	}
}

func applyGatewayContext(reqCtx *pipeline.RequestContext, gatewayCtx *request.GatewayContext) {
	if reqCtx == nil || gatewayCtx == nil {
		return
	}

	reqCtx.TenantID = gatewayCtx.Identity.TenantID
	reqCtx.ProjectID = gatewayCtx.Identity.ProjectID
	reqCtx.ApplicationID = gatewayCtx.Identity.ApplicationID
	reqCtx.APIKeyID = gatewayCtx.Identity.APIKeyID
	reqCtx.AppTokenID = gatewayCtx.Identity.AppTokenID

	if gatewayCtx.Routing.RequestedModel != "" {
		reqCtx.RequestedModel = gatewayCtx.Routing.RequestedModel
	}
	reqCtx.SelectedProvider = gatewayCtx.Routing.SelectedProvider
	reqCtx.SelectedModel = gatewayCtx.Routing.SelectedModel
	reqCtx.RoutingReason = gatewayCtx.Routing.RoutingReason

	if gatewayCtx.Status.Status != "" {
		reqCtx.Status = gatewayCtx.Status.Status
		reqCtx.HTTPStatus = gatewayCtx.Status.HTTPStatus
		reqCtx.ErrorCode = gatewayCtx.Status.ErrorCode
		reqCtx.ErrorMessage = gatewayCtx.Status.ErrorMessage
		reqCtx.ErrorStage = gatewayCtx.Status.ErrorStage
	}
}

func writeGatewayPipelineFailure(w http.ResponseWriter, reqCtx *pipeline.RequestContext, err error) {
	if writeGatewayDomainError(w, reqCtx, err) {
		return
	}

	writeGatewayErrorWithContext(
		w,
		reqCtx,
		http.StatusInternalServerError,
		"internal_error",
		"Gateway pipeline failed.",
		"gateway_pipeline",
	)
}
