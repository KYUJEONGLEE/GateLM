package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/jackc/pgx/v5"
)

type admissionRecord struct {
	State     string
	ExpiresAt time.Time
	CreatedAt time.Time
	Safety    *tenantchat.SafetySummary
}

func (s *ReservationStore) RecordSafetySummary(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	summary tenantchat.SafetySummary,
) (replayed bool, err error) {
	if s == nil || s.pool == nil || tenantchat.ValidateSafetySummary(summary) != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	admission, err := lockAdmission(ctx, tx, requestContext)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, tenantchat.ErrAdmissionExpired
		}
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	if admission.Safety != nil {
		if !tenantchat.SameSafetySummary(admission.Safety, &summary) {
			return false, tenantchat.ErrIdempotencyConflict
		}
		if err = tx.Commit(ctx); err != nil {
			return false, tenantchat.ErrUsageGuardUnavailable
		}
		return true, nil
	}
	if admission.State != "active" || !admission.ExpiresAt.After(s.now().UTC()) {
		return false, tenantchat.ErrAdmissionExpired
	}
	detectedTypes, err := json.Marshal(summary.MaskingDetectedTypes)
	if err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_chat_request_admissions
		SET masking_action = $3, masking_detected_types = $4::jsonb,
		    masking_detected_count = $5, safety_policy_digest = $6, updated_at = $7
		WHERE admission_id = $1::uuid AND tenant_id = $2::uuid
		  AND state = 'active' AND safety_policy_digest IS NULL
	`, requestContext.AdmissionID, requestContext.ExecutionScope.TenantID,
		summary.MaskingAction, detectedTypes, summary.MaskingDetectedCount,
		summary.SafetyPolicyDigest, s.now().UTC())
	if err != nil || tag.RowsAffected() != 1 {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	return false, nil
}

func safetySummaryFromColumns(
	action *string,
	detectedTypesJSON *string,
	detectedCount *int,
	policyDigest *string,
) (*tenantchat.SafetySummary, error) {
	if action == nil && detectedTypesJSON == nil && detectedCount == nil && policyDigest == nil {
		return nil, nil
	}
	if action == nil || detectedTypesJSON == nil || detectedCount == nil || policyDigest == nil {
		return nil, errors.New("partial tenant chat safety summary")
	}
	var detectedTypes []string
	if err := json.Unmarshal([]byte(*detectedTypesJSON), &detectedTypes); err != nil {
		return nil, err
	}
	summary := &tenantchat.SafetySummary{
		MaskingAction:        *action,
		MaskingDetectedTypes: detectedTypes,
		MaskingDetectedCount: *detectedCount,
		SafetyPolicyDigest:   *policyDigest,
	}
	if err := tenantchat.ValidateSafetySummary(*summary); err != nil {
		return nil, err
	}
	return summary, nil
}

func addSafetySummaryPayload(payload map[string]any, summary *tenantchat.SafetySummary) error {
	if summary == nil {
		return nil
	}
	if err := tenantchat.ValidateSafetySummary(*summary); err != nil {
		return err
	}
	detectedTypes := summary.MaskingDetectedTypes
	if detectedTypes == nil {
		detectedTypes = []string{}
	}
	payload["maskingAction"] = summary.MaskingAction
	payload["maskingDetectedTypes"] = detectedTypes
	payload["maskingDetectedCount"] = summary.MaskingDetectedCount
	payload["safetyPolicyDigest"] = summary.SafetyPolicyDigest
	return nil
}

func addRoutingDifficultyPayload(
	payload map[string]any,
	requestContext tenantchat.RequestContext,
) error {
	if requestContext.Routing == nil {
		return nil
	}
	difficulty := requestContext.Routing.Difficulty
	if difficulty == "" {
		return nil
	}
	if difficulty != "simple" && difficulty != "complex" {
		return tenantchat.ErrUsageGuardUnavailable
	}
	payload["routingDifficulty"] = difficulty
	return nil
}
