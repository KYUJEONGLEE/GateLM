package admission

import (
	"context"
	"errors"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

type snapshotResolver interface {
	Resolve(ctx context.Context, requestContext tenantchat.RequestContext) (tenantruntime.Snapshot, error)
}

type admissionStore interface {
	Create(ctx context.Context, requestContext tenantchat.RequestContext, limits tenantchat.AdmissionLimits) (tenantchat.Admission, error)
	Cancel(ctx context.Context, requestContext tenantchat.RequestContext) (tenantchat.AdmissionCancellation, error)
	ValidateActive(ctx context.Context, requestContext tenantchat.RequestContext) error
}

func (s *Service) ValidateActive(ctx context.Context, requestContext tenantchat.RequestContext) error {
	if s == nil || s.admissions == nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	return s.admissions.ValidateActive(ctx, requestContext)
}

type Service struct {
	snapshots  snapshotResolver
	admissions admissionStore
}

func New(snapshots snapshotResolver, admissions admissionStore) *Service {
	return &Service{snapshots: snapshots, admissions: admissions}
}

func (s *Service) Admit(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
) (tenantchat.Admission, error) {
	// Chat API owns Control Plane entitlement resolution. The authenticated,
	// body-bound requestContext is the actor decision; Gateway only applies the
	// active tenant runtime and admission policy to that signed context.
	if s == nil || s.snapshots == nil || s.admissions == nil {
		return tenantchat.Admission{}, tenantchat.ErrUsageGuardUnavailable
	}
	snapshot, err := s.snapshots.Resolve(ctx, requestContext)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return tenantchat.Admission{}, err
		}
		if errors.Is(err, tenantchat.ErrTenantDisabled) {
			return tenantchat.Admission{}, tenantchat.ErrTenantDisabled
		}
		return tenantchat.Admission{}, tenantchat.ErrRuntimeUnavailable
	}
	limits := tenantchat.AdmissionLimits{
		RequestsPerWindow:          snapshot.Policies.RateLimit.Requests,
		Window:                     time.Duration(snapshot.Policies.RateLimit.WindowSeconds) * time.Second,
		MaxActiveAdmissionsPerUser: snapshot.Policies.Concurrency.MaxActiveAdmissionsPerUser,
		AdmissionTTL:               time.Duration(snapshot.Policies.Concurrency.AdmissionTTLSeconds) * time.Second,
	}
	return s.admissions.Create(ctx, requestContext, limits)
}

func (s *Service) Cancel(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
) (tenantchat.AdmissionCancellation, error) {
	if s == nil || s.admissions == nil {
		return tenantchat.AdmissionCancellation{}, tenantchat.ErrUsageGuardUnavailable
	}
	return s.admissions.Cancel(ctx, requestContext)
}
