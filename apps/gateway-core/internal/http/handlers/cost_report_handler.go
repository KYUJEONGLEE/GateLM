package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type CostReportReader interface {
	GetCostReport(ctx context.Context, filter invocationlog.CostReportFilter) (invocationlog.CostReportFields, error)
}

type CostReportHandler struct {
	Reader   CostReportReader
	TenantID string
}

type costReportResponse struct {
	Data costReportDataResponse `json:"data"`
}

type costReportDataResponse struct {
	GeneratedAt         time.Time                       `json:"generatedAt"`
	Period              string                          `json:"period"`
	BucketInterval      string                          `json:"bucketInterval"`
	ExpectedBucketCount int                             `json:"expectedBucketCount"`
	Range               dashboardRangeResponse          `json:"range"`
	Filter              costReportFilterResponse        `json:"filters"`
	Totals              costReportTotalsResponse        `json:"totals"`
	Buckets             []costReportBucketResponse      `json:"buckets"`
	ModelBuckets        []costReportModelBucketResponse `json:"modelBuckets"`
	Breakdowns          costReportBreakdownResponse     `json:"breakdowns"`
	DataFreshness       dashboardDataFreshnessResponse  `json:"dataFreshness"`
}

type costReportFilterResponse struct {
	TenantID        string  `json:"tenantId"`
	ProjectID       *string `json:"projectId"`
	ApplicationID   *string `json:"applicationId"`
	Provider        *string `json:"provider"`
	Model           *string `json:"model"`
	BudgetScopeType *string `json:"budgetScopeType"`
	BudgetScopeID   *string `json:"budgetScopeId"`
	ResolvedBy      *string `json:"resolvedBy"`
}

type costReportTotalsResponse struct {
	RequestCount      int64  `json:"requestCount"`
	PromptTokens      int64  `json:"promptTokens"`
	CompletionTokens  int64  `json:"completionTokens"`
	TotalTokens       int64  `json:"totalTokens"`
	CostMicroUSD      int64  `json:"costMicroUsd"`
	CostUSD           string `json:"costUsd"`
	SavedCostMicroUSD int64  `json:"savedCostMicroUsd"`
	SavedCostUSD      string `json:"savedCostUsd"`
}

type costReportBucketResponse struct {
	PeriodStart       time.Time `json:"periodStart"`
	PeriodEnd         time.Time `json:"periodEnd"`
	RequestCount      int64     `json:"requestCount"`
	PromptTokens      int64     `json:"promptTokens"`
	CompletionTokens  int64     `json:"completionTokens"`
	TotalTokens       int64     `json:"totalTokens"`
	CostMicroUSD      int64     `json:"costMicroUsd"`
	CostUSD           string    `json:"costUsd"`
	SavedCostMicroUSD int64     `json:"savedCostMicroUsd"`
	SavedCostUSD      string    `json:"savedCostUsd"`
}

type costReportModelBucketResponse struct {
	PeriodStart  time.Time `json:"periodStart"`
	PeriodEnd    time.Time `json:"periodEnd"`
	Provider     string    `json:"provider"`
	Model        string    `json:"model"`
	RequestCount int64     `json:"requestCount"`
}

type costReportBreakdownResponse struct {
	ByProject     []costReportProjectBreakdownResponse     `json:"byProject"`
	ByApplication []costReportApplicationBreakdownResponse `json:"byApplication"`
	ByModel       []costReportModelBreakdownResponse       `json:"byModel"`
	ByBudgetScope []costReportBudgetScopeBreakdownResponse `json:"byBudgetScope"`
}

type costReportProjectBreakdownResponse struct {
	ProjectID         string `json:"projectId"`
	RequestCount      int64  `json:"requestCount"`
	PromptTokens      int64  `json:"promptTokens"`
	CompletionTokens  int64  `json:"completionTokens"`
	TotalTokens       int64  `json:"totalTokens"`
	CostMicroUSD      int64  `json:"costMicroUsd"`
	CostUSD           string `json:"costUsd"`
	SavedCostMicroUSD int64  `json:"savedCostMicroUsd"`
	SavedCostUSD      string `json:"savedCostUsd"`
}

type costReportApplicationBreakdownResponse struct {
	ApplicationID     string `json:"applicationId"`
	RequestCount      int64  `json:"requestCount"`
	PromptTokens      int64  `json:"promptTokens"`
	CompletionTokens  int64  `json:"completionTokens"`
	TotalTokens       int64  `json:"totalTokens"`
	CostMicroUSD      int64  `json:"costMicroUsd"`
	CostUSD           string `json:"costUsd"`
	SavedCostMicroUSD int64  `json:"savedCostMicroUsd"`
	SavedCostUSD      string `json:"savedCostUsd"`
}

type costReportModelBreakdownResponse struct {
	Provider          string `json:"provider"`
	Model             string `json:"model"`
	RequestCount      int64  `json:"requestCount"`
	PromptTokens      int64  `json:"promptTokens"`
	CompletionTokens  int64  `json:"completionTokens"`
	TotalTokens       int64  `json:"totalTokens"`
	CostMicroUSD      int64  `json:"costMicroUsd"`
	CostUSD           string `json:"costUsd"`
	SavedCostMicroUSD int64  `json:"savedCostMicroUsd"`
	SavedCostUSD      string `json:"savedCostUsd"`
}

type costReportBudgetScopeBreakdownResponse struct {
	BudgetScopeType   string `json:"budgetScopeType"`
	BudgetScopeID     string `json:"budgetScopeId"`
	ResolvedBy        string `json:"resolvedBy"`
	RequestCount      int64  `json:"requestCount"`
	PromptTokens      int64  `json:"promptTokens"`
	CompletionTokens  int64  `json:"completionTokens"`
	TotalTokens       int64  `json:"totalTokens"`
	CostMicroUSD      int64  `json:"costMicroUsd"`
	CostUSD           string `json:"costUsd"`
	SavedCostMicroUSD int64  `json:"savedCostMicroUsd"`
	SavedCostUSD      string `json:"savedCostUsd"`
}

func (h CostReportHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Reader == nil {
		writeGatewayError(w, http.StatusServiceUnavailable, "", "invocation_log_reader_unavailable", "Cost report reader is not configured.")
		return
	}

	from, err := parseRequiredRFC3339Query(r, "from")
	if err != nil {
		writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
		return
	}
	to, err := parseRequiredRFC3339Query(r, "to")
	if err != nil {
		writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
		return
	}

	query := r.URL.Query()
	filter := invocationlog.CostReportFilter{
		TenantID:      firstNonEmptyQueryValue(query.Get("tenantId"), h.TenantID),
		ProjectID:     query.Get("projectId"),
		ApplicationID: query.Get("applicationId"),
		Provider:      query.Get("provider"),
		Model:         query.Get("model"),
		BudgetScope:   budgetScopeFromQuery(query),
		Period:        query.Get("period"),
		From:          from,
		To:            to,
	}
	report, err := h.Reader.GetCostReport(r.Context(), filter)
	if err != nil {
		if errors.Is(err, invocationlog.ErrInvalidLogQuery) {
			writeGatewayError(w, http.StatusBadRequest, "", "invalid_log_query", err.Error())
			return
		}
		if errors.Is(err, invocationlog.ErrAnalyticsDataUnavailable) {
			writeGatewayError(w, http.StatusServiceUnavailable, "", "ANALYTICS_DATA_UNAVAILABLE", "Cost report data is unavailable.")
			return
		}
		logInvocationLogInternalError(r, "get_cost_report", filter.TenantID, filter.ProjectID, err)
		writeGatewayError(w, http.StatusInternalServerError, "", "internal_error", "Cost report could not be loaded.")
		return
	}

	writeJSON(w, http.StatusOK, costReportResponse{Data: costReportData(filter, report)})
}

func costReportData(filter invocationlog.CostReportFilter, report invocationlog.CostReportFields) costReportDataResponse {
	return costReportDataResponse{
		GeneratedAt:         report.DataFreshness.GeneratedAt,
		Period:              report.Period,
		BucketInterval:      report.BucketInterval,
		ExpectedBucketCount: report.ExpectedBucketCount,
		Range: dashboardRangeResponse{
			From: filter.From,
			To:   filter.To,
		},
		Filter: costReportFilterResponse{
			TenantID:        filter.TenantID,
			ProjectID:       stringPointerOrNil(filter.ProjectID),
			ApplicationID:   stringPointerOrNil(filter.ApplicationID),
			Provider:        stringPointerOrNil(filter.Provider),
			Model:           stringPointerOrNil(filter.Model),
			BudgetScopeType: stringPointerOrNil(filter.BudgetScope.Type),
			BudgetScopeID:   stringPointerOrNil(filter.BudgetScope.ID),
			ResolvedBy:      stringPointerOrNil(filter.BudgetScope.ResolvedBy),
		},
		Totals:       costReportTotals(report.Totals),
		Buckets:      costReportBuckets(report.Buckets),
		ModelBuckets: costReportModelBuckets(report.ModelBuckets),
		Breakdowns:   costReportBreakdowns(report.Breakdowns),
		DataFreshness: dashboardDataFreshnessResponse{
			Source:           report.DataFreshness.Source,
			RecordCount:      report.DataFreshness.RecordCount,
			LastLogCreatedAt: report.DataFreshness.LastLogCreatedAt,
			GeneratedAt:      report.DataFreshness.GeneratedAt,
		},
	}
}

func costReportModelBuckets(items []invocationlog.CostReportModelBucket) []costReportModelBucketResponse {
	responses := make([]costReportModelBucketResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, costReportModelBucketResponse{
			PeriodStart:  item.PeriodStart,
			PeriodEnd:    item.PeriodEnd,
			Provider:     item.Provider,
			Model:        item.Model,
			RequestCount: item.RequestCount,
		})
	}
	return responses
}

func costReportTotals(totals invocationlog.CostReportTotals) costReportTotalsResponse {
	return costReportTotalsResponse{
		RequestCount:      totals.RequestCount,
		PromptTokens:      totals.PromptTokens,
		CompletionTokens:  totals.CompletionTokens,
		TotalTokens:       totals.TotalTokens,
		CostMicroUSD:      totals.CostMicroUSD,
		CostUSD:           totals.CostUSD,
		SavedCostMicroUSD: totals.SavedCostMicroUSD,
		SavedCostUSD:      totals.SavedCostUSD,
	}
}

func costReportBuckets(items []invocationlog.CostReportBucket) []costReportBucketResponse {
	responses := make([]costReportBucketResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, costReportBucketResponse{
			PeriodStart:       item.PeriodStart,
			PeriodEnd:         item.PeriodEnd,
			RequestCount:      item.RequestCount,
			PromptTokens:      item.PromptTokens,
			CompletionTokens:  item.CompletionTokens,
			TotalTokens:       item.TotalTokens,
			CostMicroUSD:      item.CostMicroUSD,
			CostUSD:           item.CostUSD,
			SavedCostMicroUSD: item.SavedCostMicroUSD,
			SavedCostUSD:      item.SavedCostUSD,
		})
	}
	return responses
}

func costReportBreakdowns(items invocationlog.CostReportBreakdowns) costReportBreakdownResponse {
	return costReportBreakdownResponse{
		ByProject:     costReportProjectBreakdowns(items.ByProject),
		ByApplication: costReportApplicationBreakdowns(items.ByApplication),
		ByModel:       costReportModelBreakdowns(items.ByModel),
		ByBudgetScope: costReportBudgetScopeBreakdowns(items.ByBudgetScope),
	}
}

func costReportProjectBreakdowns(items []invocationlog.CostReportProjectBreakdown) []costReportProjectBreakdownResponse {
	responses := make([]costReportProjectBreakdownResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, costReportProjectBreakdownResponse{
			ProjectID:         item.ProjectID,
			RequestCount:      item.RequestCount,
			PromptTokens:      item.PromptTokens,
			CompletionTokens:  item.CompletionTokens,
			TotalTokens:       item.TotalTokens,
			CostMicroUSD:      item.CostMicroUSD,
			CostUSD:           item.CostUSD,
			SavedCostMicroUSD: item.SavedCostMicroUSD,
			SavedCostUSD:      item.SavedCostUSD,
		})
	}
	return responses
}

func costReportApplicationBreakdowns(items []invocationlog.CostReportApplicationBreakdown) []costReportApplicationBreakdownResponse {
	responses := make([]costReportApplicationBreakdownResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, costReportApplicationBreakdownResponse{
			ApplicationID:     item.ApplicationID,
			RequestCount:      item.RequestCount,
			PromptTokens:      item.PromptTokens,
			CompletionTokens:  item.CompletionTokens,
			TotalTokens:       item.TotalTokens,
			CostMicroUSD:      item.CostMicroUSD,
			CostUSD:           item.CostUSD,
			SavedCostMicroUSD: item.SavedCostMicroUSD,
			SavedCostUSD:      item.SavedCostUSD,
		})
	}
	return responses
}

func costReportModelBreakdowns(items []invocationlog.CostReportModelBreakdown) []costReportModelBreakdownResponse {
	responses := make([]costReportModelBreakdownResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, costReportModelBreakdownResponse{
			Provider:          item.Provider,
			Model:             item.Model,
			RequestCount:      item.RequestCount,
			PromptTokens:      item.PromptTokens,
			CompletionTokens:  item.CompletionTokens,
			TotalTokens:       item.TotalTokens,
			CostMicroUSD:      item.CostMicroUSD,
			CostUSD:           item.CostUSD,
			SavedCostMicroUSD: item.SavedCostMicroUSD,
			SavedCostUSD:      item.SavedCostUSD,
		})
	}
	return responses
}

func costReportBudgetScopeBreakdowns(items []invocationlog.CostReportBudgetScopeBreakdown) []costReportBudgetScopeBreakdownResponse {
	responses := make([]costReportBudgetScopeBreakdownResponse, 0, len(items))
	for _, item := range items {
		scope := budget.NormalizeScope(item.BudgetScope, "")
		responses = append(responses, costReportBudgetScopeBreakdownResponse{
			BudgetScopeType:   scope.Type,
			BudgetScopeID:     scope.ID,
			ResolvedBy:        scope.ResolvedBy,
			RequestCount:      item.RequestCount,
			PromptTokens:      item.PromptTokens,
			CompletionTokens:  item.CompletionTokens,
			TotalTokens:       item.TotalTokens,
			CostMicroUSD:      item.CostMicroUSD,
			CostUSD:           item.CostUSD,
			SavedCostMicroUSD: item.SavedCostMicroUSD,
			SavedCostUSD:      item.SavedCostUSD,
		})
	}
	return responses
}
