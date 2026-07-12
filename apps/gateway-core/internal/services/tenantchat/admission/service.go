package admission

import (
	"context"
	"time"

	"gatelm/apps/gateway-core/internal/adapters/tenantchat/workloadauth"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

type entitlementChecker interface {
	Check(ctx context.Context, claims workloadauth.Claims) error
}

type snapshotResolver interface {
	Resolve(ctx context.Context, requestContext tenantchat.RequestContext) (tenantruntime.Snapshot, error)
}

type admissionStore interface {
	Create(ctx context.Context, requestContext tenantchat.RequestContext, limits tenantchat.AdmissionLimits) (tenantchat.Admission, error)
	Cancel(ctx context.Context, requestContext tenantchat.RequestContext) (tenantchat.AdmissionCancellation, error)
}

type Service struct {
	entitlements entitlementChecker
	snapshots    snapshotResolver
	admissions   admissionStore
}

func New(entitlements entitlementChecker, snapshots snapshotResolver, admissions admissionStore) *Service {
	return &Service{entitlements: entitlements, snapshots: snapshots, admissions: admissions}
}

func (s *Service) Admit(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	claims workloadauth.Claims,
) (tenantchat.Admission, error) {
	if s == nil || s.entitlements == nil || s.snapshots == nil || s.admissions == nil {
		return tenantchat.Admission{}, tenantchat.ErrUsageGuardUnavailable
	}
	if err := s.entitlements.Check(ctx, claims); err != nil {
		return tenantchat.Admission{}, err
	}
	snapshot, err := s.snapshots.Resolve(ctx, requestContext)
	if err != nil {
		return tenantchat.Admission{}, tenantchat.ErrUsageGuardUnavailable
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
