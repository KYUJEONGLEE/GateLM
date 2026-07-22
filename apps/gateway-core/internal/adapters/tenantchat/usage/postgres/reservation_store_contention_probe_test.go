package postgres

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	quotaProbeEnabledEnv     = "GATELM_QUOTA_CONTENTION_PROBE"
	quotaProbeOutputDirEnv   = "GATELM_QUOTA_PROBE_OUTPUT_DIR"
	quotaProbeOperationsEnv  = "GATELM_QUOTA_PROBE_OPERATIONS"
	quotaProbeRepetitionsEnv = "GATELM_QUOTA_PROBE_REPETITIONS"
	quotaProbeConcurrencyEnv = "GATELM_QUOTA_PROBE_CONCURRENCIES"
	quotaProbeScenariosEnv   = "GATELM_QUOTA_PROBE_SCENARIOS"
	quotaProbeCommitEnv      = "GATELM_QUOTA_PROBE_COMMIT"

	quotaProbePoolSize        = int32(16)
	quotaProbeActorCount      = 16
	quotaProbeReservedTokens  = int64(200)
	quotaProbeConfirmedTokens = int64(150)
	quotaProbeReservedCost    = int64(125)
)

type quotaProbeActor struct {
	tenantID   string
	userID     string
	employeeID string
}

type quotaProbeFixture struct {
	actors    []quotaProbeActor
	tenantIDs []string
	userIDs   []string
}

type quotaProbeWorkItem struct {
	requestContext tenantchat.RequestContext
	snapshot       tenantruntime.Snapshot
}

type quotaProbeRunResult struct {
	Scenario                   string           `json:"scenario"`
	Concurrency                int              `json:"concurrency"`
	Repetition                 int              `json:"repetition"`
	Operations                 int              `json:"operations"`
	Successes                  int              `json:"successes"`
	Errors                     int              `json:"errors"`
	ThroughputOpsPerSecond     float64          `json:"throughputOpsPerSecond"`
	BeginP50Ms                 float64          `json:"beginP50Ms"`
	BeginP95Ms                 float64          `json:"beginP95Ms"`
	BeginP99Ms                 float64          `json:"beginP99Ms"`
	SettleP50Ms                float64          `json:"settleP50Ms"`
	SettleP95Ms                float64          `json:"settleP95Ms"`
	SettleP99Ms                float64          `json:"settleP99Ms"`
	PoolAcquireTotalMs         float64          `json:"poolAcquireTotalMs"`
	PoolEmptyAcquireCount      int64            `json:"poolEmptyAcquireCount"`
	AdvisorySamples            int64            `json:"advisorySamples"`
	AdvisoryWaitingSamples     int64            `json:"advisoryWaitingSamples"`
	AdvisoryWaitSampleRatio    float64          `json:"advisoryWaitSampleRatio"`
	AdvisoryPeakWaiters        int64            `json:"advisoryPeakWaiters"`
	NonAdvisoryWaitingSamples  int64            `json:"nonAdvisoryWaitingSamples"`
	NonAdvisoryWaitSampleRatio float64          `json:"nonAdvisoryWaitSampleRatio"`
	NonAdvisoryPeakWaiters     int64            `json:"nonAdvisoryPeakWaiters"`
	DBLockSamples              int64            `json:"dbLockSamples"`
	DBLockWaitingSamples       int64            `json:"dbLockWaitingSamples"`
	DBLockWaitSampleRatio      float64          `json:"dbLockWaitSampleRatio"`
	DBLockPeakWaiters          int64            `json:"dbLockPeakWaiters"`
	LockWaitEventSamples       map[string]int64 `json:"lockWaitEventSamples,omitempty"`
	SettledRows                int64            `json:"settledRows"`
	ReservedTokensRemaining    int64            `json:"reservedTokensRemaining"`
	ConfirmedTokens            int64            `json:"confirmedTokens"`
	SettlementLedgerRows       int64            `json:"settlementLedgerRows"`
	DistinctSettlementRows     int64            `json:"distinctSettlementRows"`
	CorrectnessViolation       bool             `json:"correctnessViolation"`
}

type quotaProbeCorrectnessResult struct {
	Name                    string `json:"name"`
	ExpectedAccepted        int    `json:"expectedAccepted,omitempty"`
	ActualAccepted          int    `json:"actualAccepted,omitempty"`
	ExpectedRejections      int    `json:"expectedRejections,omitempty"`
	ActualRejections        int    `json:"actualRejections,omitempty"`
	UnexpectedErrors        int    `json:"unexpectedErrors"`
	OvershootTokens         int64  `json:"overshootTokens,omitempty"`
	OvershootCostMicroUSD   int64  `json:"overshootCostMicroUsd,omitempty"`
	DuplicateSettlementRows int64  `json:"duplicateSettlementRows,omitempty"`
	ConfirmedTokens         int64  `json:"confirmedTokens,omitempty"`
	FallbackAllowed         bool   `json:"fallbackAllowed,omitempty"`
	ObservedError           string `json:"observedError,omitempty"`
	Violation               bool   `json:"violation"`
	Detail                  string `json:"detail"`
}

type quotaProbeMetadata struct {
	Commit             string   `json:"commit"`
	GoVersion          string   `json:"goVersion"`
	GOOS               string   `json:"goos"`
	CPUCount           int      `json:"cpuCount"`
	PostgresVersion    string   `json:"postgresVersion"`
	PoolSize           int32    `json:"poolSize"`
	Operations         int      `json:"operations"`
	Repetitions        int      `json:"repetitions"`
	Concurrencies      []int    `json:"concurrencies"`
	Scenarios          []string `json:"scenarios"`
	GeneratedAt        string   `json:"generatedAt"`
	AdvisorySampleRate string   `json:"advisorySampleRate"`
	LockSampleRate     string   `json:"lockSampleRate"`
}

type quotaProbeReport struct {
	Metadata    quotaProbeMetadata            `json:"metadata"`
	Runs        []quotaProbeRunResult         `json:"runs"`
	Correctness []quotaProbeCorrectnessResult `json:"correctness"`
	Decision    string                        `json:"decision"`
	Reasons     []string                      `json:"reasons"`
}

type quotaProbeLockSamples struct {
	samples                   atomic.Int64
	advisoryWaitingSamples    atomic.Int64
	advisoryPeakWaiters       atomic.Int64
	nonAdvisoryWaitingSamples atomic.Int64
	nonAdvisoryPeakWaiters    atomic.Int64
	totalWaitingSamples       atomic.Int64
	totalPeakWaiters          atomic.Int64
	waitEventMu               sync.Mutex
	waitEventSamples          map[string]int64
}

func TestDecideQuotaProbe(t *testing.T) {
	performanceRuns := make([]quotaProbeRunResult, 0, 6)
	for repetition := 1; repetition <= 3; repetition++ {
		performanceRuns = append(performanceRuns,
			quotaProbeRunResult{
				Scenario: "B", Concurrency: 8, Repetition: repetition,
				BeginP95Ms: 13, SettleP95Ms: 12, ThroughputOpsPerSecond: 70,
				DBLockSamples: 10, DBLockWaitSampleRatio: 0.5, DBLockPeakWaiters: 4,
			},
			quotaProbeRunResult{
				Scenario: "C", Concurrency: 8, Repetition: repetition,
				BeginP95Ms: 10, SettleP95Ms: 8, ThroughputOpsPerSecond: 100, DBLockSamples: 10,
			},
		)
	}

	t.Run("combines correctness and performance evidence", func(t *testing.T) {
		decision, reasons := decideQuotaProbe(performanceRuns, []quotaProbeCorrectnessResult{{
			Name: "fallback", Violation: true, Detail: "allowed=true",
		}})
		if decision != "GO_CORRECTNESS_AND_PERFORMANCE" || len(reasons) != 2 {
			t.Fatalf("unexpected combined decision: decision=%s reasons=%v", decision, reasons)
		}
	})

	t.Run("returns no-go without threshold evidence", func(t *testing.T) {
		decision, reasons := decideQuotaProbe([]quotaProbeRunResult{
			{Scenario: "B", Concurrency: 8, Repetition: 1, BeginP95Ms: 10, SettleP95Ms: 10, ThroughputOpsPerSecond: 98},
			{Scenario: "C", Concurrency: 8, Repetition: 1, BeginP95Ms: 10, SettleP95Ms: 10, ThroughputOpsPerSecond: 100},
		}, nil)
		if decision != "NO_GO" || len(reasons) != 1 {
			t.Fatalf("unexpected no-go decision: decision=%s reasons=%v", decision, reasons)
		}
	})

	t.Run("uses non-advisory lock evidence after advisory contention is removed", func(t *testing.T) {
		runs := make([]quotaProbeRunResult, 0, 6)
		for repetition := 1; repetition <= 3; repetition++ {
			runs = append(runs,
				quotaProbeRunResult{
					Scenario: "B", Concurrency: 8, Repetition: repetition,
					BeginP95Ms: 14, ThroughputOpsPerSecond: 70,
					DBLockSamples: 10, DBLockWaitSampleRatio: 0.6, DBLockPeakWaiters: 5,
				},
				quotaProbeRunResult{
					Scenario: "C", Concurrency: 8, Repetition: repetition,
					BeginP95Ms: 10, ThroughputOpsPerSecond: 100,
					DBLockSamples: 10,
				},
			)
		}
		decision, reasons := decideQuotaProbe(runs, nil)
		if decision != "GO_PERFORMANCE" || len(reasons) != 1 {
			t.Fatalf("unexpected row-lock decision: decision=%s reasons=%v", decision, reasons)
		}
	})

	t.Run("keeps legacy advisory-only report compatibility", func(t *testing.T) {
		runs := make([]quotaProbeRunResult, 0, 6)
		for repetition := 1; repetition <= 3; repetition++ {
			runs = append(runs,
				quotaProbeRunResult{
					Scenario: "B", Concurrency: 8, Repetition: repetition,
					BeginP95Ms: 14, ThroughputOpsPerSecond: 70,
					AdvisoryWaitSampleRatio: 0.6, AdvisoryPeakWaiters: 5,
				},
				quotaProbeRunResult{
					Scenario: "C", Concurrency: 8, Repetition: repetition,
					BeginP95Ms: 10, ThroughputOpsPerSecond: 100,
				},
			)
		}
		decision, _ := decideQuotaProbe(runs, nil)
		if decision != "GO_PERFORMANCE" {
			t.Fatalf("legacy advisory-only decision = %s", decision)
		}
	})
}

func TestParseQuotaProbeScenarios(t *testing.T) {
	t.Run("defaults to all scenarios", func(t *testing.T) {
		actual, err := parseQuotaProbeScenarios("")
		if err != nil || strings.Join(actual, ",") != "A,B,C" {
			t.Fatalf("scenarios=%v err=%v", actual, err)
		}
	})

	t.Run("deduplicates while retaining requested order", func(t *testing.T) {
		actual, err := parseQuotaProbeScenarios(" C, B,C ")
		if err != nil || strings.Join(actual, ",") != "C,B" {
			t.Fatalf("scenarios=%v err=%v", actual, err)
		}
	})

	t.Run("rejects an unknown scenario", func(t *testing.T) {
		if _, err := parseQuotaProbeScenarios("B,D"); err == nil {
			t.Fatal("expected an unknown-scenario error")
		}
	})
}

func TestTenantChatQuotaContentionProbeIntegration(t *testing.T) {
	if os.Getenv(quotaProbeEnabledEnv) != "1" {
		t.Skipf("set %s=1 to run the local PostgreSQL quota contention probe", quotaProbeEnabledEnv)
	}
	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for the quota contention probe")
	}
	outputDir := strings.TrimSpace(os.Getenv(quotaProbeOutputDirEnv))
	if outputDir == "" {
		t.Fatalf("%s is required for the quota contention probe", quotaProbeOutputDirEnv)
	}

	operations := quotaProbePositiveInt(t, quotaProbeOperationsEnv, 1_000)
	repetitions := quotaProbePositiveInt(t, quotaProbeRepetitionsEnv, 3)
	concurrencies := quotaProbeConcurrencies(t, os.Getenv(quotaProbeConcurrencyEnv))
	scenarios, err := parseQuotaProbeScenarios(os.Getenv(quotaProbeScenariosEnv))
	if err != nil {
		t.Fatalf("%s: %v", quotaProbeScenariosEnv, err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Minute)
	defer cancel()
	workloadPool := openQuotaProbePool(t, ctx, databaseURL, "gatelm-quota-probe-workload", quotaProbePoolSize, quotaProbePoolSize)
	defer workloadPool.Close()
	observerPool := openQuotaProbePool(t, ctx, databaseURL, "gatelm-quota-probe-observer", 2, 1)
	defer observerPool.Close()
	warmQuotaProbePool(t, ctx, workloadPool, int(quotaProbePoolSize))

	var postgresVersion string
	if err := observerPool.QueryRow(ctx, `SHOW server_version`).Scan(&postgresVersion); err != nil {
		t.Fatalf("read PostgreSQL version: %v", err)
	}

	report := quotaProbeReport{Metadata: quotaProbeMetadata{
		Commit: strings.TrimSpace(os.Getenv(quotaProbeCommitEnv)), GoVersion: runtime.Version(),
		GOOS: runtime.GOOS, CPUCount: runtime.NumCPU(), PostgresVersion: postgresVersion,
		PoolSize: quotaProbePoolSize, Operations: operations, Repetitions: repetitions,
		Concurrencies: concurrencies, Scenarios: scenarios, GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano),
		AdvisorySampleRate: "25ms", LockSampleRate: "25ms",
	}}

	scenarioOrders := [][]string{{"A", "B", "C"}, {"B", "C", "A"}, {"C", "A", "B"}}
	selectedScenarios := make(map[string]struct{}, len(scenarios))
	for _, scenario := range scenarios {
		selectedScenarios[scenario] = struct{}{}
	}
	for repetition := 1; repetition <= repetitions; repetition++ {
		order := scenarioOrders[(repetition-1)%len(scenarioOrders)]
		for _, concurrency := range concurrencies {
			for _, scenario := range order {
				if _, selected := selectedScenarios[scenario]; !selected {
					continue
				}
				result := executeQuotaProbeRun(t, ctx, workloadPool, observerPool, scenario, concurrency, repetition, operations)
				report.Runs = append(report.Runs, result)
				t.Logf(
					"quota probe scenario=%s concurrency=%d repetition=%d begin_p95=%.2fms settle_p95=%.2fms throughput=%.2f/s advisory_wait_ratio=%.4f db_lock_wait_ratio=%.4f errors=%d",
					result.Scenario, result.Concurrency, result.Repetition, result.BeginP95Ms,
					result.SettleP95Ms, result.ThroughputOpsPerSecond,
					result.AdvisoryWaitSampleRatio, result.DBLockWaitSampleRatio, result.Errors,
				)
			}
		}
	}

	report.Correctness = append(report.Correctness,
		runQuotaBoundaryProbe(t, ctx, workloadPool, "user_monthly_hard_stop"),
		runQuotaBoundaryProbe(t, ctx, workloadPool, "employee_weekly_hard_stop"),
		runQuotaBoundaryProbe(t, ctx, workloadPool, "tenant_budget_hard_stop"),
		runQuotaDuplicateSettlementProbe(t, ctx, workloadPool),
		runQuotaFallbackWeeklyProbe(t, ctx, workloadPool),
	)
	report.Decision, report.Reasons = decideQuotaProbe(report.Runs, report.Correctness)
	if err := writeQuotaProbeArtifacts(outputDir, report); err != nil {
		t.Fatalf("write quota probe artifacts: %v", err)
	}
	t.Logf("quota contention probe decision=%s output=%s", report.Decision, outputDir)
}

func executeQuotaProbeRun(
	t *testing.T,
	ctx context.Context,
	workloadPool *pgxpool.Pool,
	observerPool *pgxpool.Pool,
	scenario string,
	concurrency int,
	repetition int,
	operations int,
) quotaProbeRunResult {
	t.Helper()
	runID := fmt.Sprintf("qpr_%s_c%d_r%d_%d", strings.ToLower(scenario), concurrency, repetition, time.Now().UnixNano())
	fixture, err := createQuotaProbeFixture(ctx, workloadPool, scenario)
	if err != nil {
		t.Fatalf("create quota probe fixture %s: %v", runID, err)
	}
	defer cleanupQuotaProbeFixture(t, workloadPool, fixture)

	snapshots := quotaProbeSnapshots(fixture, 1_000_000_000_000, 1_000_000_000_000, true)
	warmItems, err := seedQuotaProbeWork(ctx, workloadPool, fixture, snapshots, runID+"_warm", len(fixture.actors))
	if err != nil {
		t.Fatalf("seed quota probe warmup %s: %v", runID, err)
	}
	store := NewReservationStore(workloadPool)
	for _, item := range warmItems {
		reservation, beginErr := store.BeginExecution(ctx, item.requestContext, item.snapshot)
		if beginErr != nil {
			t.Fatalf("warm quota probe begin %s: %v", runID, beginErr)
		}
		if _, settleErr := store.FinalizeConfirmed(
			ctx, item.requestContext, reservation.ReservationID, 1,
			tenantchat.ConfirmedUsage{InputTokens: 100, OutputTokens: 50}, "succeeded",
		); settleErr != nil {
			t.Fatalf("warm quota probe settle %s: %v", runID, settleErr)
		}
	}

	requestPrefix := runID + "_work"
	items, err := seedQuotaProbeWork(ctx, workloadPool, fixture, snapshots, requestPrefix, operations)
	if err != nil {
		t.Fatalf("seed quota probe work %s: %v", runID, err)
	}

	beginDurations := make([]time.Duration, operations)
	settleDurations := make([]time.Duration, operations)
	errorMessages := make([]string, operations)
	before := workloadPool.Stat()
	beforeAcquireDuration := before.AcquireDuration()
	beforeEmptyAcquire := before.EmptyAcquireCount()
	lockSamples := &quotaProbeLockSamples{waitEventSamples: make(map[string]int64)}
	stopObserver := startQuotaProbeLockObserver(ctx, observerPool, lockSamples)
	started := time.Now()
	runQuotaProbeWorkers(ctx, concurrency, len(items), func(index int) {
		beginStarted := time.Now()
		reservation, beginErr := store.BeginExecution(ctx, items[index].requestContext, items[index].snapshot)
		beginDurations[index] = time.Since(beginStarted)
		if beginErr != nil {
			errorMessages[index] = "begin_execution: " + beginErr.Error()
			return
		}
		settleStarted := time.Now()
		_, settleErr := store.FinalizeConfirmed(
			ctx, items[index].requestContext, reservation.ReservationID, 1,
			tenantchat.ConfirmedUsage{InputTokens: 100, OutputTokens: 50}, "succeeded",
		)
		settleDurations[index] = time.Since(settleStarted)
		if settleErr != nil {
			errorMessages[index] = "finalize_confirmed: " + settleErr.Error()
		}
	})
	elapsed := time.Since(started)
	stopObserver()
	after := workloadPool.Stat()

	successes := 0
	beginSuccessDurations := make([]time.Duration, 0, operations)
	settleSuccessDurations := make([]time.Duration, 0, operations)
	for index, message := range errorMessages {
		if message == "" {
			successes++
			beginSuccessDurations = append(beginSuccessDurations, beginDurations[index])
			settleSuccessDurations = append(settleSuccessDurations, settleDurations[index])
		}
	}

	result := quotaProbeRunResult{
		Scenario: scenario, Concurrency: concurrency, Repetition: repetition, Operations: operations,
		Successes: successes, Errors: operations - successes,
		ThroughputOpsPerSecond:    float64(successes) / elapsed.Seconds(),
		BeginP50Ms:                quotaProbePercentileMs(beginSuccessDurations, 0.50),
		BeginP95Ms:                quotaProbePercentileMs(beginSuccessDurations, 0.95),
		BeginP99Ms:                quotaProbePercentileMs(beginSuccessDurations, 0.99),
		SettleP50Ms:               quotaProbePercentileMs(settleSuccessDurations, 0.50),
		SettleP95Ms:               quotaProbePercentileMs(settleSuccessDurations, 0.95),
		SettleP99Ms:               quotaProbePercentileMs(settleSuccessDurations, 0.99),
		PoolAcquireTotalMs:        float64((after.AcquireDuration() - beforeAcquireDuration).Microseconds()) / 1_000,
		PoolEmptyAcquireCount:     int64(after.EmptyAcquireCount() - beforeEmptyAcquire),
		AdvisorySamples:           lockSamples.samples.Load(),
		AdvisoryWaitingSamples:    lockSamples.advisoryWaitingSamples.Load(),
		AdvisoryPeakWaiters:       lockSamples.advisoryPeakWaiters.Load(),
		NonAdvisoryWaitingSamples: lockSamples.nonAdvisoryWaitingSamples.Load(),
		NonAdvisoryPeakWaiters:    lockSamples.nonAdvisoryPeakWaiters.Load(),
		DBLockSamples:             lockSamples.samples.Load(),
		DBLockWaitingSamples:      lockSamples.totalWaitingSamples.Load(),
		DBLockPeakWaiters:         lockSamples.totalPeakWaiters.Load(),
		LockWaitEventSamples:      lockSamples.snapshotWaitEventSamples(),
	}
	if result.AdvisorySamples > 0 {
		result.AdvisoryWaitSampleRatio = float64(result.AdvisoryWaitingSamples) / float64(result.AdvisorySamples)
		result.NonAdvisoryWaitSampleRatio = float64(result.NonAdvisoryWaitingSamples) / float64(result.AdvisorySamples)
	}
	if result.DBLockSamples > 0 {
		result.DBLockWaitSampleRatio = float64(result.DBLockWaitingSamples) / float64(result.DBLockSamples)
	}
	if err := workloadPool.QueryRow(ctx, `
		SELECT count(*), COALESCE(sum(reserved_tokens), 0),
		       COALESCE(sum(confirmed_input_tokens + confirmed_output_tokens), 0)
		FROM tenant_chat_usage_reservations
		WHERE request_id LIKE $1
	`, requestPrefix+"%").Scan(
		&result.SettledRows, &result.ReservedTokensRemaining, &result.ConfirmedTokens,
	); err != nil {
		t.Fatalf("verify quota probe reservations %s: %v", runID, err)
	}
	if err := workloadPool.QueryRow(ctx, `
		SELECT count(*), count(DISTINCT request_id)
		FROM tenant_chat_usage_ledger_entries
		WHERE event_type = 'usage_settled' AND request_id LIKE $1
	`, requestPrefix+"%").Scan(&result.SettlementLedgerRows, &result.DistinctSettlementRows); err != nil {
		t.Fatalf("verify quota probe ledger %s: %v", runID, err)
	}
	result.CorrectnessViolation = result.Errors != 0 || result.SettledRows != int64(operations) ||
		result.ReservedTokensRemaining != 0 || result.ConfirmedTokens != int64(operations)*quotaProbeConfirmedTokens ||
		result.SettlementLedgerRows != int64(operations) || result.DistinctSettlementRows != int64(operations)
	return result
}

func runQuotaBoundaryProbe(t *testing.T, ctx context.Context, pool *pgxpool.Pool, name string) quotaProbeCorrectnessResult {
	t.Helper()
	scenario := "A"
	if name == "tenant_budget_hard_stop" {
		scenario = "B"
	}
	fixture, err := createQuotaProbeFixture(ctx, pool, scenario)
	if err != nil {
		t.Fatalf("create %s fixture: %v", name, err)
	}
	defer cleanupQuotaProbeFixture(t, pool, fixture)

	const requests = 16
	const expectedAccepted = 8
	monthlyLimit := int64(1_000_000_000)
	costLimit := int64(1_000_000_000)
	enableWeekly := false
	weeklyLimit := int64(0)
	switch name {
	case "user_monthly_hard_stop":
		monthlyLimit = expectedAccepted * quotaProbeReservedTokens
	case "employee_weekly_hard_stop":
		enableWeekly = true
		weeklyLimit = expectedAccepted * quotaProbeReservedTokens
	case "tenant_budget_hard_stop":
		costLimit = expectedAccepted * quotaProbeReservedCost
	default:
		t.Fatalf("unsupported quota boundary probe %q", name)
	}
	snapshots := quotaProbeSnapshots(fixture, monthlyLimit, costLimit, enableWeekly)
	if enableWeekly {
		for tenantID, snapshot := range snapshots {
			for index := range snapshot.Policies.Quota.EmployeeWeeklyTokenLimits {
				snapshot.Policies.Quota.EmployeeWeeklyTokenLimits[index].LimitTokens = weeklyLimit
			}
			snapshots[tenantID] = snapshot
		}
	}
	items, err := seedQuotaProbeWork(ctx, pool, fixture, snapshots, "qpb_"+name+"_"+strconv.FormatInt(time.Now().UnixNano(), 10), requests)
	if err != nil {
		t.Fatalf("seed %s work: %v", name, err)
	}
	store := NewReservationStore(pool)
	var accepted atomic.Int64
	var rejected atomic.Int64
	var unexpected atomic.Int64
	runQuotaProbeWorkers(ctx, requests, requests, func(index int) {
		_, reserveErr := store.BeginExecution(ctx, items[index].requestContext, items[index].snapshot)
		if reserveErr == nil {
			accepted.Add(1)
			return
		}
		expectedErr := tenantchat.ErrQuotaHardLimit
		if name == "employee_weekly_hard_stop" {
			expectedErr = tenantchat.ErrEmployeeWeeklyTokenQuotaHardLimit
		} else if name == "tenant_budget_hard_stop" {
			expectedErr = tenantchat.ErrBudgetHardLimit
		}
		if errors.Is(reserveErr, expectedErr) {
			rejected.Add(1)
		} else {
			unexpected.Add(1)
		}
	})
	actualAccepted := int(accepted.Load())
	overshootTokens := int64(0)
	overshootCost := int64(0)
	if actualAccepted > expectedAccepted {
		overshootTokens = int64(actualAccepted-expectedAccepted) * quotaProbeReservedTokens
		if name == "tenant_budget_hard_stop" {
			overshootTokens = 0
			overshootCost = int64(actualAccepted-expectedAccepted) * quotaProbeReservedCost
		}
	}
	result := quotaProbeCorrectnessResult{
		Name: name, ExpectedAccepted: expectedAccepted, ActualAccepted: actualAccepted,
		ExpectedRejections: requests - expectedAccepted, ActualRejections: int(rejected.Load()),
		UnexpectedErrors: int(unexpected.Load()), OvershootTokens: overshootTokens,
		OvershootCostMicroUSD: overshootCost,
	}
	result.Violation = result.ActualAccepted != result.ExpectedAccepted ||
		result.ActualRejections != result.ExpectedRejections || result.UnexpectedErrors != 0
	result.Detail = fmt.Sprintf("accepted=%d/%d rejected=%d/%d unexpected=%d",
		result.ActualAccepted, result.ExpectedAccepted, result.ActualRejections,
		result.ExpectedRejections, result.UnexpectedErrors)
	return result
}

func runQuotaDuplicateSettlementProbe(t *testing.T, ctx context.Context, pool *pgxpool.Pool) quotaProbeCorrectnessResult {
	t.Helper()
	fixture, err := createQuotaProbeFixture(ctx, pool, "A")
	if err != nil {
		t.Fatalf("create duplicate settlement fixture: %v", err)
	}
	defer cleanupQuotaProbeFixture(t, pool, fixture)
	snapshots := quotaProbeSnapshots(fixture, 1_000_000_000, 1_000_000_000, true)
	prefix := "qpd_" + strconv.FormatInt(time.Now().UnixNano(), 10)
	items, err := seedQuotaProbeWork(ctx, pool, fixture, snapshots, prefix, 1)
	if err != nil {
		t.Fatalf("seed duplicate settlement work: %v", err)
	}
	store := NewReservationStore(pool)
	reservation, err := store.BeginExecution(ctx, items[0].requestContext, items[0].snapshot)
	if err != nil {
		t.Fatalf("reserve duplicate settlement probe: %v", err)
	}
	var success atomic.Int64
	var unexpected atomic.Int64
	runQuotaProbeWorkers(ctx, 16, 16, func(_ int) {
		_, settleErr := store.FinalizeConfirmed(
			ctx, items[0].requestContext, reservation.ReservationID, 1,
			tenantchat.ConfirmedUsage{InputTokens: 100, OutputTokens: 50}, "succeeded",
		)
		if settleErr == nil {
			success.Add(1)
		} else {
			unexpected.Add(1)
		}
	})
	var ledgerRows, confirmedTokens int64
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM tenant_chat_usage_ledger_entries
		WHERE request_id = $1 AND event_type = 'usage_settled'
	`, items[0].requestContext.RequestID).Scan(&ledgerRows); err != nil {
		t.Fatalf("read duplicate settlement ledger: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		SELECT confirmed_total_tokens FROM tenant_chat_user_token_periods
		WHERE tenant_id = $1::uuid AND user_id = $2::uuid
	`, fixture.actors[0].tenantID, fixture.actors[0].userID).Scan(&confirmedTokens); err != nil {
		t.Fatalf("read duplicate settlement period: %v", err)
	}
	duplicateRows := ledgerRows - 1
	if duplicateRows < 0 {
		duplicateRows = 0
	}
	result := quotaProbeCorrectnessResult{
		Name: "duplicate_settlement_replay", UnexpectedErrors: int(unexpected.Load()),
		DuplicateSettlementRows: duplicateRows, ConfirmedTokens: confirmedTokens,
	}
	result.Violation = success.Load() != 16 || unexpected.Load() != 0 || ledgerRows != 1 || confirmedTokens != quotaProbeConfirmedTokens
	result.Detail = fmt.Sprintf("successful_replays=%d/16 settlement_ledger=%d confirmed_tokens=%d",
		success.Load(), ledgerRows, confirmedTokens)
	return result
}

func runQuotaFallbackWeeklyProbe(t *testing.T, ctx context.Context, pool *pgxpool.Pool) quotaProbeCorrectnessResult {
	t.Helper()
	fixture, err := createQuotaProbeFixture(ctx, pool, "A")
	if err != nil {
		t.Fatalf("create fallback weekly fixture: %v", err)
	}
	defer cleanupQuotaProbeFixture(t, pool, fixture)
	snapshots := quotaProbeSnapshots(fixture, 10_000, 1_000_000, true)
	for tenantID, snapshot := range snapshots {
		snapshot.PolicyVersion = 3
		snapshot.Policies.Quota.EmployeeWeeklyTokenLimits[0].LimitTokens = 300
		snapshots[tenantID] = snapshot
	}
	prefix := "qpf_" + strconv.FormatInt(time.Now().UnixNano(), 10)
	items, err := seedQuotaProbeWork(ctx, pool, fixture, snapshots, prefix, 1)
	if err != nil {
		t.Fatalf("seed fallback weekly work: %v", err)
	}
	store := NewReservationStore(pool)
	reservation, err := store.BeginExecution(ctx, items[0].requestContext, items[0].snapshot)
	if err != nil {
		t.Fatalf("reserve fallback weekly primary exposure: %v", err)
	}
	fallbackRoute, err := selectRoute(items[0].snapshot, "economy", "normal", "normal")
	if err != nil {
		t.Fatalf("select fallback weekly route: %v", err)
	}
	_, fallbackErr := store.BeginFallback(
		ctx, items[0].requestContext, items[0].snapshot, reservation.ReservationID,
		1, tenantchat.ConfirmedUsage{InputTokens: 100, OutputTokens: 80}, "failed_post_delta",
		fallbackRoute, 2,
	)
	fallbackAllowed := fallbackErr == nil
	observed := "none"
	if fallbackErr != nil {
		observed = fallbackErr.Error()
	}
	result := quotaProbeCorrectnessResult{
		Name: "employee_weekly_fallback_top_up", FallbackAllowed: fallbackAllowed,
		ObservedError: observed,
	}
	result.Violation = !errors.Is(fallbackErr, tenantchat.ErrEmployeeWeeklyTokenQuotaHardLimit)
	result.Detail = fmt.Sprintf(
		"weekly limit=300, primary exposure=200, fallback exposure=200; allowed=%t observed_error=%s",
		fallbackAllowed, observed,
	)
	return result
}

func createQuotaProbeFixture(ctx context.Context, pool *pgxpool.Pool, scenario string) (quotaProbeFixture, error) {
	actorCount := 1
	if scenario == "B" || scenario == "C" {
		actorCount = quotaProbeActorCount
	}
	fixture := quotaProbeFixture{actors: make([]quotaProbeActor, 0, actorCount)}
	sharedTenantID := ""
	if scenario != "C" {
		value, err := newUUID()
		if err != nil {
			return quotaProbeFixture{}, err
		}
		sharedTenantID = value
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return quotaProbeFixture{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	createdTenants := map[string]struct{}{}
	for index := 0; index < actorCount; index++ {
		tenantID := sharedTenantID
		if tenantID == "" {
			tenantID, err = newUUID()
			if err != nil {
				return quotaProbeFixture{}, err
			}
		}
		userID, uuidErr := newUUID()
		if uuidErr != nil {
			return quotaProbeFixture{}, uuidErr
		}
		employeeID, uuidErr := newUUID()
		if uuidErr != nil {
			return quotaProbeFixture{}, uuidErr
		}
		if _, exists := createdTenants[tenantID]; !exists {
			if _, err = tx.Exec(ctx, `
				INSERT INTO tenants (id, name, status, "createdAt", "updatedAt")
				VALUES ($1::uuid, 'quota contention probe', 'ACTIVE', now(), now())
			`, tenantID); err != nil {
				return quotaProbeFixture{}, err
			}
			createdTenants[tenantID] = struct{}{}
			fixture.tenantIDs = append(fixture.tenantIDs, tenantID)
		}
		if _, err = tx.Exec(ctx, `
			INSERT INTO users (id, email, status, "createdAt", "updatedAt")
			VALUES ($1::uuid, $1 || '@quota-probe.local', 'active', now(), now())
		`, userID); err != nil {
			return quotaProbeFixture{}, err
		}
		if _, err = tx.Exec(ctx, `
			INSERT INTO tenant_memberships (id, "tenantId", "userId", role, status, "createdAt", "updatedAt")
			VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'employee', 'active', now(), now())
		`, tenantID, userID); err != nil {
			return quotaProbeFixture{}, err
		}
		if _, err = tx.Exec(ctx, `
			INSERT INTO employees (id, "tenantId", "userId", email, status, "invitationStatus", "createdAt", "updatedAt")
			VALUES ($1::uuid, $2::uuid, $3::uuid, $3 || '@quota-probe.local', 'active', 'accepted', now(), now())
		`, employeeID, tenantID, userID); err != nil {
			return quotaProbeFixture{}, err
		}
		fixture.actors = append(fixture.actors, quotaProbeActor{tenantID: tenantID, userID: userID, employeeID: employeeID})
		fixture.userIDs = append(fixture.userIDs, userID)
	}
	if err = tx.Commit(ctx); err != nil {
		return quotaProbeFixture{}, err
	}
	return fixture, nil
}

func quotaProbeSnapshots(
	fixture quotaProbeFixture,
	monthlyTokenLimit int64,
	tenantCostLimit int64,
	enableWeekly bool,
) map[string]tenantruntime.Snapshot {
	snapshots := make(map[string]tenantruntime.Snapshot, len(fixture.tenantIDs))
	for _, tenantID := range fixture.tenantIDs {
		snapshot := usageFixture{tenantID: tenantID}.snapshot(monthlyTokenLimit, tenantCostLimit)
		snapshot.PolicyVersion = 1
		snapshot.EmployeeNoticeVersion = 1
		snapshot.Digest = "sha256:QTJXSkcD9dvUyD2iz63k6npQETJmbS9IvHe9Bx8xx9M"
		snapshot.Policies.Quota.WarningPercent = 80
		snapshot.Policies.Quota.EconomyPercent = 90
		snapshot.Policies.Quota.HardStopPercent = 100
		if enableWeekly {
			for _, actor := range fixture.actors {
				if actor.tenantID == tenantID {
					snapshot.Policies.Quota.EmployeeWeeklyTokenLimits = append(
						snapshot.Policies.Quota.EmployeeWeeklyTokenLimits,
						tenantruntime.EmployeeWeeklyTokenLimit{EmployeeID: actor.employeeID, LimitTokens: 1_000_000_000_000},
					)
				}
			}
		}
		snapshots[tenantID] = snapshot
	}
	return snapshots
}

func seedQuotaProbeWork(
	ctx context.Context,
	pool *pgxpool.Pool,
	fixture quotaProbeFixture,
	snapshots map[string]tenantruntime.Snapshot,
	prefix string,
	operations int,
) ([]quotaProbeWorkItem, error) {
	items := make([]quotaProbeWorkItem, 0, operations)
	batch := &pgx.Batch{}
	for index := 0; index < operations; index++ {
		actor := fixture.actors[index%len(fixture.actors)]
		admissionID, err := newUUID()
		if err != nil {
			return nil, err
		}
		requestID := fmt.Sprintf("%s_req_%d", prefix, index)
		turnID := fmt.Sprintf("%s_turn_%d", prefix, index)
		idempotencyKey := fmt.Sprintf("%s_idem_%d", prefix, index)
		requestContext := tenantchat.RequestContext{
			Surface: "tenant_chat", Phase: tenantchat.PhaseCompletion,
			RequestID: requestID, TurnID: turnID, IdempotencyKey: idempotencyKey,
			AdmissionID: admissionID,
			ExecutionScope: tenantchat.ExecutionScope{
				Kind: "tenant_chat", TenantID: actor.tenantID,
				Actor:       tenantchat.Actor{UserID: actor.userID, ActorKind: "employee", EmployeeID: actor.employeeID},
				QuotaScope:  tenantchat.ScopeReference{Type: "user", ID: actor.userID},
				BudgetScope: tenantchat.ScopeReference{Type: "tenant", ID: actor.tenantID},
			},
			Snapshot: tenantchat.SnapshotReference{
				Version: 1, Digest: "sha256:QTJXSkcD9dvUyD2iz63k6npQETJmbS9IvHe9Bx8xx9M",
				PolicyVersion:         snapshots[actor.tenantID].PolicyVersion,
				EmployeeNoticeVersion: 1, PricingVersion: 1,
			},
			BindingDigest: "hmac-sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
			UsageIntent: &tenantchat.UsageIntent{
				EstimatedInputTokens: 100, MaxOutputTokens: 100,
				RequestedTier: "standard", CacheStrategy: "off",
			},
		}
		batch.Queue(`
			INSERT INTO tenant_chat_request_admissions (
			  admission_id, tenant_id, user_id, employee_id, actor_kind,
			  request_id, turn_id, idempotency_key, binding_digest,
			  snapshot_version, state, expires_at, created_at, updated_at
			) VALUES (
			  $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'employee',
			  $5, $6, $7, $8, 1, 'active', now() + interval '1 hour', now(), now()
			)
		`, admissionID, actor.tenantID, actor.userID, actor.employeeID,
			requestID, turnID, idempotencyKey, requestContext.BindingDigest)
		items = append(items, quotaProbeWorkItem{requestContext: requestContext, snapshot: snapshots[actor.tenantID]})
	}
	results := pool.SendBatch(ctx, batch)
	for range items {
		if _, err := results.Exec(); err != nil {
			_ = results.Close()
			return nil, err
		}
	}
	if err := results.Close(); err != nil {
		return nil, err
	}
	return items, nil
}

func cleanupQuotaProbeFixture(t *testing.T, pool *pgxpool.Pool, fixture quotaProbeFixture) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	for _, tenantID := range fixture.tenantIDs {
		statements := []string{
			`DELETE FROM tenant_employee_cost_ledger_entries WHERE tenant_id = $1::uuid`,
			`DELETE FROM tenant_employee_cost_provider_attempts WHERE tenant_id = $1::uuid`,
			`DELETE FROM tenant_employee_cost_reservations WHERE tenant_id = $1::uuid`,
			`DELETE FROM tenant_employee_cost_periods WHERE tenant_id = $1::uuid`,
			`DELETE FROM tenant_employee_cost_policy_audits WHERE tenant_id = $1::uuid`,
			`DELETE FROM tenant_employee_cost_policies WHERE tenant_id = $1::uuid`,
			`DELETE FROM tenant_employee_cost_ledger_rollout_audits WHERE tenant_id = $1::uuid`,
			`DELETE FROM tenant_employee_cost_ledger_rollouts WHERE tenant_id = $1::uuid`,
			`DELETE FROM tenant_chat_invocation_outbox WHERE tenant_id = $1::uuid`,
			`DELETE FROM tenant_chat_usage_ledger_entries WHERE tenant_id = $1::uuid`,
			`DELETE FROM tenant_chat_provider_attempts WHERE tenant_id = $1::uuid`,
			`DELETE FROM tenant_chat_usage_reservations WHERE tenant_id = $1::uuid`,
			`DELETE FROM tenant_chat_employee_weekly_token_periods WHERE tenant_id = $1::uuid`,
			`DELETE FROM tenant_chat_user_token_periods WHERE tenant_id = $1::uuid`,
			`DELETE FROM tenant_chat_tenant_cost_periods WHERE tenant_id = $1::uuid`,
			`DELETE FROM tenant_chat_request_admissions WHERE tenant_id = $1::uuid`,
			`DELETE FROM employees WHERE "tenantId" = $1::uuid`,
			`DELETE FROM tenant_memberships WHERE "tenantId" = $1::uuid`,
		}
		for _, statement := range statements {
			if _, err := pool.Exec(ctx, statement, tenantID); err != nil {
				t.Errorf("cleanup quota probe tenant %s: %v", tenantID, err)
				return
			}
		}
	}
	for _, userID := range fixture.userIDs {
		if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, userID); err != nil {
			t.Errorf("cleanup quota probe user %s: %v", userID, err)
			return
		}
	}
	for _, tenantID := range fixture.tenantIDs {
		if _, err := pool.Exec(ctx, `DELETE FROM tenants WHERE id = $1::uuid`, tenantID); err != nil {
			t.Errorf("cleanup quota probe tenant record %s: %v", tenantID, err)
			return
		}
	}
}

func openQuotaProbePool(
	t *testing.T,
	ctx context.Context,
	databaseURL string,
	applicationName string,
	maxConns int32,
	minConns int32,
) *pgxpool.Pool {
	t.Helper()
	poolConfig, err := pgxpool.ParseConfig(config.DatabaseDriverURL(databaseURL))
	if err != nil {
		t.Fatalf("parse quota probe database URL: %v", err)
	}
	poolConfig.MaxConns = maxConns
	poolConfig.MinConns = minConns
	poolConfig.ConnConfig.RuntimeParams["application_name"] = applicationName
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		t.Fatalf("open quota probe pool: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("ping quota probe database: %v", err)
	}
	return pool
}

func warmQuotaProbePool(t *testing.T, ctx context.Context, pool *pgxpool.Pool, count int) {
	t.Helper()
	connections := make([]*pgxpool.Conn, 0, count)
	for index := 0; index < count; index++ {
		connection, err := pool.Acquire(ctx)
		if err != nil {
			t.Fatalf("warm quota probe pool connection %d: %v", index, err)
		}
		connections = append(connections, connection)
	}
	for _, connection := range connections {
		connection.Release()
	}
}

func startQuotaProbeLockObserver(
	ctx context.Context,
	pool *pgxpool.Pool,
	samples *quotaProbeLockSamples,
) func() {
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(25 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-stop:
				return
			case <-ticker.C:
				rows, err := pool.Query(ctx, `
					SELECT wait_event, count(*)
					FROM pg_stat_activity
					WHERE datname = current_database()
					  AND application_name = 'gatelm-quota-probe-workload'
					  AND wait_event_type = 'Lock'
					GROUP BY wait_event
				`)
				if err != nil {
					continue
				}
				waitersByEvent := make(map[string]int64)
				var advisoryWaiters int64
				var totalWaiters int64
				for rows.Next() {
					var event string
					var waiters int64
					if scanErr := rows.Scan(&event, &waiters); scanErr != nil {
						continue
					}
					waitersByEvent[event] += waiters
					totalWaiters += waiters
					if event == "advisory" {
						advisoryWaiters += waiters
					}
				}
				rows.Close()
				if rows.Err() != nil {
					continue
				}
				nonAdvisoryWaiters := totalWaiters - advisoryWaiters
				samples.samples.Add(1)
				if advisoryWaiters > 0 {
					samples.advisoryWaitingSamples.Add(1)
				}
				if nonAdvisoryWaiters > 0 {
					samples.nonAdvisoryWaitingSamples.Add(1)
				}
				if totalWaiters > 0 {
					samples.totalWaitingSamples.Add(1)
				}
				updateQuotaProbePeak(&samples.advisoryPeakWaiters, advisoryWaiters)
				updateQuotaProbePeak(&samples.nonAdvisoryPeakWaiters, nonAdvisoryWaiters)
				updateQuotaProbePeak(&samples.totalPeakWaiters, totalWaiters)
				samples.addWaitEventSamples(waitersByEvent)
			}
		}
	}()
	return func() {
		close(stop)
		<-done
	}
}

func updateQuotaProbePeak(peak *atomic.Int64, value int64) {
	for {
		current := peak.Load()
		if value <= current || peak.CompareAndSwap(current, value) {
			return
		}
	}
}

func (samples *quotaProbeLockSamples) addWaitEventSamples(waitersByEvent map[string]int64) {
	samples.waitEventMu.Lock()
	defer samples.waitEventMu.Unlock()
	for event, waiters := range waitersByEvent {
		samples.waitEventSamples[event] += waiters
	}
}

func (samples *quotaProbeLockSamples) snapshotWaitEventSamples() map[string]int64 {
	samples.waitEventMu.Lock()
	defer samples.waitEventMu.Unlock()
	result := make(map[string]int64, len(samples.waitEventSamples))
	for event, count := range samples.waitEventSamples {
		result[event] = count
	}
	return result
}

func runQuotaProbeWorkers(ctx context.Context, concurrency int, operations int, operation func(index int)) {
	jobs := make(chan int)
	var workers sync.WaitGroup
	for worker := 0; worker < concurrency; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range jobs {
				if ctx.Err() != nil {
					return
				}
				operation(index)
			}
		}()
	}
	for index := 0; index < operations; index++ {
		select {
		case jobs <- index:
		case <-ctx.Done():
			close(jobs)
			workers.Wait()
			return
		}
	}
	close(jobs)
	workers.Wait()
}

func quotaProbePercentileMs(values []time.Duration, percentile float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]time.Duration(nil), values...)
	sort.Slice(sorted, func(left, right int) bool { return sorted[left] < sorted[right] })
	index := int(float64(len(sorted)-1) * percentile)
	return float64(sorted[index].Microseconds()) / 1_000
}

func quotaProbePositiveInt(t *testing.T, key string, fallback int) int {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		t.Fatalf("%s must be a positive integer", key)
	}
	return value
}

func quotaProbeConcurrencies(t *testing.T, raw string) []int {
	t.Helper()
	if strings.TrimSpace(raw) == "" {
		return []int{1, 4, 8, 16, 32}
	}
	parts := strings.Split(raw, ",")
	values := make([]int, 0, len(parts))
	seen := map[int]struct{}{}
	for _, part := range parts {
		value, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || value <= 0 || value > 256 {
			t.Fatalf("%s must contain comma-separated integers in 1..256", quotaProbeConcurrencyEnv)
		}
		if _, exists := seen[value]; !exists {
			values = append(values, value)
			seen[value] = struct{}{}
		}
	}
	sort.Ints(values)
	return values
}

func parseQuotaProbeScenarios(raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return []string{"A", "B", "C"}, nil
	}
	values := make([]string, 0, 3)
	seen := make(map[string]struct{}, 3)
	for _, part := range strings.Split(raw, ",") {
		value := strings.ToUpper(strings.TrimSpace(part))
		if value != "A" && value != "B" && value != "C" {
			return nil, fmt.Errorf("must contain only comma-separated scenarios A, B, or C")
		}
		if _, exists := seen[value]; exists {
			continue
		}
		values = append(values, value)
		seen[value] = struct{}{}
	}
	return values, nil
}

func decideQuotaProbe(
	runs []quotaProbeRunResult,
	correctness []quotaProbeCorrectnessResult,
) (string, []string) {
	reasons := make([]string, 0)
	for _, check := range correctness {
		if check.Violation {
			reasons = append(reasons, "correctness violation: "+check.Name+" ("+check.Detail+")")
		}
	}
	for _, run := range runs {
		if run.CorrectnessViolation {
			reasons = append(reasons, fmt.Sprintf("workload correctness violation: scenario=%s concurrency=%d repetition=%d", run.Scenario, run.Concurrency, run.Repetition))
		}
	}
	performanceReasons := make([]string, 0)
	ambiguous := false
	for _, concurrency := range []int{8, 16} {
		matches := 0
		ambiguousMatches := 0
		for repetition := 1; repetition <= 100; repetition++ {
			b, bFound := findQuotaProbeRun(runs, "B", concurrency, repetition)
			c, cFound := findQuotaProbeRun(runs, "C", concurrency, repetition)
			if !bFound || !cFound {
				continue
			}
			p95Ratio := maxFloat(quotaProbeRatio(b.BeginP95Ms, c.BeginP95Ms), quotaProbeRatio(b.SettleP95Ms, c.SettleP95Ms))
			throughputRatio := quotaProbeRatio(b.ThroughputOpsPerSecond, c.ThroughputOpsPerSecond)
			lockIncreased := quotaProbeDBLockWaitSampleRatio(b) > quotaProbeDBLockWaitSampleRatio(c) ||
				quotaProbeDBLockPeakWaiters(b) > quotaProbeDBLockPeakWaiters(c)
			if (p95Ratio >= 1.30 || throughputRatio <= 0.75) && lockIncreased {
				matches++
			} else if p95Ratio >= 1.20 || throughputRatio <= 0.80 {
				ambiguousMatches++
			}
		}
		if matches >= 2 {
			performanceReasons = append(performanceReasons, fmt.Sprintf("same-tenant contention reproduced at concurrency=%d in %d runs", concurrency, matches))
		}
		if ambiguousMatches > 0 {
			ambiguous = true
		}
	}
	if len(reasons) > 0 && len(performanceReasons) > 0 {
		return "GO_CORRECTNESS_AND_PERFORMANCE", append(reasons, performanceReasons...)
	}
	if len(reasons) > 0 {
		return "GO_CORRECTNESS", reasons
	}
	if len(performanceReasons) > 0 {
		return "GO_PERFORMANCE", performanceReasons
	}
	if ambiguous {
		return "AMBIGUOUS_RERUN_5000", []string{"20-30% latency or throughput signal observed without the required repeatability"}
	}
	return "NO_GO", []string{"B and C stayed within the decision thresholds and no correctness violation was observed"}
}

func quotaProbeDBLockWaitSampleRatio(run quotaProbeRunResult) float64 {
	if run.DBLockSamples > 0 {
		return run.DBLockWaitSampleRatio
	}
	return run.AdvisoryWaitSampleRatio
}

func quotaProbeDBLockPeakWaiters(run quotaProbeRunResult) int64 {
	if run.DBLockSamples > 0 {
		return run.DBLockPeakWaiters
	}
	return run.AdvisoryPeakWaiters
}

func findQuotaProbeRun(runs []quotaProbeRunResult, scenario string, concurrency int, repetition int) (quotaProbeRunResult, bool) {
	for _, run := range runs {
		if run.Scenario == scenario && run.Concurrency == concurrency && run.Repetition == repetition {
			return run, true
		}
	}
	return quotaProbeRunResult{}, false
}

func quotaProbeRatio(numerator float64, denominator float64) float64 {
	if denominator == 0 {
		return 0
	}
	return numerator / denominator
}

func maxFloat(left float64, right float64) float64 {
	if left > right {
		return left
	}
	return right
}

func writeQuotaProbeArtifacts(outputDir string, report quotaProbeReport) error {
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return err
	}
	jsonBytes, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(outputDir, "summary.json"), append(jsonBytes, '\n'), 0o644); err != nil {
		return err
	}
	csvFile, err := os.Create(filepath.Join(outputDir, "results.csv"))
	if err != nil {
		return err
	}
	writer := csv.NewWriter(csvFile)
	header := []string{
		"scenario", "concurrency", "repetition", "operations", "successes", "errors", "throughput_ops_s",
		"begin_p50_ms", "begin_p95_ms", "begin_p99_ms", "settle_p50_ms", "settle_p95_ms", "settle_p99_ms",
		"pool_acquire_total_ms", "pool_empty_acquire_count", "advisory_samples", "advisory_waiting_samples",
		"advisory_wait_sample_ratio", "advisory_peak_waiters", "non_advisory_waiting_samples",
		"non_advisory_wait_sample_ratio", "non_advisory_peak_waiters", "db_lock_samples",
		"db_lock_waiting_samples", "db_lock_wait_sample_ratio", "db_lock_peak_waiters", "lock_wait_event_samples",
		"reserved_tokens_remaining", "confirmed_tokens",
		"settlement_ledger_rows", "distinct_settlement_rows", "correctness_violation",
	}
	if err := writer.Write(header); err != nil {
		_ = csvFile.Close()
		return err
	}
	for _, run := range report.Runs {
		waitEventJSON, err := json.Marshal(run.LockWaitEventSamples)
		if err != nil {
			_ = csvFile.Close()
			return err
		}
		record := []string{
			run.Scenario, strconv.Itoa(run.Concurrency), strconv.Itoa(run.Repetition), strconv.Itoa(run.Operations),
			strconv.Itoa(run.Successes), strconv.Itoa(run.Errors), formatQuotaProbeFloat(run.ThroughputOpsPerSecond),
			formatQuotaProbeFloat(run.BeginP50Ms), formatQuotaProbeFloat(run.BeginP95Ms), formatQuotaProbeFloat(run.BeginP99Ms),
			formatQuotaProbeFloat(run.SettleP50Ms), formatQuotaProbeFloat(run.SettleP95Ms), formatQuotaProbeFloat(run.SettleP99Ms),
			formatQuotaProbeFloat(run.PoolAcquireTotalMs), strconv.FormatInt(run.PoolEmptyAcquireCount, 10),
			strconv.FormatInt(run.AdvisorySamples, 10), strconv.FormatInt(run.AdvisoryWaitingSamples, 10),
			formatQuotaProbeFloat(run.AdvisoryWaitSampleRatio), strconv.FormatInt(run.AdvisoryPeakWaiters, 10),
			strconv.FormatInt(run.NonAdvisoryWaitingSamples, 10), formatQuotaProbeFloat(run.NonAdvisoryWaitSampleRatio),
			strconv.FormatInt(run.NonAdvisoryPeakWaiters, 10), strconv.FormatInt(run.DBLockSamples, 10),
			strconv.FormatInt(run.DBLockWaitingSamples, 10), formatQuotaProbeFloat(run.DBLockWaitSampleRatio),
			strconv.FormatInt(run.DBLockPeakWaiters, 10), string(waitEventJSON),
			strconv.FormatInt(run.ReservedTokensRemaining, 10), strconv.FormatInt(run.ConfirmedTokens, 10),
			strconv.FormatInt(run.SettlementLedgerRows, 10), strconv.FormatInt(run.DistinctSettlementRows, 10),
			strconv.FormatBool(run.CorrectnessViolation),
		}
		if err := writer.Write(record); err != nil {
			_ = csvFile.Close()
			return err
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		_ = csvFile.Close()
		return err
	}
	if err := csvFile.Close(); err != nil {
		return err
	}

	var summary strings.Builder
	fmt.Fprintf(&summary, "# Tenant Chat Token Quota Contention Probe\n\n")
	fmt.Fprintf(&summary, "- Decision: `%s`\n", report.Decision)
	fmt.Fprintf(&summary, "- Baseline commit: `%s`\n", report.Metadata.Commit)
	fmt.Fprintf(&summary, "- PostgreSQL: `%s`\n", report.Metadata.PostgresVersion)
	fmt.Fprintf(&summary, "- Go: `%s`\n", report.Metadata.GoVersion)
	fmt.Fprintf(&summary, "- Pool: `%d`, operations/run: `%d`, repetitions: `%d`\n\n",
		report.Metadata.PoolSize, report.Metadata.Operations, report.Metadata.Repetitions)
	fmt.Fprintf(&summary, "## Decision evidence\n\n")
	for _, reason := range report.Reasons {
		fmt.Fprintf(&summary, "- %s\n", reason)
	}
	fmt.Fprintf(&summary, "\n## Correctness\n\n")
	fmt.Fprintf(&summary, "| Check | Violation | Detail |\n|---|---:|---|\n")
	for _, check := range report.Correctness {
		fmt.Fprintf(&summary, "| %s | %t | %s |\n", check.Name, check.Violation, strings.ReplaceAll(check.Detail, "|", "\\|"))
	}
	fmt.Fprintf(&summary, "\n## Runs\n\n")
	fmt.Fprintf(&summary, "| Scenario | C | Run | Begin p95 ms | Settle p95 ms | Ops/s | Advisory wait ratio | Non-advisory wait ratio | DB lock wait ratio | Wait events | Errors |\n")
	fmt.Fprintf(&summary, "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|\n")
	for _, run := range report.Runs {
		fmt.Fprintf(&summary, "| %s | %d | %d | %.2f | %.2f | %.2f | %.4f | %.4f | %.4f | %s | %d |\n",
			run.Scenario, run.Concurrency, run.Repetition, run.BeginP95Ms, run.SettleP95Ms,
			run.ThroughputOpsPerSecond, run.AdvisoryWaitSampleRatio, run.NonAdvisoryWaitSampleRatio,
			run.DBLockWaitSampleRatio, formatQuotaProbeWaitEvents(run.LockWaitEventSamples), run.Errors)
	}
	return os.WriteFile(filepath.Join(outputDir, "summary.md"), []byte(summary.String()), 0o644)
}

func formatQuotaProbeWaitEvents(samples map[string]int64) string {
	if len(samples) == 0 {
		return "-"
	}
	events := make([]string, 0, len(samples))
	for event := range samples {
		events = append(events, event)
	}
	sort.Strings(events)
	parts := make([]string, 0, len(events))
	for _, event := range events {
		parts = append(parts, fmt.Sprintf("%s=%d", event, samples[event]))
	}
	return strings.Join(parts, ", ")
}

func formatQuotaProbeFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', 6, 64)
}
