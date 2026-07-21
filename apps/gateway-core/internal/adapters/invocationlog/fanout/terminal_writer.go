package fanout

import (
	"context"
	"errors"
	"log"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/metrics"
)

const mirrorOperation = "terminal_mirror"

type TerminalLogWriterConfig struct {
	Primary         invocationlog.TerminalLogWriter
	Mirror          invocationlog.TerminalLogWriter
	MirrorTimeout   time.Duration
	MetricsRegistry *metrics.Registry
}

type TerminalLogWriter struct {
	primary       invocationlog.TerminalLogWriter
	mirror        invocationlog.TerminalLogWriter
	mirrorTimeout time.Duration
	registry      *metrics.Registry
}

func NewTerminalLogWriter(cfg TerminalLogWriterConfig) *TerminalLogWriter {
	return &TerminalLogWriter{
		primary:       cfg.Primary,
		mirror:        cfg.Mirror,
		mirrorTimeout: cfg.MirrorTimeout,
		registry:      cfg.MetricsRegistry,
	}
}

func (w *TerminalLogWriter) WriteTerminalLog(ctx context.Context, entry invocationlog.TerminalLog) error {
	if w == nil || w.primary == nil {
		return errors.New("fanout terminal log writer requires a primary writer")
	}
	primaryErr := w.primary.WriteTerminalLog(ctx, entry)
	w.writeMirror(ctx, []invocationlog.TerminalLog{entry})
	return primaryErr
}

func (w *TerminalLogWriter) WriteTerminalLogs(ctx context.Context, entries []invocationlog.TerminalLog) error {
	if w == nil || w.primary == nil {
		return errors.New("fanout terminal log writer requires a primary writer")
	}
	if len(entries) == 0 {
		return nil
	}
	var primaryErr error
	if batchWriter, ok := w.primary.(invocationlog.TerminalLogBatchWriter); ok {
		primaryErr = batchWriter.WriteTerminalLogs(ctx, entries)
	} else {
		for _, entry := range entries {
			if err := w.primary.WriteTerminalLog(ctx, entry); err != nil {
				primaryErr = err
				break
			}
		}
	}
	w.writeMirror(ctx, entries)
	return primaryErr
}

func (w *TerminalLogWriter) writeMirror(ctx context.Context, entries []invocationlog.TerminalLog) {
	if w.mirror == nil || len(entries) == 0 {
		return
	}
	startedAt := time.Now()
	mirrorCtx := ctx
	cancel := func() {}
	if w.mirrorTimeout > 0 {
		mirrorCtx, cancel = context.WithTimeout(ctx, w.mirrorTimeout)
	}
	defer cancel()

	var err error
	if batchWriter, ok := w.mirror.(invocationlog.TerminalLogBatchWriter); ok {
		err = batchWriter.WriteTerminalLogs(mirrorCtx, entries)
	} else {
		for _, entry := range entries {
			if writeErr := w.mirror.WriteTerminalLog(mirrorCtx, entry); writeErr != nil {
				err = writeErr
				break
			}
		}
	}
	status := mirrorStatus(err)
	if w.registry != nil {
		w.registry.ClickHouseMirrorWrite(metrics.ClickHouseMirrorWrite{
			Operation:       mirrorOperation,
			Status:          status,
			DurationSeconds: time.Since(startedAt).Seconds(),
			RecordCount:     len(entries),
		})
	}
	if err != nil {
		log.Printf("clickhouse terminal log mirror failed status=%s record_count=%d", status, len(entries))
	}
}

func mirrorStatus(err error) string {
	if err == nil {
		return "success"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	return "error"
}
