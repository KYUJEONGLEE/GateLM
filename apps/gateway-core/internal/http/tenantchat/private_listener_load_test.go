package tenantchat

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/adapters/tenantchat/workloadauth"
	domain "gatelm/apps/gateway-core/internal/domain/tenantchat"
	completionservice "gatelm/apps/gateway-core/internal/services/tenantchat/completion"
)

type loadAuthenticator struct{}

func (loadAuthenticator) Authenticate(
	context.Context,
	string,
	domain.Phase,
	domain.RequestContext,
	any,
) (workloadauth.VerifiedToken, error) {
	return workloadauth.VerifiedToken{}, nil
}

type loadAdmissionService struct{}

func (loadAdmissionService) Admit(context.Context, domain.RequestContext) (domain.Admission, error) {
	return domain.Admission{}, nil
}

func (loadAdmissionService) Cancel(context.Context, domain.RequestContext) (domain.AdmissionCancellation, error) {
	return domain.AdmissionCancellation{}, nil
}

type loadCompletionService struct{}

func (loadCompletionService) Prepare(
	context.Context,
	domain.CompletionRequest,
) (completionservice.Execution, error) {
	replayed := false
	modelKey := "model-synthetic"
	return &fakeCompletionExecution{events: []domain.CompletionEvent{
		{
			Type: domain.CompletionEventDelta, SchemaVersion: 1,
			RequestID: "request_load_001", TurnID: "turn_load_001", Sequence: 1,
			Delta: "synthetic response",
		},
		{
			Type: domain.CompletionEventFinal, SchemaVersion: 1,
			RequestID: "request_load_001", TurnID: "turn_load_001", Sequence: 2,
			TerminalOutcome: "succeeded", EffectiveModelKey: &modelKey,
			Usage:      &domain.CompletionUsage{UsageQuality: "confirmed"},
			QuotaState: "normal", BudgetState: "normal", CacheOutcome: "off", Replayed: &replayed,
		},
	}}, nil
}

func TestDeterministicPrivateListenerLoadSmoke(t *testing.T) {
	const (
		requestCount = 48
		concurrency  = 6
	)
	server := httptest.NewServer(NewRouter(
		loadAuthenticator{}, loadAdmissionService{}, 64*1024,
		WithCompletionService(loadCompletionService{}),
	))
	defer server.Close()

	payload, err := json.Marshal(domain.CompletionRequest{
		Context: domain.RequestContext{
			Phase: domain.PhaseCompletion, RequestID: "request_load_001", TurnID: "turn_load_001",
		},
		Input: domain.CompletionInput{
			Messages: []domain.EphemeralMessage{{Role: "user", Content: "synthetic prompt"}}, Stream: true,
		},
	})
	if err != nil {
		t.Fatalf("encode deterministic load payload: %v", err)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	jobs := make(chan struct{}, requestCount)
	results := make(chan error, requestCount)
	latencies := make([]time.Duration, 0, requestCount)
	var latencyMu sync.Mutex
	var workers sync.WaitGroup
	for index := 0; index < concurrency; index++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for range jobs {
				started := time.Now()
				request, requestErr := http.NewRequest(
					http.MethodPost,
					server.URL+"/internal/v1/tenant-chat/completions",
					bytes.NewReader(payload),
				)
				if requestErr != nil {
					results <- requestErr
					continue
				}
				request.Header.Set("Content-Type", "application/json")
				request.Header.Set("Authorization", "Bearer synthetic-workload-token")
				response, requestErr := client.Do(request)
				if requestErr != nil {
					results <- requestErr
					continue
				}
				body, readErr := io.ReadAll(response.Body)
				_ = response.Body.Close()
				latencyMu.Lock()
				latencies = append(latencies, time.Since(started))
				latencyMu.Unlock()
				if readErr != nil {
					results <- readErr
					continue
				}
				if response.StatusCode != http.StatusOK || !strings.Contains(string(body), "event: tenant_chat.final") {
					results <- fmt.Errorf("private completion smoke status=%d", response.StatusCode)
					continue
				}
				results <- nil
			}
		}()
	}
	for index := 0; index < requestCount; index++ {
		jobs <- struct{}{}
	}
	close(jobs)
	workers.Wait()
	close(results)
	for result := range results {
		if result != nil {
			t.Fatalf("private listener load smoke: %v", result)
		}
	}
	if len(latencies) != requestCount {
		t.Fatalf("private listener load smoke completed %d/%d requests", len(latencies), requestCount)
	}
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	p95 := latencies[(requestCount*95+99)/100-1]
	t.Logf("deterministic private listener concurrency=%d requests=%d p95=%s", concurrency, requestCount, p95)
	if p95 > 5*time.Second {
		t.Fatalf("private listener deterministic p95 exceeded smoke bound: %s", p95)
	}
}
