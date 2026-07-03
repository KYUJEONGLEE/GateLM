package asyncwriter

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/metrics"
)

const (
	defaultQueueSize    = 1024
	defaultWorkerCount  = 2
	defaultWriteTimeout = 2 * time.Second
	operationTerminal   = "terminal"
	statusSuccess       = "success"
	statusError         = "error"
	statusPanic         = "panic"
	statusQueueFull     = "queue_full"
	statusClosed        = "closed"
)

var (
	ErrQueueFull = errors.New("async terminal log queue is full")
	ErrClosed    = errors.New("async terminal log writer is closed")
)

type TerminalLogWriterConfig struct {
	QueueSize       int
	WorkerCount     int
	WriteTimeout    time.Duration
	MetricsRegistry *metrics.Registry
}

type TerminalLogWriter struct {
	delegate     invocationlog.TerminalLogWriter
	queue        chan invocationlog.TerminalLog
	workerCount  int
	writeTimeout time.Duration
	registry     *metrics.Registry
	done         chan struct{}
	wg           sync.WaitGroup
	mu           sync.RWMutex
	closed       bool
	closeOnce    sync.Once
}

func NewTerminalLogWriter(delegate invocationlog.TerminalLogWriter, cfg TerminalLogWriterConfig) *TerminalLogWriter {
	if delegate == nil {
		delegate = invocationlog.NoopTerminalLogWriter{}
	}
	queueSize := cfg.QueueSize
	if queueSize <= 0 {
		queueSize = defaultQueueSize
	}
	workerCount := cfg.WorkerCount
	if workerCount <= 0 {
		workerCount = defaultWorkerCount
	}
	writeTimeout := cfg.WriteTimeout
	if writeTimeout <= 0 {
		writeTimeout = defaultWriteTimeout
	}
	writer := &TerminalLogWriter{
		delegate:     delegate,
		queue:        make(chan invocationlog.TerminalLog, queueSize),
		workerCount:  workerCount,
		writeTimeout: writeTimeout,
		registry:     cfg.MetricsRegistry,
		done:         make(chan struct{}),
	}
	writer.recordQueueDepth()
	for i := 0; i < writer.workerCount; i++ {
		writer.wg.Add(1)
		go writer.runWorker(i + 1)
	}
	go func() {
		writer.wg.Wait()
		writer.recordQueueDepth()
		close(writer.done)
	}()
	return writer
}

func (w *TerminalLogWriter) WriteTerminalLog(ctx context.Context, entry invocationlog.TerminalLog) error {
	if w == nil {
		return errors.New("async terminal log writer is nil")
	}
	startedAt := time.Now()
	w.mu.RLock()
	defer w.mu.RUnlock()
	if w.closed {
		w.recordEnqueue(statusClosed, time.Since(startedAt))
		w.recordDrop(statusClosed)
		return ErrClosed
	}
	select {
	case w.queue <- entry:
		w.recordEnqueue(statusSuccess, time.Since(startedAt))
		w.recordQueueDepth()
		return nil
	default:
		w.recordEnqueue(statusQueueFull, time.Since(startedAt))
		w.recordDrop(statusQueueFull)
		return ErrQueueFull
	}
}

func (w *TerminalLogWriter) Close(ctx context.Context) error {
	if w == nil {
		return nil
	}
	w.closeOnce.Do(func() {
		w.mu.Lock()
		w.closed = true
		close(w.queue)
		w.mu.Unlock()
	})
	select {
	case <-w.done:
		w.recordQueueDepth()
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (w *TerminalLogWriter) runWorker(workerID int) {
	defer w.wg.Done()
	for entry := range w.queue {
		w.recordQueueDepth()
		w.persist(workerID, entry)
	}
}

func (w *TerminalLogWriter) persist(workerID int, entry invocationlog.TerminalLog) {
	startedAt := time.Now()
	status := statusSuccess
	defer func() {
		if recovered := recover(); recovered != nil {
			status = statusPanic
			log.Printf("async terminal invocation log worker panicked worker_id=%d request_id=%s status=%s cause=%v", workerID, entry.RequestID, entry.Status, recovered)
		}
		w.recordPersist(status, time.Since(startedAt))
	}()

	ctx := context.Background()
	cancel := func() {}
	if w.writeTimeout > 0 {
		ctx, cancel = context.WithTimeout(ctx, w.writeTimeout)
	}
	defer cancel()

	if err := w.delegate.WriteTerminalLog(ctx, entry); err != nil {
		status = statusError
		log.Printf("async terminal invocation log persist failed worker_id=%d request_id=%s status=%s cause=%q", workerID, entry.RequestID, entry.Status, err.Error())
	}
}

func (w *TerminalLogWriter) recordEnqueue(status string, duration time.Duration) {
	if w.registry == nil {
		return
	}
	w.registry.AsyncLogEnqueue(metrics.AsyncLogEvent{
		Operation:       operationTerminal,
		Status:          status,
		DurationSeconds: duration.Seconds(),
	})
}

func (w *TerminalLogWriter) recordPersist(status string, duration time.Duration) {
	if w.registry == nil {
		return
	}
	w.registry.AsyncLogPersist(metrics.AsyncLogEvent{
		Operation:       operationTerminal,
		Status:          status,
		DurationSeconds: duration.Seconds(),
	})
}

func (w *TerminalLogWriter) recordDrop(status string) {
	if w.registry == nil {
		return
	}
	w.registry.AsyncLogDropped(operationTerminal, status)
}

func (w *TerminalLogWriter) recordQueueDepth() {
	if w.registry == nil {
		return
	}
	w.registry.AsyncLogQueueDepth(operationTerminal, len(w.queue))
}
