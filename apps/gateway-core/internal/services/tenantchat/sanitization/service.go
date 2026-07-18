package sanitization

import (
	"context"
	"errors"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantchatruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

const accountingTimeout = 5 * time.Second

type snapshotResolver interface {
	Resolve(ctx context.Context, requestContext tenantchat.RequestContext) (tenantchatruntime.Snapshot, error)
}

type admissionValidator interface {
	ValidateActive(ctx context.Context, requestContext tenantchat.RequestContext) error
}

type safetyEvaluator interface {
	Sanitize(
		ctx context.Context,
		snapshot tenantchatruntime.Snapshot,
		input tenantchat.SanitizationInput,
	) (tenantchat.SanitizationEvaluation, error)
}

type ledgerlessAccounting interface {
	RecordSafetySummary(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		summary tenantchat.SafetySummary,
	) (bool, error)
	FinalizeLedgerless(
		ctx context.Context,
		requestContext tenantchat.RequestContext,
		snapshot tenantchatruntime.Snapshot,
		terminalOutcome string,
		errorCode string,
		cacheOutcome string,
		observability tenantchat.LedgerlessObservability,
	) (bool, error)
}

type Service struct {
	snapshots  snapshotResolver
	admissions admissionValidator
	safety     safetyEvaluator
	ledgerless ledgerlessAccounting
}

func New(
	snapshots snapshotResolver,
	admissions admissionValidator,
	safety safetyEvaluator,
	ledgerless ledgerlessAccounting,
) *Service {
	return &Service{
		snapshots: snapshots, admissions: admissions, safety: safety, ledgerless: ledgerless,
	}
}

func (s *Service) Sanitize(
	ctx context.Context,
	request tenantchat.SanitizationRequest,
) (tenantchat.SanitizationResponse, error) {
	if s == nil || s.snapshots == nil || s.admissions == nil || s.safety == nil || s.ledgerless == nil {
		return tenantchat.SanitizationResponse{}, tenantchat.ErrUsageGuardUnavailable
	}
	if err := tenantchat.ValidateSanitizationInput(request.Input); err != nil {
		return tenantchat.SanitizationResponse{}, err
	}
	if err := s.admissions.ValidateActive(ctx, request.Context); err != nil {
		return tenantchat.SanitizationResponse{}, err
	}
	snapshot, err := s.snapshots.Resolve(ctx, request.Context)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return tenantchat.SanitizationResponse{}, err
		}
		if errors.Is(err, tenantchat.ErrTenantDisabled) {
			return tenantchat.SanitizationResponse{}, tenantchat.ErrTenantDisabled
		}
		return tenantchat.SanitizationResponse{}, tenantchat.ErrRuntimeUnavailable
	}
	evaluation, err := s.safety.Sanitize(ctx, snapshot, request.Input)
	if err != nil {
		return tenantchat.SanitizationResponse{}, tenantchat.ErrRuntimeUnavailable
	}
	if evaluation.PolicyDigest != snapshot.Policies.Safety.PolicyDigest ||
		evaluation.Summary.SafetyPolicyDigest != snapshot.Policies.Safety.PolicyDigest ||
		tenantchat.ValidateSafetySummary(evaluation.Summary) != nil {
		return tenantchat.SanitizationResponse{}, tenantchat.ErrRuntimeUnavailable
	}
	recordCtx, recordCancel := context.WithTimeout(context.WithoutCancel(ctx), accountingTimeout)
	_, recordErr := s.ledgerless.RecordSafetySummary(recordCtx, request.Context, evaluation.Summary)
	recordCancel()
	if recordErr != nil {
		return tenantchat.SanitizationResponse{}, tenantchat.ErrUsageGuardUnavailable
	}
	if evaluation.Blocked {
		settleCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), accountingTimeout)
		_, settleErr := s.ledgerless.FinalizeLedgerless(
			settleCtx,
			request.Context,
			snapshot,
			"safety_blocked",
			"CHAT_SAFETY_BLOCKED",
			"off",
			tenantchat.LedgerlessObservability{MaskingAction: "blocked"},
		)
		cancel()
		if settleErr != nil {
			return tenantchat.SanitizationResponse{}, tenantchat.ErrUsageGuardUnavailable
		}
		return tenantchat.SanitizationResponse{}, tenantchat.ErrSafetyBlocked
	}
	if len(evaluation.Messages) != len(request.Input.Messages) {
		return tenantchat.SanitizationResponse{}, tenantchat.ErrRuntimeUnavailable
	}
	messages := make([]tenantchat.SanitizedMessage, len(evaluation.Messages))
	for index, message := range evaluation.Messages {
		if message.ItemIndex != index || strings.TrimSpace(message.Content) == "" {
			return tenantchat.SanitizationResponse{}, tenantchat.ErrRuntimeUnavailable
		}
		messages[index] = message
	}
	return tenantchat.SanitizationResponse{
		Messages: messages, PolicyDigest: evaluation.PolicyDigest,
	}, nil
}
