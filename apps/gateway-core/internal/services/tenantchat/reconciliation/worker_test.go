package reconciliation

import (
	"context"
	"testing"
	"time"
)

type fakeStore struct {
	remaining int
	calls     int
	cutoff    time.Time
	err       error
}

func (f *fakeStore) ReconcileNextPending(_ context.Context, cutoff time.Time) (bool, error) {
	f.calls++
	f.cutoff = cutoff
	if f.err != nil {
		return false, f.err
	}
	if f.remaining == 0 {
		return false, nil
	}
	f.remaining--
	return true, nil
}

func TestWorkerProcessesBoundedPendingRowsAtFifteenMinuteCutoff(t *testing.T) {
	store := &fakeStore{remaining: 2}
	worker := NewWorker(store)
	now := time.Date(2026, 7, 13, 12, 30, 0, 0, time.UTC)
	worker.now = func() time.Time { return now }
	worker.batchSize = 3
	if err := worker.Process(context.Background()); err != nil {
		t.Fatalf("process pending usage: %v", err)
	}
	if store.calls != 3 || !store.cutoff.Equal(now.Add(-15*time.Minute)) {
		t.Fatalf("unexpected bounded worker calls=%d cutoff=%s", store.calls, store.cutoff)
	}
}
