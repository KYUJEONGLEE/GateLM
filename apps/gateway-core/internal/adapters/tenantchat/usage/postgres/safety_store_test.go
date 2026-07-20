package postgres

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/jackc/pgx/v5"
)

func TestClassifySafetySummaryReadErrorPreservesContextErrors(t *testing.T) {
	canceledCtx, cancel := context.WithCancel(context.Background())
	cancel()
	deadlineCtx, deadlineCancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer deadlineCancel()

	tests := []struct {
		name string
		ctx  context.Context
		err  error
		want error
	}{
		{name: "canceled context precedes driver error", ctx: canceledCtx, err: errors.New("driver error"), want: context.Canceled},
		{name: "deadline context precedes no rows", ctx: deadlineCtx, err: pgx.ErrNoRows, want: context.DeadlineExceeded},
		{name: "wrapped cancellation is preserved", ctx: context.Background(), err: fmt.Errorf("query failed: %w", context.Canceled), want: context.Canceled},
		{name: "no rows maps to expired admission", ctx: context.Background(), err: pgx.ErrNoRows, want: tenantchat.ErrAdmissionExpired},
		{name: "driver error maps to usage guard", ctx: context.Background(), err: errors.New("driver error"), want: tenantchat.ErrUsageGuardUnavailable},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := classifySafetySummaryReadError(test.ctx, test.err); !errors.Is(got, test.want) {
				t.Fatalf("classifySafetySummaryReadError() = %v, want %v", got, test.want)
			}
		})
	}
}
