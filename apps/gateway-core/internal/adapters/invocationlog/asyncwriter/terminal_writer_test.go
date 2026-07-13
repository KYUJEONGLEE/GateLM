package asyncwriter

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/metrics"
)

func TestTerminalLogWriterFlushesQueuedLogsOnClose(t *testing.T) {
	delegate := &recordingTerminalLogWriter{}
	registry := metrics.NewRegistry()
	writer := NewTerminalLogWriter(delegate, TerminalLogWriterConfig{
		QueueSize:       2,
		WorkerCount:     2,
		WriteTimeout:    time.Second,
		MetricsRegistry: registry,
	})

	if err := writer.WriteTerminalLog(context.Background(), invocationlog.TerminalLog{RequestID: "request_async_1", Status: invocationlog.StatusSuccess}); err != nil {
		t.Fatalf("enqueue first log: %v", err)
	}
	if err := writer.WriteTerminalLog(context.Background(), invocationlog.TerminalLog{RequestID: "request_async_2", Status: invocationlog.StatusSuccess}); err != nil {
		t.Fatalf("enqueue second log: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := writer.Close(ctx); err != nil {
		t.Fatalf("close async writer: %v", err)
	}

	if got := delegate.count(); got != 2 {
		t.Fatalf("expected 2 persisted logs, got %d", got)
	}
	output := registry.RenderPrometheus()
	assertAsyncMetricsContains(t, output, `gatelm_async_log_enqueue_total{operation="terminal",status="success"} 2`)
	assertAsyncMetricsContains(t, output, `gatelm_async_log_persist_total{operation="terminal",status="success"} 2`)
	assertAsyncMetricsContains(t, output, `gatelm_async_log_queue_depth{operation="terminal"} 0`)
}

func TestTerminalLogWriterPersistsFullBatchWithOneDelegateCall(t *testing.T) {
	delegate := &recordingBatchTerminalLogWriter{}
	registry := metrics.NewRegistry()
	writer := NewTerminalLogWriter(delegate, TerminalLogWriterConfig{
		QueueSize:       3,
		WorkerCount:     1,
		BatchSize:       3,
		FlushInterval:   time.Second,
		WriteTimeout:    time.Second,
		MetricsRegistry: registry,
	})

	for index := 1; index <= 3; index++ {
		entry := invocationlog.TerminalLog{
			RequestID: fmt.Sprintf("request_async_batch_%d", index),
			Status:    invocationlog.StatusSuccess,
		}
		if err := writer.WriteTerminalLog(context.Background(), entry); err != nil {
			t.Fatalf("enqueue batch item %d: %v", index, err)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := writer.Close(ctx); err != nil {
		t.Fatalf("close async writer: %v", err)
	}

	if got := delegate.batchCount(); got != 1 {
		t.Fatalf("expected one batch delegate call, got %d", got)
	}
	if got := delegate.singleCount(); got != 0 {
		t.Fatalf("expected no single delegate calls, got %d", got)
	}
	if got := delegate.recordCount(); got != 3 {
		t.Fatalf("expected 3 batched records, got %d", got)
	}
	output := registry.RenderPrometheus()
	assertAsyncMetricsContains(t, output, `gatelm_async_log_persist_total{operation="terminal",status="success"} 3`)
	assertAsyncMetricsContains(t, output, `gatelm_async_log_persist_duration_seconds_count{operation="terminal",status="success"} 1`)
}

func TestTerminalLogWriterFlushesPartialBatchAfterInterval(t *testing.T) {
	delegate := &recordingBatchTerminalLogWriter{batchDone: make(chan struct{}, 1)}
	writer := NewTerminalLogWriter(delegate, TerminalLogWriterConfig{
		QueueSize:     2,
		WorkerCount:   1,
		BatchSize:     10,
		FlushInterval: 10 * time.Millisecond,
		WriteTimeout:  time.Second,
	})

	for index := 1; index <= 2; index++ {
		if err := writer.WriteTerminalLog(context.Background(), invocationlog.TerminalLog{
			RequestID: fmt.Sprintf("request_async_partial_%d", index),
			Status:    invocationlog.StatusSuccess,
		}); err != nil {
			t.Fatalf("enqueue partial batch item %d: %v", index, err)
		}
	}

	select {
	case <-delegate.batchDone:
	case <-time.After(time.Second):
		t.Fatal("partial batch was not flushed after the configured interval")
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := writer.Close(ctx); err != nil {
		t.Fatalf("close async writer: %v", err)
	}
	if got := delegate.recordCount(); got != 2 {
		t.Fatalf("expected 2 partial-batch records, got %d", got)
	}
}

func TestTerminalLogWriterRetriesFailedBatchIndividually(t *testing.T) {
	delegate := &recordingBatchTerminalLogWriter{batchErr: errors.New("synthetic batch failure")}
	registry := metrics.NewRegistry()
	writer := NewTerminalLogWriter(delegate, TerminalLogWriterConfig{
		QueueSize:       2,
		WorkerCount:     1,
		BatchSize:       2,
		FlushInterval:   time.Second,
		WriteTimeout:    time.Second,
		MetricsRegistry: registry,
	})

	for index := 1; index <= 2; index++ {
		if err := writer.WriteTerminalLog(context.Background(), invocationlog.TerminalLog{
			RequestID: fmt.Sprintf("request_async_retry_%d", index),
			Status:    invocationlog.StatusSuccess,
		}); err != nil {
			t.Fatalf("enqueue retry item %d: %v", index, err)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := writer.Close(ctx); err != nil {
		t.Fatalf("close async writer: %v", err)
	}

	if got := delegate.batchCount(); got != 1 {
		t.Fatalf("expected one failed batch call, got %d", got)
	}
	if got := delegate.singleCount(); got != 2 {
		t.Fatalf("expected two individual retries, got %d", got)
	}
	output := registry.RenderPrometheus()
	assertAsyncMetricsContains(t, output, `gatelm_async_log_persist_total{operation="terminal",status="success"} 2`)
}

func TestTerminalLogWriterDropsWhenQueueIsFull(t *testing.T) {
	delegate := &blockingTerminalLogWriter{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	registry := metrics.NewRegistry()
	writer := NewTerminalLogWriter(delegate, TerminalLogWriterConfig{
		QueueSize:       1,
		WorkerCount:     1,
		WriteTimeout:    time.Second,
		MetricsRegistry: registry,
	})

	if err := writer.WriteTerminalLog(context.Background(), invocationlog.TerminalLog{RequestID: "request_async_blocked", Status: invocationlog.StatusSuccess}); err != nil {
		t.Fatalf("enqueue blocking log: %v", err)
	}
	<-delegate.started
	if err := writer.WriteTerminalLog(context.Background(), invocationlog.TerminalLog{RequestID: "request_async_queued", Status: invocationlog.StatusSuccess}); err != nil {
		t.Fatalf("enqueue queued log: %v", err)
	}
	if err := writer.WriteTerminalLog(context.Background(), invocationlog.TerminalLog{RequestID: "request_async_dropped", Status: invocationlog.StatusSuccess}); !errors.Is(err, ErrQueueFull) {
		t.Fatalf("expected ErrQueueFull, got %v", err)
	}

	close(delegate.release)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := writer.Close(ctx); err != nil {
		t.Fatalf("close async writer: %v", err)
	}

	output := registry.RenderPrometheus()
	assertAsyncMetricsContains(t, output, `gatelm_async_log_enqueue_total{operation="terminal",status="queue_full"} 1`)
	assertAsyncMetricsContains(t, output, `gatelm_async_log_dropped_total{operation="terminal",status="queue_full"} 1`)
}

func TestTerminalLogWriterRecoversFromDelegatePanicAndContinues(t *testing.T) {
	delegate := &panicOnceTerminalLogWriter{}
	registry := metrics.NewRegistry()
	writer := NewTerminalLogWriter(delegate, TerminalLogWriterConfig{
		QueueSize:       2,
		WorkerCount:     1,
		WriteTimeout:    time.Second,
		MetricsRegistry: registry,
	})

	if err := writer.WriteTerminalLog(context.Background(), invocationlog.TerminalLog{RequestID: "request_async_panic", Status: invocationlog.StatusSuccess}); err != nil {
		t.Fatalf("enqueue panic log: %v", err)
	}
	if err := writer.WriteTerminalLog(context.Background(), invocationlog.TerminalLog{RequestID: "request_async_after_panic", Status: invocationlog.StatusSuccess}); err != nil {
		t.Fatalf("enqueue after-panic log: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := writer.Close(ctx); err != nil {
		t.Fatalf("close async writer: %v", err)
	}

	if got := delegate.successCount(); got != 1 {
		t.Fatalf("expected worker to continue and persist one log after panic, got %d", got)
	}
	output := registry.RenderPrometheus()
	assertAsyncMetricsContains(t, output, `gatelm_async_log_persist_total{operation="terminal",status="panic"} 1`)
	assertAsyncMetricsContains(t, output, `gatelm_async_log_persist_total{operation="terminal",status="success"} 1`)
}

func TestTerminalLogWriterRejectsAfterClose(t *testing.T) {
	registry := metrics.NewRegistry()
	writer := NewTerminalLogWriter(&recordingTerminalLogWriter{}, TerminalLogWriterConfig{
		QueueSize:       1,
		WorkerCount:     1,
		WriteTimeout:    time.Second,
		MetricsRegistry: registry,
	})

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := writer.Close(ctx); err != nil {
		t.Fatalf("close async writer: %v", err)
	}
	if err := writer.WriteTerminalLog(context.Background(), invocationlog.TerminalLog{RequestID: "request_after_close"}); !errors.Is(err, ErrClosed) {
		t.Fatalf("expected ErrClosed, got %v", err)
	}

	output := registry.RenderPrometheus()
	assertAsyncMetricsContains(t, output, `gatelm_async_log_enqueue_total{operation="terminal",status="closed"} 1`)
	assertAsyncMetricsContains(t, output, `gatelm_async_log_dropped_total{operation="terminal",status="closed"} 1`)
}

type recordingTerminalLogWriter struct {
	mu   sync.Mutex
	logs []invocationlog.TerminalLog
}

type recordingBatchTerminalLogWriter struct {
	mu         sync.Mutex
	batches    [][]invocationlog.TerminalLog
	singleLogs []invocationlog.TerminalLog
	batchErr   error
	batchDone  chan struct{}
}

func (w *recordingBatchTerminalLogWriter) WriteTerminalLog(_ context.Context, entry invocationlog.TerminalLog) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.singleLogs = append(w.singleLogs, entry)
	return nil
}

func (w *recordingBatchTerminalLogWriter) WriteTerminalLogs(_ context.Context, entries []invocationlog.TerminalLog) error {
	w.mu.Lock()
	w.batches = append(w.batches, append([]invocationlog.TerminalLog(nil), entries...))
	err := w.batchErr
	w.mu.Unlock()
	if w.batchDone != nil {
		select {
		case w.batchDone <- struct{}{}:
		default:
		}
	}
	return err
}

func (w *recordingBatchTerminalLogWriter) batchCount() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.batches)
}

func (w *recordingBatchTerminalLogWriter) singleCount() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.singleLogs)
}

func (w *recordingBatchTerminalLogWriter) recordCount() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	total := len(w.singleLogs)
	for _, batch := range w.batches {
		total += len(batch)
	}
	return total
}

func (w *recordingTerminalLogWriter) WriteTerminalLog(_ context.Context, log invocationlog.TerminalLog) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.logs = append(w.logs, log)
	return nil
}

func (w *recordingTerminalLogWriter) count() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.logs)
}

type blockingTerminalLogWriter struct {
	once    sync.Once
	started chan struct{}
	release chan struct{}
}

func (w *blockingTerminalLogWriter) WriteTerminalLog(ctx context.Context, _ invocationlog.TerminalLog) error {
	w.once.Do(func() { close(w.started) })
	select {
	case <-w.release:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

type panicOnceTerminalLogWriter struct {
	mu        sync.Mutex
	panicked  bool
	succeeded int
}

func (w *panicOnceTerminalLogWriter) WriteTerminalLog(_ context.Context, _ invocationlog.TerminalLog) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.panicked {
		w.panicked = true
		panic("synthetic terminal log panic")
	}
	w.succeeded++
	return nil
}

func (w *panicOnceTerminalLogWriter) successCount() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.succeeded
}

func assertAsyncMetricsContains(t *testing.T, output string, expected string) {
	t.Helper()
	if !strings.Contains(output, expected) {
		t.Fatalf("expected metrics output to contain %q\noutput:\n%s", expected, output)
	}
}
