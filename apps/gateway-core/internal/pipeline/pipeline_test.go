package pipeline

import (
	"context"
	"errors"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/request"
)

func TestPipelineExecutePassesGatewayContextInOrder(t *testing.T) {
	gatewayCtx := &request.GatewayContext{}
	first := &recordStage{name: "first", tenantID: "tenant_demo"}
	second := &recordStage{name: "second", projectID: "project_demo"}

	err := New(first, second).Execute(context.Background(), gatewayCtx)

	if err != nil {
		t.Fatalf("expected pipeline to pass, got %v", err)
	}
	if first.calls != 1 || second.calls != 1 {
		t.Fatalf("expected both stages to run once, got first=%d second=%d", first.calls, second.calls)
	}
	if gatewayCtx.Identity.TenantID != "tenant_demo" || gatewayCtx.Identity.ProjectID != "project_demo" {
		t.Fatalf("unexpected gateway context: %#v", gatewayCtx.Identity)
	}
}

func TestPipelineExecuteStopsOnStageError(t *testing.T) {
	expectedErr := errors.New("stage failed")
	first := &recordStage{name: "first", err: expectedErr}
	second := &recordStage{name: "second", projectID: "project_demo"}

	err := New(first, second).Execute(context.Background(), &request.GatewayContext{})

	if !errors.Is(err, expectedErr) {
		t.Fatalf("expected stage error, got %v", err)
	}
	if first.calls != 1 || second.calls != 0 {
		t.Fatalf("expected pipeline to stop after first stage, got first=%d second=%d", first.calls, second.calls)
	}
}

type recordStage struct {
	name      string
	tenantID  string
	projectID string
	err       error
	calls     int
}

func (s *recordStage) Name() string {
	return s.name
}

func (s *recordStage) Execute(_ context.Context, gatewayCtx *request.GatewayContext) error {
	s.calls++
	if s.err != nil {
		return s.err
	}
	if s.tenantID != "" {
		gatewayCtx.Identity.TenantID = s.tenantID
	}
	if s.projectID != "" {
		gatewayCtx.Identity.ProjectID = s.projectID
	}
	return nil
}
