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
			StartedAt:      reqCtx.StartedAt,
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
		Masking: request.MaskingContext{
			Action:                  reqCtx.MaskingAction,
			DetectedTypes:           reqCtx.MaskingDetectedTypes,
			DetectedCount:           reqCtx.MaskingDetectedCount,
			RedactedPromptPreview:   reqCtx.RedactedPromptPreview,
			SecurityPolicyVersionID: reqCtx.SecurityPolicyVersionID,
		},
		Routing: request.RoutingContext{
			RequestedModel:    reqCtx.RequestedModel,
			SelectedProvider:  reqCtx.SelectedProvider,
			SelectedModel:     reqCtx.SelectedModel,
			RoutingReason:     reqCtx.RoutingReason,
			RoutingPolicyHash: reqCtx.RoutingPolicyHash,
		},
		Cache: request.CacheContext{
			CacheStatus:       reqCtx.CacheStatus,
			CacheType:         reqCtx.CacheType,
			CacheKeyHash:      reqCtx.CacheKeyHash,
			CacheHitRequestID: reqCtx.CacheHitRequestID,
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

	if gatewayCtx.Masking.Action != "" {
		reqCtx.MaskingAction = gatewayCtx.Masking.Action
	}
	if gatewayCtx.Masking.DetectedTypes != nil {
		reqCtx.MaskingDetectedTypes = gatewayCtx.Masking.DetectedTypes
	}
	if gatewayCtx.Masking.DetectedCount != 0 {
		reqCtx.MaskingDetectedCount = gatewayCtx.Masking.DetectedCount
	}
	if gatewayCtx.Masking.RedactedPromptPreview != "" {
		reqCtx.RedactedPromptPreview = gatewayCtx.Masking.RedactedPromptPreview
	}
	if gatewayCtx.Masking.SecurityPolicyVersionID != "" {
		reqCtx.SecurityPolicyVersionID = gatewayCtx.Masking.SecurityPolicyVersionID
	}

	if gatewayCtx.Routing.RequestedModel != "" {
		reqCtx.RequestedModel = gatewayCtx.Routing.RequestedModel
	}
	if gatewayCtx.Routing.SelectedProvider != "" {
		reqCtx.SelectedProvider = gatewayCtx.Routing.SelectedProvider
	}
	if gatewayCtx.Routing.SelectedModel != "" {
		reqCtx.SelectedModel = gatewayCtx.Routing.SelectedModel
	}
	if gatewayCtx.Routing.RoutingReason != "" {
		reqCtx.RoutingReason = gatewayCtx.Routing.RoutingReason
	}
	if gatewayCtx.Routing.RoutingPolicyHash != "" {
		reqCtx.RoutingPolicyHash = gatewayCtx.Routing.RoutingPolicyHash
	}

	if gatewayCtx.Cache.CacheStatus != "" {
		reqCtx.CacheStatus = gatewayCtx.Cache.CacheStatus
	}
	if gatewayCtx.Cache.CacheType != "" {
		reqCtx.CacheType = gatewayCtx.Cache.CacheType
	}
	if gatewayCtx.Cache.CacheKeyHash != "" {
		reqCtx.CacheKeyHash = gatewayCtx.Cache.CacheKeyHash
	}
	if gatewayCtx.Cache.CacheHitRequestID != "" {
		reqCtx.CacheHitRequestID = gatewayCtx.Cache.CacheHitRequestID
	}

	if gatewayCtx.Status.Status != "" {
		reqCtx.Status = gatewayCtx.Status.Status
	}
	if gatewayCtx.Status.HTTPStatus != 0 {
		reqCtx.HTTPStatus = gatewayCtx.Status.HTTPStatus
	}
	if gatewayCtx.Status.ErrorCode != "" {
		reqCtx.ErrorCode = gatewayCtx.Status.ErrorCode
	}
	if gatewayCtx.Status.ErrorMessage != "" {
		reqCtx.ErrorMessage = gatewayCtx.Status.ErrorMessage
	}
	if gatewayCtx.Status.ErrorStage != "" {
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
