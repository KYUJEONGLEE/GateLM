package cached

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
)

func TestProviderReturnsFreshCachedSnapshot(t *testing.T) {
	now := time.Unix(100, 0).UTC()
	delegate := newFakeSnapshotProvider(snapshotVersion(1), snapshotVersion(2))
	provider := NewProvider(delegate, Config{
		FreshTTL: time.Minute,
		StaleTTL: time.Minute,
		Now:      func() time.Time { return now },
	})

	first, err := provider.GetExecutionSnapshot(context.Background(), "tenant", "project", "app")
	if err != nil {
		t.Fatalf("first snapshot: %v", err)
	}
	second, err := provider.GetExecutionSnapshot(context.Background(), "tenant", "project", "app")
	if err != nil {
		t.Fatalf("second snapshot: %v", err)
	}

	if first.Snapshot.RuntimeSnapshotVersion != 1 || second.Snapshot.RuntimeSnapshotVersion != 1 {
		t.Fatalf("expected cached version 1, got first=%d second=%d", first.Snapshot.RuntimeSnapshotVersion, second.Snapshot.RuntimeSnapshotVersion)
	}
	if delegate.callCount() != 1 {
		t.Fatalf("expected delegate to be called once, got %d", delegate.callCount())
	}
}

func TestProviderSingleflightsColdMiss(t *testing.T) {
	now := time.Unix(100, 0).UTC()
	block := make(chan struct{})
	delegate := newFakeSnapshotProvider(snapshotVersion(1))
	delegate.block = block
	delegate.started = make(chan int, 1)
	provider := NewProvider(delegate, Config{
		FreshTTL: time.Minute,
		StaleTTL: time.Minute,
		Now:      func() time.Time { return now },
	})

	const workers = 16
	var wg sync.WaitGroup
	results := make(chan runtimeconfig.ExecutionSnapshot, workers)
	errs := make(chan error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			snapshot, err := provider.GetExecutionSnapshot(context.Background(), "tenant", "project", "app")
			if err != nil {
				errs <- err
				return
			}
			results <- snapshot
		}()
	}

	<-delegate.started
	close(block)
	wg.Wait()
	close(results)
	close(errs)

	for err := range errs {
		t.Fatalf("unexpected error: %v", err)
	}
	for snapshot := range results {
		if snapshot.Snapshot.RuntimeSnapshotVersion != 1 {
			t.Fatalf("expected version 1, got %d", snapshot.Snapshot.RuntimeSnapshotVersion)
		}
	}
	if delegate.callCount() != 1 {
		t.Fatalf("expected one delegate call, got %d", delegate.callCount())
	}
}

func TestProviderColdMissCancellationDoesNotPoisonSharedFlight(t *testing.T) {
	now := time.Unix(100, 0).UTC()
	block := make(chan struct{})
	delegate := newFakeSnapshotProvider(snapshotVersion(1))
	delegate.block = block
	delegate.started = make(chan int, 1)
	provider := NewProvider(delegate, Config{
		FreshTTL: time.Minute,
		StaleTTL: time.Minute,
		Now:      func() time.Time { return now },
	})

	firstCtx, cancelFirst := context.WithCancel(context.Background())
	firstErr := make(chan error, 1)
	go func() {
		_, err := provider.GetExecutionSnapshot(firstCtx, "tenant", "project", "app")
		firstErr <- err
	}()

	<-delegate.started
	cancelFirst()
	select {
	case err := <-firstErr:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected first caller cancellation, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for first caller cancellation")
	}

	type result struct {
		snapshot runtimeconfig.ExecutionSnapshot
		err      error
	}
	second := make(chan result, 1)
	go func() {
		snapshot, err := provider.GetExecutionSnapshot(context.Background(), "tenant", "project", "app")
		second <- result{snapshot: snapshot, err: err}
	}()

	close(block)
	select {
	case got := <-second:
		if got.err != nil {
			t.Fatalf("second caller should not receive first caller cancellation: %v", got.err)
		}
		if got.snapshot.Snapshot.RuntimeSnapshotVersion != 1 {
			t.Fatalf("expected version 1, got %d", got.snapshot.Snapshot.RuntimeSnapshotVersion)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for second caller")
	}
	if delegate.callCount() != 1 {
		t.Fatalf("expected original background flight to fill cache once, got %d delegate calls", delegate.callCount())
	}
}

func TestProviderReturnsStaleSnapshotWhileRefreshing(t *testing.T) {
	now := time.Unix(100, 0).UTC()
	delegate := newFakeSnapshotProvider(snapshotVersion(1), snapshotVersion(2))
	provider := NewProvider(delegate, Config{
		FreshTTL: time.Second,
		StaleTTL: time.Minute,
		Now:      func() time.Time { return now },
	})

	if _, err := provider.GetExecutionSnapshot(context.Background(), "tenant", "project", "app"); err != nil {
		t.Fatalf("prime cache: %v", err)
	}

	now = now.Add(2 * time.Second)
	block := make(chan struct{})
	delegate.block = block
	delegate.started = make(chan int, 1)
	delegate.completed = make(chan int, 1)

	stale, err := provider.GetExecutionSnapshot(context.Background(), "tenant", "project", "app")
	if err != nil {
		t.Fatalf("stale snapshot: %v", err)
	}
	if stale.Snapshot.RuntimeSnapshotVersion != 1 || stale.Snapshot.RuntimeState != runtimeconfig.RuntimeStateStaleSnapshotUsed {
		t.Fatalf("expected stale version 1, got version=%d state=%s", stale.Snapshot.RuntimeSnapshotVersion, stale.Snapshot.RuntimeState)
	}

	<-delegate.started
	close(block)
	<-delegate.completed

	refreshed, err := provider.GetExecutionSnapshot(context.Background(), "tenant", "project", "app")
	if err != nil {
		t.Fatalf("refreshed snapshot: %v", err)
	}
	if refreshed.Snapshot.RuntimeSnapshotVersion != 2 || refreshed.Snapshot.RuntimeState != runtimeconfig.RuntimeStateSnapshotActive {
		t.Fatalf("expected refreshed active version 2, got version=%d state=%s", refreshed.Snapshot.RuntimeSnapshotVersion, refreshed.Snapshot.RuntimeState)
	}
	if delegate.callCount() != 2 {
		t.Fatalf("expected two delegate calls, got %d", delegate.callCount())
	}
}

func TestProviderDoesNotUseExpiredStaleSnapshot(t *testing.T) {
	now := time.Unix(100, 0).UTC()
	delegate := newFakeSnapshotProvider(snapshotVersion(1))
	provider := NewProvider(delegate, Config{
		FreshTTL: time.Second,
		StaleTTL: time.Second,
		Now:      func() time.Time { return now },
	})

	if _, err := provider.GetExecutionSnapshot(context.Background(), "tenant", "project", "app"); err != nil {
		t.Fatalf("prime cache: %v", err)
	}

	expectedErr := errors.New("control plane unavailable")
	delegate.setErr(expectedErr)
	now = now.Add(3 * time.Second)

	_, err := provider.GetExecutionSnapshot(context.Background(), "tenant", "project", "app")
	if !errors.Is(err, expectedErr) {
		t.Fatalf("expected refresh error after stale expiry, got %v", err)
	}
}

type fakeSnapshotProvider struct {
	mu        sync.Mutex
	calls     int
	snapshots []runtimeconfig.ExecutionSnapshot
	err       error
	block     <-chan struct{}
	started   chan int
	completed chan int
}

func newFakeSnapshotProvider(snapshots ...runtimeconfig.ExecutionSnapshot) *fakeSnapshotProvider {
	return &fakeSnapshotProvider{snapshots: snapshots}
}

func (p *fakeSnapshotProvider) GetExecutionSnapshot(ctx context.Context, tenantID string, projectID string, applicationID string) (runtimeconfig.ExecutionSnapshot, error) {
	p.mu.Lock()
	p.calls++
	call := p.calls
	err := p.err
	block := p.block
	started := p.started
	completed := p.completed
	snapshot := p.snapshots[len(p.snapshots)-1]
	if call <= len(p.snapshots) {
		snapshot = p.snapshots[call-1]
	}
	p.mu.Unlock()

	if started != nil {
		started <- call
	}
	if block != nil {
		select {
		case <-block:
		case <-ctx.Done():
			return runtimeconfig.ExecutionSnapshot{}, ctx.Err()
		}
	}
	if completed != nil {
		defer func() { completed <- call }()
	}
	if err != nil {
		return runtimeconfig.ExecutionSnapshot{}, err
	}
	return snapshot, nil
}

func (p *fakeSnapshotProvider) callCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.calls
}

func (p *fakeSnapshotProvider) setErr(err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.err = err
}

func snapshotVersion(version int) runtimeconfig.ExecutionSnapshot {
	return runtimeconfig.ExecutionSnapshot{
		ConfigHash:    "hash_config",
		TenantID:      "tenant",
		ProjectID:     "project",
		ApplicationID: "app",
		Snapshot: runtimeconfig.RuntimeSnapshotProvenance{
			RuntimeSnapshotID:      "runtime_snapshot_test",
			RuntimeSnapshotVersion: version,
			RuntimeState:           runtimeconfig.RuntimeStateSnapshotActive,
		},
		SafetyPolicy: runtimeconfig.SafetyPolicy{
			SecurityPolicyHash: "hash_security",
		},
		RoutingPolicy: runtimeconfig.RoutingPolicy{
			DefaultProvider:   "mock",
			DefaultModel:      "mock-balanced",
			RoutingPolicyHash: "hash_routing",
		},
		PromptCapture:   runtimeconfig.DefaultPromptCapturePolicy(),
		ResponseCapture: runtimeconfig.DefaultResponseCapturePolicy(),
	}
}
