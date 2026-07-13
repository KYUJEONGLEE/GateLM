package admission

import (
	"context"
	"errors"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

type fakeSnapshotResolver struct {
	snapshot tenantruntime.Snapshot
	err      error
	context  tenantchat.RequestContext
}

func (r *fakeSnapshotResolver) Resolve(_ context.Context, requestContext tenantchat.RequestContext) (tenantruntime.Snapshot, error) {
	r.context = requestContext
	return r.snapshot, r.err
}

type fakeAdmissionStore struct {
	context tenantchat.RequestContext
	limits  tenantchat.AdmissionLimits
}

func (s *fakeAdmissionStore) Create(_ context.Context, requestContext tenantchat.RequestContext, limits tenantchat.AdmissionLimits) (tenantchat.Admission, error) {
	s.context = requestContext
	s.limits = limits
	return tenantchat.Admission{AdmissionID: "admission_fixture_001", State: "active"}, nil
}

func (s *fakeAdmissionStore) Cancel(_ context.Context, _ tenantchat.RequestContext) (tenantchat.AdmissionCancellation, error) {
	return tenantchat.AdmissionCancellation{}, nil
}

func TestAdmitUsesSignedActorContextWithoutIdentityLookup(t *testing.T) {
	requestContext := tenantchat.RequestContext{ExecutionScope: tenantchat.ExecutionScope{
		TenantID: "00000000-0000-4000-8000-000000000100",
		Actor: tenantchat.Actor{
			UserID:     "00000000-0000-4000-8000-000000000200",
			ActorKind:  "employee",
			EmployeeID: "00000000-0000-4000-8000-000000000300",
		},
	}}
	resolver := &fakeSnapshotResolver{snapshot: tenantruntime.Snapshot{Policies: tenantruntime.Policies{
		RateLimit: tenantruntime.RateLimitPolicy{Requests: 60, WindowSeconds: 60},
		Concurrency: tenantruntime.ConcurrencyPolicy{
			MaxActiveAdmissionsPerUser: 2,
			AdmissionTTLSeconds:        30,
		},
	}}}
	store := &fakeAdmissionStore{}
	if _, err := New(resolver, store).Admit(context.Background(), requestContext); err != nil {
		t.Fatalf("admit signed actor context: %v", err)
	}
	if resolver.context.ExecutionScope.Actor != requestContext.ExecutionScope.Actor ||
		store.context.ExecutionScope.Actor != requestContext.ExecutionScope.Actor {
		t.Fatalf("signed actor context was reinterpreted")
	}
	if store.limits.RequestsPerWindow != 60 || store.limits.Window != time.Minute ||
		store.limits.MaxActiveAdmissionsPerUser != 2 || store.limits.AdmissionTTL != 30*time.Second {
		t.Fatalf("unexpected runtime admission limits: %+v", store.limits)
	}
}

func TestAdmitSeparatesTenantAndRuntimeRejection(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		want error
	}{
		{name: "inactive tenant", err: tenantchat.ErrTenantDisabled, want: tenantchat.ErrTenantDisabled},
		{name: "runtime unavailable", err: errors.New("snapshot unavailable"), want: tenantchat.ErrRuntimeUnavailable},
	} {
		t.Run(test.name, func(t *testing.T) {
			service := New(&fakeSnapshotResolver{err: test.err}, &fakeAdmissionStore{})
			if _, err := service.Admit(context.Background(), tenantchat.RequestContext{}); !errors.Is(err, test.want) {
				t.Fatalf("want %v, got %v", test.want, err)
			}
		})
	}
}
