package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
	"gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/pipeline"
	runtimeconfigstage "gatelm/apps/gateway-core/internal/pipeline/stages/runtimeconfig"
)

type ModelsHandler struct {
	ProviderCatalogResolver providercatalog.Resolver
	APIKeyAuthenticator     APIKeyAuthenticator
	ExpectedTenantID        string
	ExpectedProjectID       string
	ExpectedAppID           string
	RuntimePolicyPipeline   GatewayPipeline
}

func (h ModelsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	startedAt := time.Now()
	requestID := middleware.NormalizeRequestID(r.Header.Get(middleware.RequestIDHeader))
	if requestID == "" {
		requestID = middleware.NewRequestID()
	}

	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: requestID,
		TraceID:   requestID,
		Endpoint:  "/v1/models",
		Method:    http.MethodGet,
		StartedAt: startedAt.UTC(),
	})

	if err := authenticateGatewayAPIKeyRequest(
		r.Context(),
		r,
		reqCtx,
		h.APIKeyAuthenticator,
		h.ExpectedTenantID,
		h.ExpectedProjectID,
		h.ExpectedAppID,
	); err != nil {
		handleGatewayAuthError(w, reqCtx, err)
		return
	}

	if h.RuntimePolicyPipeline == nil {
		writeGatewayErrorWithContext(w, reqCtx, http.StatusInternalServerError, "internal_error", "Gateway runtime policy pipeline is not initialized.", runtimeconfigstage.StageName)
		return
	}

	gatewayCtx := newGatewayContext(reqCtx, "")
	if err := h.RuntimePolicyPipeline.Execute(r.Context(), gatewayCtx); err != nil {
		applyGatewayContext(reqCtx, gatewayCtx)
		writeGatewayPipelineFailure(w, reqCtx, err)
		return
	}
	applyGatewayContext(reqCtx, gatewayCtx)

	models, err := h.modelsFromRuntimeCatalog(r.Context(), reqCtx)
	if err != nil {
		writeModelCatalogResolutionFailure(w, reqCtx, err)
		return
	}

	setGatewayHeaders(w, reqCtx)
	writeJSON(w, http.StatusOK, models)
}

func (h ModelsHandler) modelsFromRuntimeCatalog(ctx context.Context, reqCtx *pipeline.RequestContext) (*provider.ModelListResponse, error) {
	if h.ProviderCatalogResolver == nil {
		return nil, providerResolutionFailure{
			httpStatus: http.StatusInternalServerError,
			code:       "provider_catalog_unavailable",
			message:    "Provider catalog is unavailable.",
			stage:      "resolve_provider_catalog",
			err:        providercatalog.ErrUnavailable,
		}
	}

	ref := reqCtx.RuntimeSnapshot.ProviderCatalogRef.Normalize()
	if ref.IsZero() {
		return nil, providerResolutionFailure{
			httpStatus: http.StatusInternalServerError,
			code:       "provider_catalog_unavailable",
			message:    "Provider catalog is unavailable.",
			stage:      "resolve_provider_catalog",
			err:        providercatalog.ErrUnavailable,
		}
	}

	catalog, err := h.ProviderCatalogResolver.GetCatalog(ctx, ref, providercatalog.Scope{
		TenantID:      reqCtx.TenantID,
		ProjectID:     reqCtx.ProjectID,
		ApplicationID: reqCtx.ApplicationID,
	})
	if err != nil {
		code := "provider_catalog_unavailable"
		if errors.Is(err, providercatalog.ErrMismatch) {
			code = "provider_catalog_mismatch"
		}
		return nil, providerResolutionFailure{
			httpStatus: http.StatusInternalServerError,
			code:       code,
			message:    "Provider catalog could not be verified.",
			stage:      "resolve_provider_catalog",
			err:        err,
		}
	}
	catalog = catalog.Normalize()
	if !catalog.Matches(ref) {
		return nil, providerResolutionFailure{
			httpStatus: http.StatusInternalServerError,
			code:       "provider_catalog_mismatch",
			message:    "Provider catalog reference mismatch.",
			stage:      "resolve_provider_catalog",
			err:        providercatalog.ErrMismatch,
		}
	}

	return modelListFromProviderCatalog(catalog), nil
}

func modelListFromProviderCatalog(catalog providercatalog.Catalog) *provider.ModelListResponse {
	resp := &provider.ModelListResponse{
		Object: "list",
		Data:   []provider.ModelInfo{},
	}
	for _, catalogProvider := range catalog.Normalize().Providers {
		if !catalogProvider.Enabled {
			continue
		}
		owner := firstNonEmpty(catalogProvider.ProviderName, catalogProvider.ProviderID, catalogProvider.AdapterType)
		for _, catalogModel := range catalogProvider.Models {
			catalogModel = catalogModel.Normalize()
			if !catalogModel.Enabled {
				continue
			}
			modelID := firstNonEmpty(catalogModel.ModelID, catalogModel.ModelName)
			if modelID == "" {
				continue
			}
			resp.Data = append(resp.Data, provider.ModelInfo{
				ID:      modelID,
				Object:  "model",
				OwnedBy: owner,
			})
		}
	}
	return resp
}

func writeModelCatalogResolutionFailure(w http.ResponseWriter, reqCtx *pipeline.RequestContext, err error) {
	var resolutionErr providerResolutionFailure
	if errors.As(err, &resolutionErr) {
		writeGatewayErrorWithContext(w, reqCtx, resolutionErr.httpStatus, resolutionErr.code, resolutionErr.message, resolutionErr.stage)
		return
	}
	writeGatewayErrorWithContext(w, reqCtx, http.StatusInternalServerError, "provider_catalog_unavailable", "Provider catalog is unavailable.", "resolve_provider_catalog")
}
