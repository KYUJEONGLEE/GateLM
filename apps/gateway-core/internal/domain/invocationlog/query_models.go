package invocationlog

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
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
	TenantID      string
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
	TenantID  string
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

type RoutingCountByModel struct {
	SelectedProvider string
	SelectedModel    string
	RoutingReason    string
	RequestCount     int64
}

type CostByModel struct {
	SelectedProvider string
	SelectedModel    string
	RequestCount     int64
	TotalTokens      int64
	CostMicroUSD     int64
	CostUSD          string
}

type DashboardDataFreshness struct {
	Source           string
	RecordCount      int64
	LastLogCreatedAt *time.Time
	GeneratedAt      time.Time
}

type DashboardOverviewFields struct {
	TotalRequests         int64
	SuccessfulRequests    int64
	FailedRequests        int64
	BlockedRequests       int64
	RateLimitedRequests   int64
	CacheHitRequests      int64
	CacheEligibleRequests int64
	CacheHitRate          *float64
	PromptTokens          int64
	CompletionTokens      int64
	TotalTokens           int64
	TotalCostMicroUSD     int64
	TotalCostUSD          string
	SavedCostMicroUSD     int64
	SavedCostUSD          string
	AverageLatencyMs      *float64
	P95LatencyMs          *float64
	AverageResponseTimeMs *float64
	MaskingActionCounts   map[string]int64
	RoutingCountByModel   []RoutingCountByModel
	StatusCounts          map[string]int64
	CostByModel           []CostByModel
	DataFreshness         DashboardDataFreshness
}

type DashboardOverviewAggregate struct {
	TotalRequests         int64
	SuccessfulRequests    int64
	FailedRequests        int64
	BlockedRequests       int64
	RateLimitedRequests   int64
	CacheHitRequests      int64
	CacheEligibleRequests int64
	PromptTokens          int64
	CompletionTokens      int64
	TotalTokens           int64
	TotalCostMicroUSD     int64
	SavedCostMicroUSD     int64
	AverageLatencyMs      *float64
	P95LatencyMs          *float64
	MaskingActionCounts   map[string]int64
	RoutingCountByModel   []RoutingCountByModel
	StatusCounts          map[string]int64
	CostByModel           []CostByModel
	LastLogCreatedAt      *time.Time
	GeneratedAt           time.Time
}

type dashboardModelKey struct {
	provider string
	model    string
	reason   string
}

func NormalizeProjectLogsFilter(filter ProjectLogsFilter) (ProjectLogsFilter, error) {
	filter.TenantID = strings.TrimSpace(filter.TenantID)
	filter.ProjectID = strings.TrimSpace(filter.ProjectID)
	filter.Status = strings.TrimSpace(filter.Status)
	filter.Provider = strings.TrimSpace(filter.Provider)
	filter.Model = strings.TrimSpace(filter.Model)
	filter.CacheStatus = strings.TrimSpace(filter.CacheStatus)
	filter.ApplicationID = strings.TrimSpace(filter.ApplicationID)
	filter.RequestID = strings.TrimSpace(filter.RequestID)

	if filter.TenantID == "" {
		return ProjectLogsFilter{}, fmt.Errorf("%w: tenant id is required", ErrInvalidLogQuery)
	}
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
	filter.TenantID = strings.TrimSpace(filter.TenantID)
	filter.ProjectID = strings.TrimSpace(filter.ProjectID)
	filter.RequestID = strings.TrimSpace(filter.RequestID)
	if filter.TenantID == "" {
		return RequestDetailFilter{}, fmt.Errorf("%w: tenant id is required", ErrInvalidLogQuery)
	}
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
	if filter.TenantID == "" {
		return DashboardOverviewFilter{}, fmt.Errorf("%w: tenant id is required", ErrInvalidLogQuery)
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
	var latencies []int64
	var maxCreatedAt time.Time
	aggregate := DashboardOverviewAggregate{
		StatusCounts:        defaultStatusCounts(),
		MaskingActionCounts: defaultMaskingActionCounts(),
	}
	routingCounts := map[dashboardModelKey]int64{}
	costCounts := map[dashboardModelKey]CostByModel{}

	for _, log := range logs {
		aggregate.TotalRequests++
		incrementCount(aggregate.StatusCounts, log.Status)
		incrementCount(aggregate.MaskingActionCounts, defaultString(log.MaskingAction, "none"))
		if isSuccessfulStatus(log.Status) {
			aggregate.SuccessfulRequests++
		}
		if log.Status == StatusError {
			aggregate.FailedRequests++
		}
		if log.Status == StatusBlocked {
			aggregate.BlockedRequests++
		}
		if log.Status == StatusRateLimited {
			aggregate.RateLimitedRequests++
		}
		if isCacheEligible(log.CacheStatus) {
			aggregate.CacheEligibleRequests++
		}
		if isExactCacheHit(log.CacheStatus, log.CacheType) {
			aggregate.CacheHitRequests++
		}
		aggregate.PromptTokens += log.PromptTokens
		aggregate.CompletionTokens += log.CompletionTokens
		aggregate.TotalTokens += log.TotalTokens
		aggregate.TotalCostMicroUSD += log.CostMicroUSD
		aggregate.SavedCostMicroUSD += log.SavedCostMicroUSD
		if isLatencyEligibleStatus(log.Status) {
			latencies = append(latencies, log.LatencyMs)
		}
		if !log.CreatedAt.IsZero() && log.CreatedAt.After(maxCreatedAt) {
			maxCreatedAt = log.CreatedAt
		}

		selectedProvider := firstNonEmptyString(log.SelectedProvider, log.Provider)
		selectedModel := firstNonEmptyString(log.SelectedModel, log.Model)
		if selectedProvider != "" && selectedModel != "" {
			routingKey := dashboardModelKey{provider: selectedProvider, model: selectedModel, reason: log.RoutingReason}
			routingCounts[routingKey]++
			costKey := dashboardModelKey{provider: selectedProvider, model: selectedModel}
			cost := costCounts[costKey]
			cost.SelectedProvider = selectedProvider
			cost.SelectedModel = selectedModel
			cost.RequestCount++
			cost.TotalTokens += log.TotalTokens
			cost.CostMicroUSD += log.CostMicroUSD
			costCounts[costKey] = cost
		}
	}

	if len(latencies) > 0 {
		averageLatency := averageInt64(latencies)
		p95Latency := percentileDiscInt64(latencies, 0.95)
		aggregate.AverageLatencyMs = &averageLatency
		aggregate.P95LatencyMs = &p95Latency
	}
	if !maxCreatedAt.IsZero() {
		aggregate.LastLogCreatedAt = &maxCreatedAt
	}
	aggregate.RoutingCountByModel = routingCountsFromMap(routingCounts)
	aggregate.CostByModel = costCountsFromMap(costCounts)

	return BuildDashboardOverviewFromAggregate(aggregate)
}

func BuildDashboardOverviewFromAggregate(aggregate DashboardOverviewAggregate) DashboardOverviewFields {
	overview := DashboardOverviewFields{
		TotalRequests:         aggregate.TotalRequests,
		SuccessfulRequests:    aggregate.SuccessfulRequests,
		FailedRequests:        aggregate.FailedRequests,
		BlockedRequests:       aggregate.BlockedRequests,
		RateLimitedRequests:   aggregate.RateLimitedRequests,
		CacheHitRequests:      aggregate.CacheHitRequests,
		CacheEligibleRequests: aggregate.CacheEligibleRequests,
		PromptTokens:          aggregate.PromptTokens,
		CompletionTokens:      aggregate.CompletionTokens,
		TotalTokens:           aggregate.TotalTokens,
		TotalCostMicroUSD:     aggregate.TotalCostMicroUSD,
		TotalCostUSD:          FormatCostUSDFromMicroUSD(aggregate.TotalCostMicroUSD),
		SavedCostMicroUSD:     aggregate.SavedCostMicroUSD,
		SavedCostUSD:          FormatCostUSDFromMicroUSD(aggregate.SavedCostMicroUSD),
		AverageLatencyMs:      aggregate.AverageLatencyMs,
		P95LatencyMs:          aggregate.P95LatencyMs,
		AverageResponseTimeMs: aggregate.AverageLatencyMs,
		MaskingActionCounts:   mergeDefaultCounts(defaultMaskingActionCounts(), aggregate.MaskingActionCounts),
		RoutingCountByModel:   append([]RoutingCountByModel(nil), aggregate.RoutingCountByModel...),
		StatusCounts:          mergeDefaultCounts(defaultStatusCounts(), aggregate.StatusCounts),
		CostByModel:           normalizedCostByModel(aggregate.CostByModel),
		DataFreshness: DashboardDataFreshness{
			Source:           "postgresql_request_log",
			RecordCount:      aggregate.TotalRequests,
			LastLogCreatedAt: aggregate.LastLogCreatedAt,
			GeneratedAt:      generatedAtOrNow(aggregate.GeneratedAt),
		},
	}
	cacheHitRate := 0.0
	if aggregate.CacheEligibleRequests > 0 {
		cacheHitRate = float64(aggregate.CacheHitRequests) / float64(aggregate.CacheEligibleRequests)
	}
	overview.CacheHitRate = &cacheHitRate
	return overview
}

func FormatCostUSDFromMicroUSD(costMicroUSD int64) string {
	wholeUSD := costMicroUSD / 1_000_000
	fractionalUSD := costMicroUSD % 1_000_000
	if wholeUSD < 0 || fractionalUSD < 0 {
		if wholeUSD < 0 {
			wholeUSD = -wholeUSD
		}
		if fractionalUSD < 0 {
			fractionalUSD = -fractionalUSD
		}
		return fmt.Sprintf("-%d.%06d", wholeUSD, fractionalUSD)
	}
	return fmt.Sprintf("%d.%06d", wholeUSD, fractionalUSD)
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

func isLatencyEligibleStatus(status string) bool {
	return status == StatusSuccess || status == StatusCacheHit || status == StatusError
}

func isCacheEligible(cacheStatus string) bool {
	return defaultString(cacheStatus, CacheStatusBypass) != CacheStatusBypass
}

func isExactCacheHit(cacheStatus string, cacheType string) bool {
	return defaultString(cacheStatus, CacheStatusBypass) == CacheStatusHit &&
		defaultString(cacheType, CacheTypeNone) == CacheTypeExact
}

func defaultString(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func incrementCount(counts map[string]int64, key string) {
	key = strings.TrimSpace(key)
	if key == "" {
		key = "none"
	}
	counts[key]++
}

func defaultStatusCounts() map[string]int64 {
	return map[string]int64{
		StatusSuccess:     0,
		StatusCacheHit:    0,
		StatusBlocked:     0,
		StatusRateLimited: 0,
		StatusError:       0,
		StatusCancelled:   0,
	}
}

func defaultMaskingActionCounts() map[string]int64 {
	return map[string]int64{
		"none":     0,
		"redacted": 0,
		"blocked":  0,
	}
}

func mergeDefaultCounts(defaults map[string]int64, values map[string]int64) map[string]int64 {
	merged := make(map[string]int64, len(defaults)+len(values))
	for key, value := range defaults {
		merged[key] = value
	}
	for key, value := range values {
		key = strings.TrimSpace(key)
		if key == "" {
			key = "none"
		}
		merged[key] += value
	}
	return merged
}

func averageInt64(values []int64) float64 {
	var total int64
	for _, value := range values {
		total += value
	}
	return float64(total) / float64(len(values))
}

func percentileDiscInt64(values []int64, percentile float64) float64 {
	if len(values) == 0 {
		return 0
	}
	ordered := append([]int64(nil), values...)
	sort.Slice(ordered, func(i int, j int) bool { return ordered[i] < ordered[j] })
	rank := int(math.Ceil(percentile*float64(len(ordered)))) - 1
	if rank < 0 {
		rank = 0
	}
	if rank >= len(ordered) {
		rank = len(ordered) - 1
	}
	return float64(ordered[rank])
}

func routingCountsFromMap(counts map[dashboardModelKey]int64) []RoutingCountByModel {
	items := make([]RoutingCountByModel, 0, len(counts))
	for key, count := range counts {
		items = append(items, RoutingCountByModel{
			SelectedProvider: key.provider,
			SelectedModel:    key.model,
			RoutingReason:    key.reason,
			RequestCount:     count,
		})
	}
	sort.Slice(items, func(i int, j int) bool {
		if items[i].RequestCount != items[j].RequestCount {
			return items[i].RequestCount > items[j].RequestCount
		}
		if items[i].SelectedProvider != items[j].SelectedProvider {
			return items[i].SelectedProvider < items[j].SelectedProvider
		}
		if items[i].SelectedModel != items[j].SelectedModel {
			return items[i].SelectedModel < items[j].SelectedModel
		}
		return items[i].RoutingReason < items[j].RoutingReason
	})
	return items
}

func costCountsFromMap(counts map[dashboardModelKey]CostByModel) []CostByModel {
	items := make([]CostByModel, 0, len(counts))
	for _, item := range counts {
		items = append(items, item)
	}
	return normalizedCostByModel(items)
}

func normalizedCostByModel(items []CostByModel) []CostByModel {
	normalized := append([]CostByModel(nil), items...)
	for index := range normalized {
		normalized[index].CostUSD = FormatCostUSDFromMicroUSD(normalized[index].CostMicroUSD)
	}
	sort.Slice(normalized, func(i int, j int) bool {
		if normalized[i].CostMicroUSD != normalized[j].CostMicroUSD {
			return normalized[i].CostMicroUSD > normalized[j].CostMicroUSD
		}
		if normalized[i].SelectedProvider != normalized[j].SelectedProvider {
			return normalized[i].SelectedProvider < normalized[j].SelectedProvider
		}
		return normalized[i].SelectedModel < normalized[j].SelectedModel
	})
	return normalized
}

func generatedAtOrNow(generatedAt time.Time) time.Time {
	if generatedAt.IsZero() {
		return time.Now().UTC()
	}
	return generatedAt.UTC()
}
