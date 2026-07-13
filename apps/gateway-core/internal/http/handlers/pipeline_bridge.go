package handlers

import (
	"context"
	"net/http"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/domain/stagetiming"
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
			TenantID:       reqCtx.TenantID,
			ProjectID:      reqCtx.ProjectID,
			ApplicationID:  reqCtx.ApplicationID,
			APIKeyID:       reqCtx.APIKeyID,
			AppTokenID:     reqCtx.AppTokenID,
			TrustedActorID: reqCtx.TrustedActorID,
			EmployeeID:     reqCtx.EmployeeID,
			EndUserID:      reqCtx.EndUserID,
			FeatureID:      reqCtx.FeatureID,
		},
		Budget: budget.NormalizeScope(reqCtx.BudgetScope, reqCtx.ApplicationID),
		Runtime: request.RuntimeContext{
			ConfigHash:         reqCtx.ConfigHash,
			SecurityPolicyHash: reqCtx.SecurityPolicyHash,
			RoutingPolicyHash:  reqCtx.RoutingPolicyHash,
			Snapshot:           reqCtx.RuntimeSnapshot,
			SafetyPolicy:       reqCtx.RuntimeSafetyPolicy,
			EmployeePolicy:     reqCtx.RuntimeEmployeePolicy,
			HasEmployeePolicy:  reqCtx.HasRuntimeEmployeePolicy,
			RateLimitConfig:    reqCtx.RuntimeRateLimit,
			HasRateLimitConfig: reqCtx.HasRuntimeRateLimit,
			BudgetPolicy:       reqCtx.RuntimeBudgetPolicy,
			HasBudgetPolicy:    reqCtx.HasRuntimeBudgetPolicy,
			RoutingPolicy:      reqCtx.RuntimeRoutingPolicy,
			HasRoutingPolicy:   reqCtx.HasRuntimeRoutingPolicy,
			CachePolicy:        reqCtx.RuntimeCachePolicy,
			HasCachePolicy:     reqCtx.HasRuntimeCachePolicy,
			PromptCapture:      reqCtx.RuntimePromptCapture,
			HasPromptCapture:   reqCtx.HasRuntimePromptCapture,
			ResponseCapture:    reqCtx.RuntimeResponseCapture,
			HasResponseCapture: reqCtx.HasRuntimeResponseCapture,
		},
		Governance: request.GovernanceContext{
			RateLimitDecision:      reqCtx.RateLimitDecision.Clone(),
			BudgetDecision:         reqCtx.BudgetDecision.Clone(),
			EmployeePolicyDecision: reqCtx.EmployeePolicyDecision.Clone(),
		},
		Masking: request.MaskingContext{
			Action:                  reqCtx.MaskingAction,
			DetectedTypes:           reqCtx.MaskingDetectedTypes,
			DetectedCount:           reqCtx.MaskingDetectedCount,
			PolicyAllowedTypes:      reqCtx.PolicyAllowedTypes,
			MandatoryProtectedTypes: reqCtx.MandatoryProtectedTypes,
			RedactedPromptPreview:   reqCtx.RedactedPromptPreview,
			SecurityPolicyVersionID: reqCtx.SecurityPolicyVersionID,
		},
		Routing: request.RoutingContext{
			RequestedModel:             reqCtx.RequestedModel,
			SelectedProvider:           reqCtx.SelectedProvider,
			SelectedProviderID:         reqCtx.SelectedProviderID,
			SelectedProviderCatalogKey: reqCtx.SelectedProviderCatalogKey,
			SelectedModel:              reqCtx.SelectedModel,
			SelectedModelID:            reqCtx.SelectedModelID,
			ProviderCatalogContentHash: reqCtx.ProviderCatalogContentHash,
			RoutingDecisionKeyHash:     reqCtx.RoutingDecisionKeyHash,
			RoutingDecisionMaterial:    map[string]string{"category": reqCtx.PromptCategory},
			RoutingReason:              reqCtx.RoutingReason,
			RoutingPolicyHash:          reqCtx.RoutingPolicyHash,
		},
		Cache: request.CacheContext{
			CacheStatus:         reqCtx.CacheStatus,
			CacheType:           reqCtx.CacheType,
			CacheKeyHash:        reqCtx.CacheKeyHash,
			CacheHitRequestID:   reqCtx.CacheHitRequestID,
			CacheKeyVersion:     reqCtx.CacheKeyVersion,
			CacheDecisionReason: reqCtx.CacheDecisionReason,
			FallbackOccurred:    reqCtx.FallbackOccurred,
			SavedCostMicroUSD:   reqCtx.SavedCostMicroUSD,
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
	reqCtx.BudgetScope = budget.NormalizeScope(gatewayCtx.Budget, reqCtx.ApplicationID)
	reqCtx.APIKeyID = gatewayCtx.Identity.APIKeyID
	reqCtx.AppTokenID = gatewayCtx.Identity.AppTokenID
	reqCtx.TrustedActorID = gatewayCtx.Identity.TrustedActorID
	reqCtx.EmployeeID = gatewayCtx.Identity.EmployeeID
	reqCtx.EndUserID = gatewayCtx.Identity.EndUserID
	reqCtx.FeatureID = gatewayCtx.Identity.FeatureID

	if gatewayCtx.Runtime.ConfigHash != "" {
		reqCtx.ConfigHash = gatewayCtx.Runtime.ConfigHash
	}
	if gatewayCtx.Runtime.SecurityPolicyHash != "" {
		reqCtx.SecurityPolicyHash = gatewayCtx.Runtime.SecurityPolicyHash
	}
	if gatewayCtx.Runtime.HasEmployeePolicy {
		reqCtx.RuntimeEmployeePolicy = gatewayCtx.Runtime.EmployeePolicy
		reqCtx.HasRuntimeEmployeePolicy = true
	}
	if gatewayCtx.Runtime.SafetyPolicy.SecurityPolicyHash != "" || len(gatewayCtx.Runtime.SafetyPolicy.DetectorSet) > 0 {
		reqCtx.RuntimeSafetyPolicy = gatewayCtx.Runtime.SafetyPolicy
	}
	if gatewayCtx.Runtime.RoutingPolicyHash != "" {
		reqCtx.RoutingPolicyHash = gatewayCtx.Runtime.RoutingPolicyHash
	}
	if gatewayCtx.Runtime.Snapshot.RuntimeSnapshotID != "" {
		reqCtx.RuntimeSnapshot = gatewayCtx.Runtime.Snapshot
	}
	if gatewayCtx.Runtime.HasRateLimitConfig {
		reqCtx.RuntimeRateLimit = gatewayCtx.Runtime.RateLimitConfig
		reqCtx.HasRuntimeRateLimit = true
	}
	if gatewayCtx.Runtime.HasBudgetPolicy {
		reqCtx.RuntimeBudgetPolicy = gatewayCtx.Runtime.BudgetPolicy
		reqCtx.HasRuntimeBudgetPolicy = true
	}
	if gatewayCtx.Runtime.HasRoutingPolicy {
		reqCtx.RuntimeRoutingPolicy = gatewayCtx.Runtime.RoutingPolicy
		reqCtx.HasRuntimeRoutingPolicy = true
	}
	if gatewayCtx.Runtime.HasCachePolicy {
		reqCtx.RuntimeCachePolicy = gatewayCtx.Runtime.CachePolicy
		reqCtx.HasRuntimeCachePolicy = true
	}
	if gatewayCtx.Runtime.HasPromptCapture {
		reqCtx.RuntimePromptCapture = gatewayCtx.Runtime.PromptCapture
		reqCtx.HasRuntimePromptCapture = true
	}
	if gatewayCtx.Runtime.HasResponseCapture {
		reqCtx.RuntimeResponseCapture = gatewayCtx.Runtime.ResponseCapture
		reqCtx.HasRuntimeResponseCapture = true
	}

	if gatewayCtx.Governance.RateLimitDecision != nil {
		reqCtx.RateLimitDecision = gatewayCtx.Governance.RateLimitDecision.Clone()
	}
	if gatewayCtx.Governance.BudgetDecision != nil {
		reqCtx.BudgetDecision = gatewayCtx.Governance.BudgetDecision.Clone()
	}
	if gatewayCtx.Governance.EmployeePolicyDecision != nil {
		reqCtx.EmployeePolicyDecision = gatewayCtx.Governance.EmployeePolicyDecision.Clone()
	}

	if gatewayCtx.Masking.Action != "" {
		reqCtx.MaskingAction = gatewayCtx.Masking.Action
	}
	if gatewayCtx.Masking.DetectedTypes != nil {
		reqCtx.MaskingDetectedTypes = gatewayCtx.Masking.DetectedTypes
	}
	if gatewayCtx.Masking.DetectedCount != 0 {
		reqCtx.MaskingDetectedCount = gatewayCtx.Masking.DetectedCount
	}
	if gatewayCtx.Masking.PolicyAllowedTypes != nil {
		reqCtx.PolicyAllowedTypes = gatewayCtx.Masking.PolicyAllowedTypes
	}
	if gatewayCtx.Masking.MandatoryProtectedTypes != nil {
		reqCtx.MandatoryProtectedTypes = gatewayCtx.Masking.MandatoryProtectedTypes
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
	if gatewayCtx.Routing.SelectedProviderID != "" {
		reqCtx.SelectedProviderID = gatewayCtx.Routing.SelectedProviderID
	}
	if gatewayCtx.Routing.SelectedProviderCatalogKey != "" {
		reqCtx.SelectedProviderCatalogKey = gatewayCtx.Routing.SelectedProviderCatalogKey
	}
	if gatewayCtx.Routing.SelectedModel != "" {
		reqCtx.SelectedModel = gatewayCtx.Routing.SelectedModel
	}
	if gatewayCtx.Routing.SelectedModelID != "" {
		reqCtx.SelectedModelID = gatewayCtx.Routing.SelectedModelID
	}
	if gatewayCtx.Routing.ProviderCatalogContentHash != "" {
		reqCtx.ProviderCatalogContentHash = gatewayCtx.Routing.ProviderCatalogContentHash
	}
	if gatewayCtx.Routing.RoutingDecisionKeyHash != "" {
		reqCtx.RoutingDecisionKeyHash = gatewayCtx.Routing.RoutingDecisionKeyHash
	}
	if category := gatewayCtx.Routing.RoutingDecisionMaterial["category"]; category != "" {
		reqCtx.PromptCategory = category
	}
	if gatewayCtx.Routing.RoutingReason != "" {
		reqCtx.RoutingReason = gatewayCtx.Routing.RoutingReason
	}
	if gatewayCtx.Routing.RoutingPolicyHash != "" {
		reqCtx.RoutingPolicyHash = gatewayCtx.Routing.RoutingPolicyHash
	}
	if gatewayCtx.Routing.CategoryDiagnostics.HasData() {
		reqCtx.CategoryDiagnostics = gatewayCtx.Routing.CategoryDiagnostics
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
	if gatewayCtx.Cache.CacheKeyVersion != "" {
		reqCtx.CacheKeyVersion = gatewayCtx.Cache.CacheKeyVersion
	}
	if gatewayCtx.Cache.CacheDecisionReason != "" {
		reqCtx.CacheDecisionReason = gatewayCtx.Cache.CacheDecisionReason
	}
	reqCtx.FallbackOccurred = gatewayCtx.Cache.FallbackOccurred
	reqCtx.SavedCostMicroUSD = gatewayCtx.Cache.SavedCostMicroUSD

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

	stagetiming.Merge(&reqCtx.StageTimings, gatewayCtx.StageTimings)
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
