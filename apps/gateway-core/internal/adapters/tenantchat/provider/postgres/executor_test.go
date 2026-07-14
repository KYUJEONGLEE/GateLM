package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/credentials"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/jackc/pgx/v5"
)

type executorQueryer struct {
	row   executorRow
	query string
	args  []any
}

func (q *executorQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	q.query = query
	q.args = args
	return q.row
}

type executorRow struct {
	err            error
	id             string
	providerName   string
	displayName    string
	baseURL        string
	timeoutMs      int
	secretRef      *string
	resolver       string
	providerConfig []byte
}

func (r executorRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != 8 {
		return errors.New("unexpected provider connection scan target count")
	}
	*(dest[0].(*string)) = r.id
	*(dest[1].(*string)) = r.providerName
	*(dest[2].(*string)) = r.displayName
	*(dest[3].(*string)) = r.baseURL
	*(dest[4].(*int)) = r.timeoutMs
	*(dest[5].(**string)) = r.secretRef
	*(dest[6].(*string)) = r.resolver
	*(dest[7].(*[]byte)) = append([]byte(nil), r.providerConfig...)
	return nil
}

type executorCredentialResolver struct {
	ref      credentials.Ref
	resolved credentials.Resolved
	err      error
}

func (r *executorCredentialResolver) Resolve(_ context.Context, ref credentials.Ref) (credentials.Resolved, error) {
	r.ref = ref
	return r.resolved, r.err
}

type executorAdapter struct {
	config  provider.ExecutionConfig
	request provider.ChatCompletionRequest
	stream  provider.ChatCompletionStreamReader
}

func (a *executorAdapter) AdapterType() string { return "tenant-test" }

func (a *executorAdapter) ListModels(context.Context, provider.ExecutionConfig) (*provider.ModelListResponse, error) {
	return nil, errors.New("not used")
}

func (a *executorAdapter) CreateChatCompletion(context.Context, provider.ExecutionConfig, provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	return nil, errors.New("not used")
}

func (a *executorAdapter) CreateChatCompletionStream(
	_ context.Context,
	config provider.ExecutionConfig,
	request provider.ChatCompletionRequest,
) (provider.ChatCompletionStreamReader, error) {
	a.config = config
	a.request = request
	return a.stream, nil
}

type executorStream struct{}

func (*executorStream) Next() (provider.ChatCompletionStreamEvent, error) {
	return provider.ChatCompletionStreamEvent{}, io.EOF
}

func (*executorStream) Close() error { return nil }

func TestExecutorUsesExactTenantLevelProviderConnection(t *testing.T) {
	secretRef := "provider_credential:connection-primary"
	queryer := &executorQueryer{row: executorRow{
		id: "connection-primary", providerName: "openai", displayName: "Tenant OpenAI",
		baseURL: "https://api.example.com/v1", timeoutMs: 30_000,
		secretRef: &secretRef, resolver: "postgres",
		providerConfig: []byte(`{"adapterType":"tenant-test","requestFormat":"openai_chat_completions"}`),
	}}
	stream := &executorStream{}
	adapter := &executorAdapter{stream: stream}
	credentialResolver := &executorCredentialResolver{resolved: credentials.Resolved{Value: "resolved-secret"}}
	executor := NewExecutor(
		queryer,
		provider.NewRegistry("tenant-test", adapter),
		credentialResolver,
	)
	requestContext := tenantchat.RequestContext{
		RequestID:      "request_completion_001",
		ExecutionScope: tenantchat.ExecutionScope{TenantID: "tenant-primary"},
		UsageIntent:    &tenantchat.UsageIntent{MaxOutputTokens: 128},
	}
	input := tenantchat.CompletionInput{
		Messages: []tenantchat.EphemeralMessage{{Role: "user", Content: "안녕하세요"}}, Stream: true,
	}

	got, startStatus, err := executor.OpenStream(context.Background(), requestContext, tenantchat.SelectedRoute{
		ProviderID: "connection-primary", ModelKey: "gpt-test",
	}, input)
	if err != nil {
		t.Fatalf("open tenant provider stream: %v", err)
	}
	if got != stream {
		t.Fatal("executor returned a different provider stream")
	}
	if startStatus != tenantchat.ProviderCallStartedOrUnknown {
		t.Fatalf("unexpected provider start status: %s", startStatus)
	}
	if len(queryer.args) != 2 || queryer.args[0] != "tenant-primary" || queryer.args[1] != "connection-primary" {
		t.Fatalf("provider lookup is not tenant/provider bound: %#v", queryer.args)
	}
	if !strings.Contains(queryer.query, `"tenantId" = $1::uuid`) ||
		!strings.Contains(queryer.query, `"projectId" IS NULL`) ||
		!strings.Contains(queryer.query, `status = 'ACTIVE'`) {
		t.Fatalf("provider lookup does not enforce tenant-level active connection: %s", queryer.query)
	}
	if credentialResolver.ref.CredentialRefID != secretRef || adapter.config.Credential == nil ||
		adapter.config.Credential.Value != "resolved-secret" {
		t.Fatalf("provider credential was not resolved server-side: ref=%+v config=%+v", credentialResolver.ref, adapter.config)
	}
	if adapter.request.Model != "gpt-test" || adapter.request.MaxTokens == nil || *adapter.request.MaxTokens != 128 ||
		!adapter.request.Stream || adapter.request.StreamOptions == nil || !adapter.request.StreamOptions.IncludeUsage {
		t.Fatalf("unexpected provider request: %+v", adapter.request)
	}
	if len(adapter.request.Messages) != 1 || !json.Valid(adapter.request.Messages[0].Content) ||
		string(adapter.request.Messages[0].Content) != `"안녕하세요"` {
		t.Fatalf("unexpected provider messages: %+v", adapter.request.Messages)
	}
}

func TestExecutorDoesNotFallBackToAnotherProviderConnection(t *testing.T) {
	executor := NewExecutor(
		&executorQueryer{row: executorRow{err: pgx.ErrNoRows}},
		provider.NewRegistry("tenant-test", &executorAdapter{}),
		nil,
	)
	_, startStatus, err := executor.OpenStream(
		context.Background(),
		tenantchat.RequestContext{
			ExecutionScope: tenantchat.ExecutionScope{TenantID: "tenant-primary"},
			UsageIntent:    &tenantchat.UsageIntent{MaxOutputTokens: 32},
		},
		tenantchat.SelectedRoute{ProviderID: "missing-connection", ModelKey: "gpt-test"},
		tenantchat.CompletionInput{Stream: true},
	)
	if !errors.Is(err, tenantchat.ErrNoEligibleRoute) {
		t.Fatalf("want no eligible route, got %v", err)
	}
	if startStatus != tenantchat.ProviderCallNotStarted {
		t.Fatalf("unexpected provider start status: %s", startStatus)
	}
}

func TestExecutorTreatsNilProviderStreamAsStartedOrUnknownFailure(t *testing.T) {
	executor := NewExecutor(
		&executorQueryer{row: executorRow{
			id: "connection-primary", providerName: "mock", displayName: "Synthetic Mock",
			baseURL: "http://127.0.0.1:18090", timeoutMs: 30_000, resolver: "none",
			providerConfig: []byte(`{"adapterType":"tenant-test","requestFormat":"mock_chat_completions"}`),
		}},
		provider.NewRegistry("tenant-test", &executorAdapter{}),
		nil,
	)
	stream, startStatus, err := executor.OpenStream(
		context.Background(),
		tenantchat.RequestContext{
			RequestID: "request_nil_stream", ExecutionScope: tenantchat.ExecutionScope{TenantID: "tenant-primary"},
			UsageIntent: &tenantchat.UsageIntent{MaxOutputTokens: 32},
		},
		tenantchat.SelectedRoute{ProviderID: "connection-primary", ModelKey: "mock-test"},
		tenantchat.CompletionInput{Messages: []tenantchat.EphemeralMessage{{Role: "user", Content: "synthetic"}}, Stream: true},
	)
	if stream != nil || err == nil || startStatus != tenantchat.ProviderCallStartedOrUnknown {
		t.Fatalf("nil provider stream must be conservative: stream=%v status=%s err=%v", stream, startStatus, err)
	}
}

func TestExecutorPreservesWrappedDatabaseContextErrors(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		want error
	}{
		{name: "canceled", err: fmt.Errorf("query canceled: %w", context.Canceled), want: context.Canceled},
		{name: "deadline", err: fmt.Errorf("query timed out: %w", context.DeadlineExceeded), want: context.DeadlineExceeded},
	} {
		t.Run(test.name, func(t *testing.T) {
			executor := NewExecutor(&executorQueryer{row: executorRow{err: test.err}}, nil, nil)
			_, err := executor.resolveConnection(context.Background(), "tenant-primary", "connection-primary")
			if !errors.Is(err, test.want) {
				t.Fatalf("want %v, got %v", test.want, err)
			}
		})
	}
}
