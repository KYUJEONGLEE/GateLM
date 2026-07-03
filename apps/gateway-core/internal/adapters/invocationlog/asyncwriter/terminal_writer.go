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
	defaultWriteTimeout = 2 * time.Second
	operationTerminal   = "terminal"
	statusSuccess       = "success"
	statusError         = "error"
	statusQueueFull     = "queue_full"
	statusClosed        = "closed"
)

var (
	ErrQueueFull = errors.New("async terminal log queue is full")
	ErrClosed    = errors.New("async terminal log writer is closed")
)

type TerminalLogWriterConfig struct {
	QueueSize       int
	WriteTimeout    time.Duration
	MetricsRegistry *metrics.Registry
}

type TerminalLogWriter struct {
	delegate     invocationlog.TerminalLogWriter
	queue        chan invocationlog.TerminalLog
	writeTimeout time.Duration
	registry     *metrics.Registry
	done         chan struct{}
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
	writeTimeout := cfg.WriteTimeout
	if writeTimeout <= 0 {
		writeTimeout = defaultWriteTimeout
	}
	writer := &TerminalLogWriter{
		delegate:     delegate,
		queue:        make(chan invocationlog.TerminalLog, queueSize),
		writeTimeout: writeTimeout,
		registry:     cfg.MetricsRegistry,
		done:         make(chan struct{}),
	}
	writer.recordQueueDepth()
	go writer.run()
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

func (w *TerminalLogWriter) run() {
	defer close(w.done)
	for entry := range w.queue {
		w.recordQueueDepth()
		startedAt := time.Now()
		ctx := context.Background()
		cancel := func() {}
		if w.writeTimeout > 0 {
			ctx, cancel = context.WithTimeout(ctx, w.writeTimeout)
		}
		err := w.delegate.WriteTerminalLog(ctx, entry)
		cancel()
		status := statusSuccess
		if err != nil {
			status = statusError
			log.Printf("async terminal invocation log persist failed request_id=%s status=%s cause=%q", entry.RequestID, entry.Status, err.Error())
		}
		w.recordPersist(status, time.Since(startedAt))
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
