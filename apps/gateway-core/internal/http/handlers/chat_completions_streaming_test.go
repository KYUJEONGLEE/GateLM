package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
	"gatelm/apps/gateway-core/internal/domain/outcome"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
)

func TestChatCompletionsHandlerDoesNotStartStreamWhenSafetyBlocksStreamRequest(t *testing.T) {
	adapter := &scriptedStreamingAdapter{}
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", adapter),
		DefaultModel:      "mock-balanced",
		DefaultProvider:   "mock",
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	req := streamingRequest("Summarize api_key=test_secret_token_redacted_for_demo_only_1234567890")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rr.Code, rr.Body.String())
	}
	assertStreamDidNotStart(t, rr)
	if adapter.streamCalls != 0 || adapter.chatCalls != 0 {
		t.Fatalf("provider must not be called, stream=%d chat=%d", adapter.streamCalls, adapter.chatCalls)
	}
	logged := requireOneTerminalLog(t, logWriter)
	if logged.TerminalStatus != outcome.TerminalStatusBlocked ||
		logged.DomainOutcomes.Safety.Outcome != outcome.SafetyBlocked ||
		logged.DomainOutcomes.Provider.Outcome != outcome.ProviderNotCalled ||
		logged.DomainOutcomes.Streaming.Outcome != outcome.StreamingNotStreaming {
		t.Fatalf("unexpected safety block outcomes: terminal=%s outcomes=%+v", logged.TerminalStatus, logged.DomainOutcomes)
	}
}

func TestChatCompletionsHandlerDoesNotStartStreamWhenBudgetBlocksStreamRequest(t *testing.T) {
	adapter := &scriptedStreamingAdapter{}
	logWriter := &recordingTerminalLogWriter{}
	maskingEngine := &countingMaskingEngine{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", adapter),
		DefaultModel:      "mock-balanced",
		DefaultProvider:   "mock",
		RateLimitPipeline: budgetBlockPipeline{},
		MaskingEngine:     maskingEngine,
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	req := streamingRequest("Write a safe short refund reply.")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rr.Code, rr.Body.String())
	}
	assertGatewayErrorCode(t, rr, "budget_blocked")
	assertStreamDidNotStart(t, rr)
	if maskingEngine.calls != 0 {
		t.Fatalf("budget block must happen before request-side safety, got safety calls=%d", maskingEngine.calls)
	}
	if adapter.streamCalls != 0 || adapter.chatCalls != 0 {
		t.Fatalf("provider must not be called, stream=%d chat=%d", adapter.streamCalls, adapter.chatCalls)
	}
	logged := requireOneTerminalLog(t, logWriter)
	if logged.TerminalStatus != outcome.TerminalStatusBlocked ||
		logged.DomainOutcomes.Budget.Outcome != outcome.BudgetBlocked ||
		logged.DomainOutcomes.Provider.Outcome != outcome.ProviderNotCalled ||
		logged.DomainOutcomes.Streaming.Outcome != outcome.StreamingNotStreaming {
		t.Fatalf("unexpected budget block outcomes: terminal=%s outcomes=%+v", logged.TerminalStatus, logged.DomainOutcomes)
	}
}

func TestChatCompletionsHandlerStreamsOnlyAfterRequestSideGatesComplete(t *testing.T) {
	events := []string{}
	adapter := &scriptedStreamingAdapter{
		events: &events,
		frames: [][]byte{[]byte("data: {\"delta\":\"hello\"}\n\n")},
	}
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:       provider.NewRegistry("mock", adapter),
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
		RateLimitPipeline: &streamEventPipeline{
			events: &events,
			name:   "runtime_budget_allowed",
			mutate: func(gatewayCtx *request.GatewayContext) {
				gatewayCtx.Runtime.HasCachePolicy = true
				gatewayCtx.Runtime.CachePolicy = runtimeconfig.CachePolicy{Enabled: false, Type: runtimeconfig.CacheTypeExact}
			},
		},
		MaskingEngine: &passThroughEventMaskingEngine{events: &events},
		PreProviderPipeline: &streamEventPipeline{
			events: &events,
			name:   "routing",
			mutate: func(gatewayCtx *request.GatewayContext) {
				gatewayCtx.Routing.SelectedProvider = "mock"
				gatewayCtx.Routing.SelectedModel = "mock-fast"
				gatewayCtx.Routing.RoutingReason = "short_prompt_low_cost"
			},
		},
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	req := streamingRequest("Write a safe short refund reply.")
	rr := &recordingStreamRecorder{ResponseRecorder: httptest.NewRecorder(), events: &events}

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	expected := []string{"runtime_budget_allowed", "safety", "routing", "provider_stream", "sse_header", "sse_write", "sse_flush"}
	if strings.Join(events, ",") != strings.Join(expected, ",") {
		t.Fatalf("expected event order %v, got %v", expected, events)
	}
	logged := requireOneTerminalLog(t, logWriter)
	if logged.TerminalStatus != outcome.TerminalStatusSuccess ||
		logged.DomainOutcomes.Streaming.Outcome != outcome.StreamingCompleted ||
		logged.DomainOutcomes.Provider.Outcome != outcome.ProviderSuccess {
		t.Fatalf("unexpected streaming success outcomes: terminal=%s outcomes=%+v", logged.TerminalStatus, logged.DomainOutcomes)
	}
}

func TestChatCompletionsHandlerRecordsCancelledWhenStreamingClientAborts(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	adapter := &scriptedStreamingAdapter{
		frames: [][]byte{[]byte("data: {\"delta\":\"first\"}\n\n")},
		afterFrame: func(index int) {
			if index == 0 {
				cancel()
			}
		},
	}
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", adapter),
		DefaultModel:      "mock-balanced",
		DefaultProvider:   "mock",
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	req := streamingRequest("Write a safe short refund reply.").WithContext(ctx)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	logged := requireOneTerminalLog(t, logWriter)
	if logged.TerminalStatus != outcome.TerminalStatusCancelled ||
		logged.HTTPStatus != gatewayerrors.StatusClientClosedRequest ||
		logged.DomainOutcomes.Streaming.Outcome != outcome.StreamingCancelled {
		t.Fatalf("unexpected cancelled outcomes: terminal=%s status=%d outcomes=%+v", logged.TerminalStatus, logged.HTTPStatus, logged.DomainOutcomes)
	}
	if adapter.streamCalls != 1 || adapter.chatCalls != 0 {
		t.Fatalf("expected one streaming provider call and no non-stream call, stream=%d chat=%d", adapter.streamCalls, adapter.chatCalls)
	}
}

func TestChatCompletionsHandlerStreamingLogDoesNotStoreRawChunks(t *testing.T) {
	rawSentinel := "stream_raw_sentinel_must_not_be_logged"
	adapter := &scriptedStreamingAdapter{
		frames: [][]byte{[]byte("data: {\"delta\":\"" + rawSentinel + "\"}\n\n")},
	}
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", adapter),
		DefaultModel:      "mock-balanced",
		DefaultProvider:   "mock",
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	req := streamingRequest("Write a safe short refund reply.")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if !strings.Contains(rr.Body.String(), rawSentinel) {
		t.Fatalf("expected streaming response body to include sentinel, got %q", rr.Body.String())
	}
	logged := requireOneTerminalLog(t, logWriter)
	encodedLog, err := json.Marshal(logged)
	if err != nil {
		t.Fatalf("marshal terminal log: %v", err)
	}
	if strings.Contains(string(encodedLog), rawSentinel) {
		t.Fatalf("terminal log must not store raw stream payload: %s", encodedLog)
	}
	if logged.DomainOutcomes.Streaming.Outcome != outcome.StreamingCompleted ||
		logged.DomainOutcomes.Streaming.StreamingRequested != true {
		t.Fatalf("unexpected streaming log outcome: %+v", logged.DomainOutcomes.Streaming)
	}
}

func streamingRequest(prompt string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(streamingChatBody(prompt)))
	setValidGatewayAuthHeaders(req)
	return req
}

func streamingChatBody(prompt string) string {
	return `{"model":"mock-balanced","stream":true,"messages":[{"role":"user","content":` + jsonStringLiteral(prompt) + `}]}`
}

func assertStreamDidNotStart(t *testing.T, rr *httptest.ResponseRecorder) {
	t.Helper()
	if strings.HasPrefix(rr.Header().Get("Content-Type"), "text/event-stream") {
		t.Fatalf("stream content type must not be set before gates pass: %q", rr.Header().Get("Content-Type"))
	}
	if rr.Flushed {
		t.Fatal("stream must not flush before gates pass")
	}
	if strings.Contains(rr.Body.String(), "data:") {
		t.Fatalf("stream body must not contain SSE data, got %q", rr.Body.String())
	}
}

func requireOneTerminalLog(t *testing.T, logWriter *recordingTerminalLogWriter) invocationlog.TerminalLog {
	t.Helper()
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	return logWriter.logs[0]
}

type budgetBlockPipeline struct{}

func (budgetBlockPipeline) Execute(_ context.Context, gatewayCtx *request.GatewayContext) error {
	if gatewayCtx != nil {
		gatewayCtx.Status.ErrorCode = "budget_blocked"
	}
	return gatewayerrors.New(http.StatusForbidden, "budget_blocked", "Budget policy blocked the request.", "budget_guard")
}

type streamEventPipeline struct {
	events *[]string
	name   string
	mutate func(gatewayCtx *request.GatewayContext)
}

func (p *streamEventPipeline) Execute(_ context.Context, gatewayCtx *request.GatewayContext) error {
	if p.events != nil {
		*p.events = append(*p.events, p.name)
	}
	if p.mutate != nil {
		p.mutate(gatewayCtx)
	}
	return nil
}

type countingMaskingEngine struct {
	calls int
}

func (e *countingMaskingEngine) Apply(_ context.Context, req maskdomain.ApplyRequest) (maskdomain.Result, error) {
	e.calls++
	return maskdomain.Result{
		Action:                  maskdomain.ActionNone,
		RedactedPrompt:          req.Prompt,
		SecurityPolicyVersionID: req.SecurityPolicyVersionID,
	}, nil
}

type passThroughEventMaskingEngine struct {
	events *[]string
}

func (e *passThroughEventMaskingEngine) Apply(_ context.Context, req maskdomain.ApplyRequest) (maskdomain.Result, error) {
	if e.events != nil {
		*e.events = append(*e.events, "safety")
	}
	return maskdomain.Result{
		Action:                  maskdomain.ActionNone,
		RedactedPrompt:          req.Prompt,
		SecurityPolicyVersionID: req.SecurityPolicyVersionID,
	}, nil
}

type scriptedStreamingAdapter struct {
	name       string
	frames     [][]byte
	err        error
	events     *[]string
	afterFrame func(index int)
	streamCalls int
	chatCalls   int
}

func (a *scriptedStreamingAdapter) Name() string {
	if strings.TrimSpace(a.name) == "" {
		return "mock"
	}
	return a.name
}

func (a *scriptedStreamingAdapter) ListModels(ctx context.Context) (*provider.ModelListResponse, error) {
	return &provider.ModelListResponse{}, nil
}

func (a *scriptedStreamingAdapter) CreateChatCompletion(ctx context.Context, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	a.chatCalls++
	return &provider.ChatCompletionResponse{}, nil
}

func (a *scriptedStreamingAdapter) CreateChatCompletionStream(ctx context.Context, req provider.ChatCompletionRequest) (provider.ChatCompletionStream, error) {
	a.streamCalls++
	if a.events != nil {
		*a.events = append(*a.events, "provider_stream")
	}
	if a.err != nil {
		return nil, a.err
	}
	return &scriptedProviderStream{frames: append([][]byte(nil), a.frames...), afterFrame: a.afterFrame}, nil
}

type scriptedProviderStream struct {
	frames     [][]byte
	index      int
	afterFrame func(index int)
}

func (s *scriptedProviderStream) Recv(ctx context.Context) (provider.ChatCompletionStreamFrame, error) {
	if err := ctx.Err(); err != nil {
		return provider.ChatCompletionStreamFrame{}, err
	}
	if s.index >= len(s.frames) {
		return provider.ChatCompletionStreamFrame{}, io.EOF
	}
	index := s.index
	payload := append([]byte(nil), s.frames[index]...)
	s.index++
	if s.afterFrame != nil {
		s.afterFrame(index)
	}
	return provider.ChatCompletionStreamFrame{Payload: payload}, nil
}

func (s *scriptedProviderStream) Close() error {
	return nil
}

type recordingStreamRecorder struct {
	*httptest.ResponseRecorder
	events *[]string
}

func (r *recordingStreamRecorder) WriteHeader(statusCode int) {
	if r.events != nil && statusCode == http.StatusOK && strings.HasPrefix(r.Header().Get("Content-Type"), "text/event-stream") {
		*r.events = append(*r.events, "sse_header")
	}
	r.ResponseRecorder.WriteHeader(statusCode)
}

func (r *recordingStreamRecorder) Write(payload []byte) (int, error) {
	if r.events != nil && strings.Contains(string(payload), "data:") {
		*r.events = append(*r.events, "sse_write")
	}
	return r.ResponseRecorder.Write(payload)
}

func (r *recordingStreamRecorder) Flush() {
	if r.events != nil {
		*r.events = append(*r.events, "sse_flush")
	}
	r.ResponseRecorder.Flush()
}

var _ provider.StreamingAdapter = (*scriptedStreamingAdapter)(nil)
var _ GatewayPipeline = (*streamEventPipeline)(nil)
var _ GatewayPipeline = budgetBlockPipeline{}
var _ MaskingEngine = (*countingMaskingEngine)(nil)
var _ MaskingEngine = (*passThroughEventMaskingEngine)(nil)
var _ provider.ChatCompletionStream = (*scriptedProviderStream)(nil)
