package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	postgresinvocationlog "gatelm/apps/gateway-core/internal/adapters/invocationlog/postgres"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"

	"github.com/jackc/pgx/v5/pgxpool"
)

type benchmarkQueryer struct {
	pool *pgxpool.Pool
}

func (q benchmarkQueryer) Query(
	ctx context.Context,
	query string,
	arguments ...any,
) (postgresinvocationlog.Rows, error) {
	rows, err := q.pool.Query(ctx, query, arguments...)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

func (q benchmarkQueryer) QueryRow(
	ctx context.Context,
	query string,
	arguments ...any,
) postgresinvocationlog.Row {
	return q.pool.QueryRow(ctx, query, arguments...)
}

type comparablePolicyImpact struct {
	Totals         invocationlog.AnalyticsPolicyImpactTotals
	SurfaceTotals  []invocationlog.AnalyticsPolicyImpactSurfaceTotal
	PolicyOutcomes []invocationlog.AnalyticsPolicyImpactOutcome
	RoutingRoles   []invocationlog.AnalyticsPolicyImpactRoutingRole
	ModelBuckets   []invocationlog.AnalyticsPolicyImpactModelBucket
	UsageSources   []invocationlog.AnalyticsPolicyImpactUsageSource
	MetricCoverage []invocationlog.AnalyticsMetricCoverage
}

type benchmarkResult struct {
	Samples              int     `json:"samples"`
	RawP50Ms             float64 `json:"rawP50Ms"`
	RawP95Ms             float64 `json:"rawP95Ms"`
	RawMaxMs             float64 `json:"rawMaxMs"`
	RollupP50Ms          float64 `json:"rollupP50Ms"`
	RollupP95Ms          float64 `json:"rollupP95Ms"`
	RollupMaxMs          float64 `json:"rollupMaxMs"`
	P95ImprovementFactor float64 `json:"p95ImprovementFactor"`
	RequestCount         int64   `json:"requestCount"`
	Parity               bool    `json:"parity"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "policy impact benchmark failed: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	databaseURL, err := databaseURLForPGX(requiredEnv("DATABASE_URL"))
	if err != nil {
		return err
	}
	tenantID := requiredEnv("ROLLUP_BENCHMARK_TENANT_ID")
	projectID := requiredEnv("ROLLUP_BENCHMARK_PROJECT_ID")
	from, err := time.Parse(time.RFC3339Nano, requiredEnv("ROLLUP_BENCHMARK_FROM_UTC"))
	if err != nil {
		return fmt.Errorf("parse benchmark start: %w", err)
	}
	to, err := time.Parse(time.RFC3339Nano, requiredEnv("ROLLUP_BENCHMARK_TO_UTC"))
	if err != nil {
		return fmt.Errorf("parse benchmark end: %w", err)
	}
	samples := 5
	if raw := strings.TrimSpace(os.Getenv("ROLLUP_BENCHMARK_SAMPLES")); raw != "" {
		value, parseErr := strconv.Atoi(raw)
		if parseErr != nil || value < 1 || value > 20 {
			return errors.New("ROLLUP_BENCHMARK_SAMPLES must be between 1 and 20")
		}
		samples = value
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("connect PostgreSQL: %w", err)
	}
	defer pool.Close()

	queryer := benchmarkQueryer{pool: pool}
	rawReader := postgresinvocationlog.NewQueryReader(queryer)
	rollupReader := postgresinvocationlog.NewQueryReaderWithOptions(
		queryer,
		postgresinvocationlog.QueryReaderOptions{
			AnalyticsPolicyImpactReadMode:   "rollup",
			AnalyticsPolicyImpactMaxRawTail: 2 * time.Minute,
		},
	)
	filter := invocationlog.AnalyticsPolicyImpactFilter{
		TenantID:  tenantID,
		ProjectID: projectID,
		Period:    "hour",
		From:      from,
		To:        to,
	}

	rawWarm, err := rawReader.GetAnalyticsPolicyImpact(ctx, filter)
	if err != nil {
		return fmt.Errorf("warm raw policy impact: %w", err)
	}
	rollupWarm, err := rollupReader.GetAnalyticsPolicyImpact(ctx, filter)
	if err != nil {
		return fmt.Errorf("warm rollup policy impact: %w", err)
	}
	if !reflect.DeepEqual(comparable(rawWarm), comparable(rollupWarm)) {
		return comparisonError("warmup", rawWarm, rollupWarm)
	}

	rawDurations := make([]time.Duration, 0, samples)
	rollupDurations := make([]time.Duration, 0, samples)
	var rawResult invocationlog.AnalyticsPolicyImpactFields
	var rollupResult invocationlog.AnalyticsPolicyImpactFields
	for index := 0; index < samples; index++ {
		startedAt := time.Now()
		rawResult, err = rawReader.GetAnalyticsPolicyImpact(ctx, filter)
		if err != nil {
			return fmt.Errorf("raw policy impact sample %d: %w", index+1, err)
		}
		rawDurations = append(rawDurations, time.Since(startedAt))

		startedAt = time.Now()
		rollupResult, err = rollupReader.GetAnalyticsPolicyImpact(ctx, filter)
		if err != nil {
			return fmt.Errorf("rollup policy impact sample %d: %w", index+1, err)
		}
		rollupDurations = append(rollupDurations, time.Since(startedAt))
	}
	parity := reflect.DeepEqual(comparable(rawResult), comparable(rollupResult))
	if !parity {
		return comparisonError("samples", rawResult, rollupResult)
	}

	rawP95 := percentile(rawDurations, 0.95)
	rollupP95 := percentile(rollupDurations, 0.95)
	improvement := 0.0
	if rollupP95 > 0 {
		improvement = float64(rawP95) / float64(rollupP95)
	}
	result := benchmarkResult{
		Samples:              samples,
		RawP50Ms:             milliseconds(percentile(rawDurations, 0.50)),
		RawP95Ms:             milliseconds(rawP95),
		RawMaxMs:             milliseconds(maximum(rawDurations)),
		RollupP50Ms:          milliseconds(percentile(rollupDurations, 0.50)),
		RollupP95Ms:          milliseconds(rollupP95),
		RollupMaxMs:          milliseconds(maximum(rollupDurations)),
		P95ImprovementFactor: round(improvement),
		RequestCount:         rollupResult.Totals.RequestCount,
		Parity:               parity,
	}
	payload, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("marshal result: %w", err)
	}
	fmt.Println(string(payload))
	return nil
}

func comparisonError(
	phase string,
	raw invocationlog.AnalyticsPolicyImpactFields,
	rollup invocationlog.AnalyticsPolicyImpactFields,
) error {
	payload, err := json.Marshal(struct {
		Raw    comparablePolicyImpact `json:"raw"`
		Rollup comparablePolicyImpact `json:"rollup"`
	}{Raw: comparable(raw), Rollup: comparable(rollup)})
	if err != nil {
		return fmt.Errorf("raw and rollup policy impact differ during %s", phase)
	}
	return fmt.Errorf(
		"raw and rollup policy impact differ during %s: %s",
		phase,
		payload,
	)
}

func databaseURLForPGX(value string) (string, error) {
	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	query := parsed.Query()
	query.Del("schema")
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func comparable(value invocationlog.AnalyticsPolicyImpactFields) comparablePolicyImpact {
	return comparablePolicyImpact{
		Totals:         value.Totals,
		SurfaceTotals:  value.SurfaceTotals,
		PolicyOutcomes: value.PolicyOutcomes,
		RoutingRoles:   value.RoutingRoles,
		ModelBuckets:   value.ModelBuckets,
		UsageSources:   value.UsageSources,
		MetricCoverage: value.MetricCoverage,
	}
}

func percentile(values []time.Duration, percentile float64) time.Duration {
	sorted := append([]time.Duration(nil), values...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	index := int(float64(len(sorted))*percentile+0.999999999) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}

func maximum(values []time.Duration) time.Duration {
	var result time.Duration
	for _, value := range values {
		if value > result {
			result = value
		}
	}
	return result
}

func milliseconds(value time.Duration) float64 {
	return round(float64(value) / float64(time.Millisecond))
}

func round(value float64) float64 {
	return float64(int64(value*1000+0.5)) / 1000
}

func requiredEnv(key string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		panic(key + " is required")
	}
	return value
}
