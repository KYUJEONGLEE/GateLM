package invocationlog

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrInvalidLogQuery = errors.New("invalid invocation log query")
	ErrLogNotFound     = errors.New("invocation log not found")
)

type Reader interface {
	ListProjectLogs(ctx context.Context, filter ProjectLogsFilter) ([]RequestLogListItem, error)
	GetRequestDetail(ctx context.Context, filter RequestDetailFilter) (RequestDetail, error)
	GetDashboardOverview(ctx context.Context, filter DashboardOverviewFilter) (DashboardOverviewFields, error)
}

type ProjectLogsFilter struct {
	ProjectID     string
	From          time.Time
	To            time.Time
	Status        string
	Provider      string
	Model         string
	CacheStatus   string
	ApplicationID string
	RequestID     string
	Limit         int
}

type RequestDetailFilter struct {
	ProjectID string
	RequestID string
}

type DashboardOverviewFilter struct {
	TenantID  string
	ProjectID string
	From      time.Time
	To        time.Time
}

type LlmInvocationLog struct {
	RequestID     string
	TraceID       string
	TenantID      string
	ProjectID     string
	ApplicationID string
	APIKeyID      string
	AppTokenID    string
	EndUserID     string
	FeatureID     string

	Endpoint              string
	Method                string
	Source                string
	Stream                bool
	RequestedProvider     string
	RequestedModel        string
	Provider              string
	Model                 string
	SelectedProvider      string
	SelectedModel         string
	RoutingReason         string
	RoutingRuleID         string
	PromptTokens          int64
	CompletionTokens      int64
	TotalTokens           int64
	CostMicroUSD          int64
	SavedCostMicroUSD     int64
	LatencyMs             int64
	ProviderLatencyMs     *int64
	Status                string
	HTTPStatus            int
	ErrorCode             string
	ErrorMessage          string
	ErrorStage            string
	CacheStatus           string
	CacheType             string
	CacheKeyHash          string
	CacheHitRequestID     string
	MaskingAction         string
	MaskingDetectedTypes  []string
	MaskingDetectedCount  int
	RedactedPromptPreview string
	CreatedAt             time.Time
	CompletedAt           *time.Time
}

type RequestLogListItem struct {
	RequestID        string
	ProjectID        string
	ApplicationID    string
	Provider         string
	Model            string
	RequestedModel   string
	SelectedModel    string
	Status           string
	HTTPStatus       int
	PromptTokens     int64
	CompletionTokens int64
	TotalTokens      int64
	CostUSD          string
	CostMicroUSD     int64
	LatencyMs        int64
	CacheStatus      string
	CacheType        string
	RoutingReason    string
	MaskingAction    string
	CreatedAt        time.Time
}

type RequestDetail struct {
	RequestID      string
	TraceID        string
	TenantID       string
	ProjectID      string
	ApplicationID  string
	Status         string
	HTTPStatus     int
	Provider       string
	Model          string
	RequestedModel string
	SelectedModel  string
	Usage          UsageFields
	Cost           CostFields
	Latency        LatencyFields
	Cache          CacheFields
	Routing        RoutingFields
	Masking        MaskingFields
	Error          ErrorFields
	CreatedAt      time.Time
	CompletedAt    *time.Time
}

type UsageFields struct {
	PromptTokens     int64
	CompletionTokens int64
	TotalTokens      int64
}

type CostFields struct {
	CostUSD      string
	CostMicroUSD int64
	Currency     string
}

type LatencyFields struct {
	LatencyMs         int64
	ProviderLatencyMs *int64
}

type CacheFields struct {
	CacheStatus       string
	CacheType         string
	CacheKeyHash      string
	CacheHitRequestID string
}

type RoutingFields struct {
	RoutingReason    string
	RoutingRuleID    string
	SelectedProvider string
	SelectedModel    string
}

type MaskingFields struct {
	MaskingAction         string
	MaskingDetectedTypes  []string
	MaskingDetectedCount  int
	RedactedPromptPreview string
}

type ErrorFields struct {
	ErrorCode    string
	ErrorMessage string
	ErrorStage   string
}

type DashboardOverviewFields struct {
	TotalRequests         int64
	SuccessfulRequests    int64
	BlockedRequests       int64
	CacheHitRequests      int64
	CacheHitRate          *float64
	TotalTokens           int64
	TotalCostMicroUSD     int64
	TotalCostUSD          string
	AverageResponseTimeMs *float64
}

func NormalizeProjectLogsFilter(filter ProjectLogsFilter) (ProjectLogsFilter, error) {
	filter.ProjectID = strings.TrimSpace(filter.ProjectID)
	filter.Status = strings.TrimSpace(filter.Status)
	filter.Provider = strings.TrimSpace(filter.Provider)
	filter.Model = strings.TrimSpace(filter.Model)
	filter.CacheStatus = strings.TrimSpace(filter.CacheStatus)
	filter.ApplicationID = strings.TrimSpace(filter.ApplicationID)
	filter.RequestID = strings.TrimSpace(filter.RequestID)

	if filter.ProjectID == "" {
		return ProjectLogsFilter{}, fmt.Errorf("%w: project id is required", ErrInvalidLogQuery)
	}
	if err := validateTimeRange(filter.From, filter.To); err != nil {
		return ProjectLogsFilter{}, err
	}
	if filter.Limit <= 0 {
		filter.Limit = 50
	}
	if filter.Limit > 100 {
		filter.Limit = 100
	}

	return filter, nil
}

func NormalizeRequestDetailFilter(filter RequestDetailFilter) (RequestDetailFilter, error) {
	filter.ProjectID = strings.TrimSpace(filter.ProjectID)
	filter.RequestID = strings.TrimSpace(filter.RequestID)
	if filter.ProjectID == "" {
		return RequestDetailFilter{}, fmt.Errorf("%w: project id is required", ErrInvalidLogQuery)
	}
	if filter.RequestID == "" {
		return RequestDetailFilter{}, fmt.Errorf("%w: request id is required", ErrInvalidLogQuery)
	}
	return filter, nil
}

func NormalizeDashboardOverviewFilter(filter DashboardOverviewFilter) (DashboardOverviewFilter, error) {
	filter.TenantID = strings.TrimSpace(filter.TenantID)
	filter.ProjectID = strings.TrimSpace(filter.ProjectID)
	if filter.TenantID == "" && filter.ProjectID == "" {
		return DashboardOverviewFilter{}, fmt.Errorf("%w: tenant id or project id is required", ErrInvalidLogQuery)
	}
	if err := validateTimeRange(filter.From, filter.To); err != nil {
		return DashboardOverviewFilter{}, err
	}
	return filter, nil
}

func ToRequestLogListItem(log LlmInvocationLog) RequestLogListItem {
	return RequestLogListItem{
		RequestID:        log.RequestID,
		ProjectID:        log.ProjectID,
		ApplicationID:    log.ApplicationID,
		Provider:         log.Provider,
		Model:            log.Model,
		RequestedModel:   log.RequestedModel,
		SelectedModel:    log.SelectedModel,
		Status:           log.Status,
		HTTPStatus:       log.HTTPStatus,
		PromptTokens:     log.PromptTokens,
		CompletionTokens: log.CompletionTokens,
		TotalTokens:      log.TotalTokens,
		CostUSD:          FormatCostUSDFromMicroUSD(log.CostMicroUSD),
		CostMicroUSD:     log.CostMicroUSD,
		LatencyMs:        log.LatencyMs,
		CacheStatus:      defaultString(log.CacheStatus, CacheStatusBypass),
		CacheType:        defaultString(log.CacheType, CacheTypeNone),
		RoutingReason:    log.RoutingReason,
		MaskingAction:    defaultString(log.MaskingAction, "none"),
		CreatedAt:        log.CreatedAt,
	}
}

func ToRequestDetail(log LlmInvocationLog) RequestDetail {
	return RequestDetail{
		RequestID:      log.RequestID,
		TraceID:        log.TraceID,
		TenantID:       log.TenantID,
		ProjectID:      log.ProjectID,
		ApplicationID:  log.ApplicationID,
		Status:         log.Status,
		HTTPStatus:     log.HTTPStatus,
		Provider:       log.Provider,
		Model:          log.Model,
		RequestedModel: log.RequestedModel,
		SelectedModel:  log.SelectedModel,
		Usage: UsageFields{
			PromptTokens:     log.PromptTokens,
			CompletionTokens: log.CompletionTokens,
			TotalTokens:      log.TotalTokens,
		},
		Cost: CostFields{
			CostUSD:      FormatCostUSDFromMicroUSD(log.CostMicroUSD),
			CostMicroUSD: log.CostMicroUSD,
			Currency:     CurrencyUSD,
		},
		Latency: LatencyFields{
			LatencyMs:         log.LatencyMs,
			ProviderLatencyMs: log.ProviderLatencyMs,
		},
		Cache: CacheFields{
			CacheStatus:       defaultString(log.CacheStatus, CacheStatusBypass),
			CacheType:         defaultString(log.CacheType, CacheTypeNone),
			CacheKeyHash:      log.CacheKeyHash,
			CacheHitRequestID: log.CacheHitRequestID,
		},
		Routing: RoutingFields{
			RoutingReason:    log.RoutingReason,
			RoutingRuleID:    log.RoutingRuleID,
			SelectedProvider: log.SelectedProvider,
			SelectedModel:    log.SelectedModel,
		},
		Masking: MaskingFields{
			MaskingAction:         defaultString(log.MaskingAction, "none"),
			MaskingDetectedTypes:  append([]string(nil), log.MaskingDetectedTypes...),
			MaskingDetectedCount:  log.MaskingDetectedCount,
			RedactedPromptPreview: log.RedactedPromptPreview,
		},
		Error: ErrorFields{
			ErrorCode:    log.ErrorCode,
			ErrorMessage: log.ErrorMessage,
			ErrorStage:   log.ErrorStage,
		},
		CreatedAt:   log.CreatedAt,
		CompletedAt: log.CompletedAt,
	}
}

func BuildDashboardOverview(logs []LlmInvocationLog) DashboardOverviewFields {
	var totalLatency int64
	overview := DashboardOverviewFields{}
	for _, log := range logs {
		overview.TotalRequests++
		if isSuccessfulStatus(log.Status) {
			overview.SuccessfulRequests++
		}
		if log.Status == StatusBlocked {
			overview.BlockedRequests++
		}
		if log.Status == StatusCacheHit || log.CacheStatus == CacheStatusHit {
			overview.CacheHitRequests++
		}
		overview.TotalTokens += log.TotalTokens
		overview.TotalCostMicroUSD += log.CostMicroUSD
		totalLatency += log.LatencyMs
	}

	overview.TotalCostUSD = FormatCostUSDFromMicroUSD(overview.TotalCostMicroUSD)
	if overview.TotalRequests > 0 {
		cacheHitRate := float64(overview.CacheHitRequests) / float64(overview.TotalRequests)
		averageLatency := float64(totalLatency) / float64(overview.TotalRequests)
		overview.CacheHitRate = &cacheHitRate
		overview.AverageResponseTimeMs = &averageLatency
	}

	return overview
}

func BuildDashboardOverviewFromAggregate(totalRequests int64, successfulRequests int64, blockedRequests int64, cacheHitRequests int64, totalTokens int64, totalCostMicroUSD int64, averageResponseTimeMs *float64) DashboardOverviewFields {
	overview := DashboardOverviewFields{
		TotalRequests:         totalRequests,
		SuccessfulRequests:    successfulRequests,
		BlockedRequests:       blockedRequests,
		CacheHitRequests:      cacheHitRequests,
		TotalTokens:           totalTokens,
		TotalCostMicroUSD:     totalCostMicroUSD,
		TotalCostUSD:          FormatCostUSDFromMicroUSD(totalCostMicroUSD),
		AverageResponseTimeMs: averageResponseTimeMs,
	}
	if totalRequests > 0 {
		cacheHitRate := float64(cacheHitRequests) / float64(totalRequests)
		overview.CacheHitRate = &cacheHitRate
	}
	return overview
}

func FormatCostUSDFromMicroUSD(costMicroUSD int64) string {
	sign := ""
	if costMicroUSD < 0 {
		sign = "-"
		costMicroUSD = -costMicroUSD
	}
	wholeUSD := costMicroUSD / 1_000_000
	fractionalUSD := costMicroUSD % 1_000_000
	return fmt.Sprintf("%s%d.%06d", sign, wholeUSD, fractionalUSD)
}

func validateTimeRange(from time.Time, to time.Time) error {
	if from.IsZero() || to.IsZero() {
		return fmt.Errorf("%w: from and to are required", ErrInvalidLogQuery)
	}
	if !to.After(from) {
		return fmt.Errorf("%w: to must be after from", ErrInvalidLogQuery)
	}
	return nil
}

func isSuccessfulStatus(status string) bool {
	return status == StatusSuccess || status == StatusCacheHit
}

func defaultString(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
