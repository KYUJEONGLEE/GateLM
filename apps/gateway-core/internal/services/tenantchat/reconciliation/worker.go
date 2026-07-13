package reconciliation

import (
	"context"
	"time"

	"gatelm/apps/gateway-core/internal/domain/metrics"
)

const (
	defaultInterval   = 30 * time.Second
	defaultPendingAge = 15 * time.Minute
	defaultBatchSize  = 100
)

type store interface {
	ReconcileNextPending(ctx context.Context, cutoff time.Time) (bool, error)
}

type Worker struct {
	store      store
	interval   time.Duration
	pendingAge time.Duration
	batchSize  int
	now        func() time.Time
	metrics    *metrics.Registry
}

func (w *Worker) WithMetrics(registry *metrics.Registry) *Worker {
	if w != nil {
		w.metrics = registry
	}
	return w
}

func NewWorker(store store) *Worker {
	return &Worker{
		store: store, interval: defaultInterval, pendingAge: defaultPendingAge,
		batchSize: defaultBatchSize, now: time.Now,
	}
}

func (w *Worker) Run(ctx context.Context) {
	if w == nil || w.store == nil {
		return
	}
	_ = w.Process(ctx)
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = w.Process(ctx)
		}
	}
}

func (w *Worker) Process(ctx context.Context) error {
	if w == nil || w.store == nil || w.batchSize <= 0 || w.pendingAge <= 0 {
		return context.Canceled
	}
	cutoff := w.now().UTC().Add(-w.pendingAge)
	for index := 0; index < w.batchSize; index++ {
		processed, err := w.store.ReconcileNextPending(ctx, cutoff)
		if err != nil {
			w.record("error")
			return err
		}
		if !processed {
			w.record("idle")
			return nil
		}
		w.record("deadline_settled")
	}
	return nil
}

func (w *Worker) record(result string) {
	if w == nil || w.metrics == nil {
		return
	}
	w.metrics.AddCounter(
		metrics.TenantChatUsageReconciliationTotal,
		[]metrics.Label{{Name: "result", Value: result}}, 1,
	)
}
