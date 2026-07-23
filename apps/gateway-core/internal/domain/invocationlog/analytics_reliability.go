package invocationlog

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	AnalyticsReliabilitySurfaceAll                = "all"
	AnalyticsReliabilitySurfaceProjectApplication = AnalyticsSurfaceProjectApplication
	AnalyticsReliabilitySurfaceTenantChat         = AnalyticsSurfaceTenantChat

	AnalyticsReliabilityStatusOK          = "ok"
	AnalyticsReliabilityStatusPartial     = "partial"
	AnalyticsReliabilityStatusUnavailable = "unavailable"

	AnalyticsReliabilityQueryModeRaw         = "raw"
	AnalyticsReliabilityQueryModeRollup      = "rollup"
	AnalyticsReliabilityQueryModeUnavailable = "unavailable"
)

var (
	ErrReliabilityScopeInvalid    = errors.New("reliability scope is invalid")
	ErrReliabilityRangeTooBroad   = errors.New("reliability range is too broad")
	ErrReliabilityDataUnavailable = errors.New("reliability data is unavailable")
)

type AnalyticsReliabilityFilter struct {
	TenantID      string
	ProjectID     string
	Surface       string
	From          time.Time
	To            time.Time
	IncidentLimit int
}

type AnalyticsReliabilityScope struct {
	TenantID  string    `json:"tenantId"`
	Surface   string    `json:"surface"`
	ProjectID *string   `json:"projectId"`
	From      time.Time `json:"from"`
	To        time.Time `json:"to"`
}

type AnalyticsReliabilitySourceFreshness struct {
	Surface          string     `json:"surface"`
	QueryMode        string     `json:"queryMode"`
	QueryStatus      string     `json:"queryStatus"`
	LastEventAt      *time.Time `json:"lastEventAt"`
	LastAggregatedAt *time.Time `json:"lastAggregatedAt"`
}

type AnalyticsReliabilityFreshness struct {
	QueryStatus string                                `json:"queryStatus"`
	Complete    bool                                  `json:"complete"`
	Sources     []AnalyticsReliabilitySourceFreshness `json:"sources"`
}

type AnalyticsReliabilityTotals struct {
	RequestCount         int64 `json:"requestCount"`
	SuccessCount         int64 `json:"successCount"`
	FailedCount          int64 `json:"failedCount"`
	BlockedCount         int64 `json:"blockedCount"`
	RateLimitedCount     int64 `json:"rateLimitedCount"`
	CancelledCount       int64 `json:"cancelledCount"`
	UnknownCount         int64 `json:"unknownCount"`
	FallbackRequestCount int64 `json:"fallbackRequestCount"`
	FallbackSuccessCount int64 `json:"fallbackSuccessCount"`
}

type AnalyticsReliabilityRates struct {
	SuccessRate          *float64 `json:"successRate"`
	SystemErrorRate      *float64 `json:"systemErrorRate"`
	FallbackRecoveryRate *float64 `json:"fallbackRecoveryRate"`
}

type AnalyticsReliabilityOutcome struct {
	Outcome      string `json:"outcome"`
	RequestCount int64  `json:"requestCount"`
}

type AnalyticsReliabilityContinuity struct {
	SuccessWithoutFallbackCount int64 `json:"successWithoutFallbackCount"`
	FallbackRecoveredCount      int64 `json:"fallbackRecoveredCount"`
	FailedCount                 int64 `json:"failedCount"`
	CancelledCount              int64 `json:"cancelledCount"`
	ExcludedPolicyCount         int64 `json:"excludedPolicyCount"`
	UnknownCount                int64 `json:"unknownCount"`
}

type AnalyticsReliabilitySurfaceTotals struct {
	Surface  string                      `json:"surface"`
	Included bool                        `json:"included"`
	Totals   *AnalyticsReliabilityTotals `json:"totals"`
}

type AnalyticsReliabilityIncident struct {
	Surface         string    `json:"surface"`
	RequestID       string    `json:"requestId"`
	OccurredAt      time.Time `json:"occurredAt"`
	ProjectID       *string   `json:"projectId"`
	Provider        *string   `json:"provider"`
	Model           *string   `json:"model"`
	CanonicalStatus string    `json:"canonicalStatus"`
	SourceOutcome   string    `json:"sourceOutcome"`
	FallbackOutcome string    `json:"fallbackOutcome"`
	HTTPStatus      *int      `json:"httpStatus"`
}

type AnalyticsReliabilityFields struct {
	Scope            AnalyticsReliabilityScope           `json:"scope"`
	GeneratedAt      time.Time                           `json:"generatedAt"`
	Freshness        AnalyticsReliabilityFreshness       `json:"freshness"`
	Totals           AnalyticsReliabilityTotals          `json:"totals"`
	Rates            AnalyticsReliabilityRates           `json:"rates"`
	TerminalOutcomes []AnalyticsReliabilityOutcome       `json:"terminalOutcomes"`
	Continuity       AnalyticsReliabilityContinuity      `json:"continuity"`
	SurfaceTotals    []AnalyticsReliabilitySurfaceTotals `json:"surfaceTotals"`
	RecentIncidents  []AnalyticsReliabilityIncident      `json:"recentIncidents"`
}

func NormalizeAnalyticsReliabilityFilter(filter AnalyticsReliabilityFilter) (AnalyticsReliabilityFilter, error) {
	filter.TenantID = strings.TrimSpace(filter.TenantID)
	filter.ProjectID = strings.TrimSpace(filter.ProjectID)
	filter.Surface = strings.ToLower(strings.TrimSpace(filter.Surface))
	if filter.Surface == "" {
		filter.Surface = AnalyticsReliabilitySurfaceAll
	}
	if filter.IncidentLimit == 0 {
		filter.IncidentLimit = 4
	}

	if filter.TenantID == "" {
		return AnalyticsReliabilityFilter{}, fmt.Errorf("%w: tenant id is required", ErrInvalidLogQuery)
	}
	if err := validateTimeRange(filter.From, filter.To); err != nil {
		return AnalyticsReliabilityFilter{}, err
	}
	if filter.To.Sub(filter.From) > 31*24*time.Hour {
		return AnalyticsReliabilityFilter{}, fmt.Errorf("%w: maximum range is 31 days", ErrReliabilityRangeTooBroad)
	}
	if filter.IncidentLimit < 1 || filter.IncidentLimit > 20 {
		return AnalyticsReliabilityFilter{}, fmt.Errorf("%w: incident limit must be between 1 and 20", ErrInvalidLogQuery)
	}

	switch filter.Surface {
	case AnalyticsReliabilitySurfaceAll, AnalyticsReliabilitySurfaceProjectApplication, AnalyticsReliabilitySurfaceTenantChat:
	default:
		return AnalyticsReliabilityFilter{}, fmt.Errorf("%w: surface must be all, project_application, or tenant_chat", ErrReliabilityScopeInvalid)
	}
	if filter.ProjectID != "" {
		if filter.Surface == AnalyticsReliabilitySurfaceTenantChat {
			return AnalyticsReliabilityFilter{}, fmt.Errorf("%w: tenant_chat cannot be combined with projectId", ErrReliabilityScopeInvalid)
		}
		filter.Surface = AnalyticsReliabilitySurfaceProjectApplication
	}
	return filter, nil
}

func AnalyticsReliabilityRequestedSurfaces(filter AnalyticsReliabilityFilter) []string {
	switch filter.Surface {
	case AnalyticsReliabilitySurfaceProjectApplication:
		return []string{AnalyticsReliabilitySurfaceProjectApplication}
	case AnalyticsReliabilitySurfaceTenantChat:
		return []string{AnalyticsReliabilitySurfaceTenantChat}
	default:
		return []string{AnalyticsReliabilitySurfaceProjectApplication, AnalyticsReliabilitySurfaceTenantChat}
	}
}
