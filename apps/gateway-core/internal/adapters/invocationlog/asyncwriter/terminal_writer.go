package asyncwriter

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/metrics"
)

const (
	defaultQueueSize     = 1024
	defaultWorkerCount   = 2
	defaultBatchSize     = 100
	defaultFlushInterval = 10 * time.Millisecond
	defaultWriteTimeout  = 2 * time.Second
	operationTerminal    = "terminal"
	statusSuccess        = "success"
	statusError          = "error"
	statusPanic          = "panic"
	statusQueueFull      = "queue_full"
	statusClosed         = "closed"
)

var (
	ErrQueueFull = errors.New("async terminal log queue is full")
	ErrClosed    = errors.New("async terminal log writer is closed")
)

type TerminalLogWriterConfig struct {
	QueueSize       int
	WorkerCount     int
	BatchSize       int
	FlushInterval   time.Duration
	WriteTimeout    time.Duration
	MetricsRegistry *metrics.Registry
}

type TerminalLogWriter struct {
	delegate      invocationlog.TerminalLogWriter
	queue         chan invocationlog.TerminalLog
	workerCount   int
	batchSize     int
	flushInterval time.Duration
	writeTimeout  time.Duration
	registry      *metrics.Registry
	done          chan struct{}
	wg            sync.WaitGroup
	mu            sync.RWMutex
	closed        bool
	closeOnce     sync.Once
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
	batchSize := cfg.BatchSize
	if batchSize <= 0 {
		batchSize = defaultBatchSize
	}
	flushInterval := cfg.FlushInterval
	if flushInterval <= 0 {
		flushInterval = defaultFlushInterval
	}
	writeTimeout := cfg.WriteTimeout
	if writeTimeout <= 0 {
		writeTimeout = defaultWriteTimeout
	}
	writer := &TerminalLogWriter{
		delegate:      delegate,
		queue:         make(chan invocationlog.TerminalLog, queueSize),
		workerCount:   workerCount,
		batchSize:     batchSize,
		flushInterval: flushInterval,
		writeTimeout:  writeTimeout,
		registry:      cfg.MetricsRegistry,
		done:          make(chan struct{}),
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
	batch := make([]invocationlog.TerminalLog, 0, w.batchSize)
	for {
		entry, ok := <-w.queue
		if !ok {
			return
		}
		w.recordQueueDepth()
		batch = append(batch[:0], entry)
		queueClosed := false

		if w.batchSize > 1 {
			timer := time.NewTimer(w.flushInterval)
		collect:
			for len(batch) < w.batchSize {
				select {
				case next, open := <-w.queue:
					if !open {
						queueClosed = true
						break collect
					}
					batch = append(batch, next)
					w.recordQueueDepth()
				case <-timer.C:
					break collect
				}
			}
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
		}

		w.persistBatch(workerID, batch)
		if queueClosed {
			return
		}
	}
}

func (w *TerminalLogWriter) persistBatch(workerID int, batch []invocationlog.TerminalLog) {
	if len(batch) == 0 {
		return
	}
	if len(batch) > 1 {
		if delegate, ok := w.delegate.(invocationlog.TerminalLogBatchWriter); ok {
			startedAt := time.Now()
			if err := w.writeBatch(delegate, batch); err == nil {
				w.recordPersistBatch(statusSuccess, time.Since(startedAt), len(batch))
				return
			} else {
				log.Printf("async terminal invocation log batch persist failed worker_id=%d batch_size=%d cause=%q; retrying individually", workerID, len(batch), err.Error())
			}
		}
	}

	for _, entry := range batch {
		w.persistOne(workerID, entry)
	}
}

func (w *TerminalLogWriter) writeBatch(delegate invocationlog.TerminalLogBatchWriter, batch []invocationlog.TerminalLog) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("batch delegate panic: %v", recovered)
		}
	}()

	ctx := context.Background()
	cancel := func() {}
	if w.writeTimeout > 0 {
		ctx, cancel = context.WithTimeout(ctx, w.writeTimeout)
	}
	defer cancel()
	return delegate.WriteTerminalLogs(ctx, batch)
}

func (w *TerminalLogWriter) persistOne(workerID int, entry invocationlog.TerminalLog) {
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
	w.recordPersistBatch(status, duration, 1)
}

func (w *TerminalLogWriter) recordPersistBatch(status string, duration time.Duration, recordCount int) {
	if w.registry == nil {
		return
	}
	w.registry.AsyncLogPersistBatch(metrics.AsyncLogEvent{
		Operation:       operationTerminal,
		Status:          status,
		DurationSeconds: duration.Seconds(),
	}, recordCount)
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
