package fanout

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/metrics"
)

func TestTerminalLogWriterKeepsPrimaryResultWhenMirrorFails(t *testing.T) {
	primary := &recordingWriter{}
	mirror := &recordingWriter{err: errors.New("synthetic mirror failure")}
	registry := metrics.NewRegistry()
	writer := NewTerminalLogWriter(TerminalLogWriterConfig{
		Primary:         primary,
		Mirror:          mirror,
		MirrorTimeout:   50 * time.Millisecond,
		MetricsRegistry: registry,
	})

	if err := writer.WriteTerminalLog(context.Background(), invocationlog.TerminalLog{RequestID: "request_1"}); err != nil {
		t.Fatalf("mirror failure must not replace primary success: %v", err)
	}
	if len(primary.entries) != 1 || len(mirror.entries) != 1 {
		t.Fatalf("expected both writers to receive one record: primary=%d mirror=%d", len(primary.entries), len(mirror.entries))
	}
	output := registry.RenderPrometheus()
	if !strings.Contains(output, `gatelm_clickhouse_log_writes_total{operation="terminal_mirror",status="error"} 1`) {
		t.Fatalf("expected mirror error metric, got:\n%s", output)
	}
}

func TestTerminalLogWriterSkipsMirrorWhenPrimaryFails(t *testing.T) {
	primaryErr := errors.New("synthetic primary failure")
	primary := &recordingWriter{err: primaryErr}
	mirror := &recordingWriter{}
	writer := NewTerminalLogWriter(TerminalLogWriterConfig{Primary: primary, Mirror: mirror})

	err := writer.WriteTerminalLog(context.Background(), invocationlog.TerminalLog{RequestID: "request_1"})
	if !errors.Is(err, primaryErr) {
		t.Fatalf("expected primary failure, got %v", err)
	}
	if len(mirror.entries) != 0 {
		t.Fatalf("mirror must wait for canonical primary success, got %d records", len(mirror.entries))
	}
}

func TestTerminalLogWriterSkipsBatchMirrorWhenPrimaryFails(t *testing.T) {
	primaryErr := errors.New("synthetic primary batch failure")
	primary := &failingBatchWriter{err: primaryErr}
	mirror := &recordingBatchWriter{}
	writer := NewTerminalLogWriter(TerminalLogWriterConfig{Primary: primary, Mirror: mirror})

	err := writer.WriteTerminalLogs(context.Background(), []invocationlog.TerminalLog{
		{RequestID: "request_1"},
		{RequestID: "request_2"},
	})
	if !errors.Is(err, primaryErr) {
		t.Fatalf("expected primary batch failure, got %v", err)
	}
	if mirror.batchCalls != 0 {
		t.Fatalf("mirror must not receive a batch that the canonical primary rejected, got %d calls", mirror.batchCalls)
	}
}

func TestTerminalLogWriterBoundsMirrorTimeout(t *testing.T) {
	registry := metrics.NewRegistry()
	writer := NewTerminalLogWriter(TerminalLogWriterConfig{
		Primary:         &recordingWriter{},
		Mirror:          blockingWriter{},
		MirrorTimeout:   10 * time.Millisecond,
		MetricsRegistry: registry,
	})

	startedAt := time.Now()
	if err := writer.WriteTerminalLog(context.Background(), invocationlog.TerminalLog{RequestID: "request_timeout"}); err != nil {
		t.Fatalf("mirror timeout must not fail primary result: %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed > 250*time.Millisecond {
		t.Fatalf("mirror timeout was not bounded: %s", elapsed)
	}
	output := registry.RenderPrometheus()
	if !strings.Contains(output, `gatelm_clickhouse_log_writes_total{operation="terminal_mirror",status="timeout"} 1`) {
		t.Fatalf("expected mirror timeout metric, got:\n%s", output)
	}
}

func TestTerminalLogWriterUsesBatchInterfaces(t *testing.T) {
	primary := &recordingBatchWriter{}
	mirror := &recordingBatchWriter{}
	registry := metrics.NewRegistry()
	writer := NewTerminalLogWriter(TerminalLogWriterConfig{
		Primary: primary, Mirror: mirror, MetricsRegistry: registry,
	})
	entries := []invocationlog.TerminalLog{{RequestID: "request_1"}, {RequestID: "request_2"}}

	if err := writer.WriteTerminalLogs(context.Background(), entries); err != nil {
		t.Fatalf("write batch: %v", err)
	}
	if primary.batchCalls != 1 || mirror.batchCalls != 1 {
		t.Fatalf("expected one batch call per writer: primary=%d mirror=%d", primary.batchCalls, mirror.batchCalls)
	}
	output := registry.RenderPrometheus()
	if !strings.Contains(output, `gatelm_clickhouse_log_writes_total{operation="terminal_mirror",status="success"} 2`) {
		t.Fatalf("expected two successful mirrored records, got:\n%s", output)
	}
}

type recordingWriter struct {
	entries []invocationlog.TerminalLog
	err     error
}

func (w *recordingWriter) WriteTerminalLog(_ context.Context, entry invocationlog.TerminalLog) error {
	w.entries = append(w.entries, entry)
	return w.err
}

type recordingBatchWriter struct {
	batchCalls int
}

func (w *recordingBatchWriter) WriteTerminalLog(context.Context, invocationlog.TerminalLog) error {
	return nil
}

func (w *recordingBatchWriter) WriteTerminalLogs(_ context.Context, _ []invocationlog.TerminalLog) error {
	w.batchCalls++
	return nil
}

type failingBatchWriter struct {
	err error
}

func (w *failingBatchWriter) WriteTerminalLog(context.Context, invocationlog.TerminalLog) error {
	return w.err
}

func (w *failingBatchWriter) WriteTerminalLogs(context.Context, []invocationlog.TerminalLog) error {
	return w.err
}

type blockingWriter struct{}

func (blockingWriter) WriteTerminalLog(ctx context.Context, _ invocationlog.TerminalLog) error {
	<-ctx.Done()
	return ctx.Err()
}
