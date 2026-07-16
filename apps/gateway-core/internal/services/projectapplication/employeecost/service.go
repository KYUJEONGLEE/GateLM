package employeecostservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	employeepostgres "gatelm/apps/gateway-core/internal/adapters/employeecost/postgres"
	"gatelm/apps/gateway-core/internal/domain/costing"
	"gatelm/apps/gateway-core/internal/domain/employeecost"
	"gatelm/apps/gateway-core/internal/ports"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	estimateVersion             = "utf8_message_bytes_v1"
	coverageInvalidationTimeout = 3 * time.Second
)

type Service struct {
	pool    *pgxpool.Pool
	store   *employeepostgres.Store
	pricing costing.PricingCatalog
	now     func() time.Time
}

func NewService(pool *pgxpool.Pool, pricing costing.PricingCatalog) *Service {
	return &Service{pool: pool, store: employeepostgres.NewStore(), pricing: pricing, now: time.Now}
}

func (s *Service) Reserve(ctx context.Context, input ports.EmployeeCostReserveRequest) (ports.EmployeeCostReservation, error) {
	if strings.TrimSpace(input.EmployeeID) == "" {
		return ports.EmployeeCostReservation{}, nil
	}
	mode, enabled, err := s.effectiveMode(ctx, input.TenantID)
	if err != nil {
		return ports.EmployeeCostReservation{}, guardError(err)
	}
	if !enabled || mode == employeecost.RolloutModeOff {
		return ports.EmployeeCostReservation{}, nil
	}
	now := s.now().UTC()
	pin, err := s.pricingPin(ctx, input.ProviderPricingKeys, input.ModelPricingKeys, input.EstimatedInputTokens, input.MaxOutputTokens, now)
	if err != nil {
		s.invalidateCoverage(ctx, input.TenantID, "PROJECT_APPLICATION_GUARD_INPUT_UNAVAILABLE", now)
		if mode == employeecost.RolloutModeShadow {
			return ports.EmployeeCostReservation{Observed: true, CoverageInvalid: true}, nil
		}
		return ports.EmployeeCostReservation{}, guardError(err)
	}
	reservationID := deterministicReservationID(input.TenantID, input.RequestID)
	primary := employeepostgres.AttemptInput{
		AttemptNo:  1,
		Kind:       employeecost.AttemptKindPrimary,
		ProviderID: strings.TrimSpace(input.ProviderID),
		ModelKey:   strings.TrimSpace(input.ModelKey),
		Pricing:    pin,
	}
	var result employeepostgres.ReserveResult
	err = s.inTransaction(ctx, func(tx pgx.Tx) error {
		var reserveErr error
		result, reserveErr = s.store.Reserve(ctx, tx, employeepostgres.ReserveInput{
			TenantID:                input.TenantID,
			EmployeeID:              input.EmployeeID,
			Surface:                 employeecost.SurfaceProjectApplication,
			RequestID:               input.RequestID,
			ReservationID:           reservationID,
			CandidateTier:           input.CandidateTier,
			RestrictedFromHigh:      input.RestrictedFromHigh,
			Pricing:                 pin,
			PrimaryAttempt:          &primary,
			DispatchIntentExpiresAt: input.DispatchIntentExpiresAt,
			Now:                     now,
		})
		return reserveErr
	})
	if err != nil {
		s.invalidateCoverage(ctx, input.TenantID, "PROJECT_APPLICATION_ACCOUNTING_ERROR", now)
		if mode == employeecost.RolloutModeShadow {
			return ports.EmployeeCostReservation{Observed: true, CoverageInvalid: true}, nil
		}
		return ports.EmployeeCostReservation{}, guardError(err)
	}
	reservation := ports.EmployeeCostReservation{
		Active:           result.Decision == employeepostgres.DecisionReserved || result.Decision == employeepostgres.DecisionObserved,
		Observed:         result.Decision == employeepostgres.DecisionObserved,
		RestrictHighCost: result.RestrictHighCost,
		GuardUnavailable: result.GuardUnavailable,
		CoverageInvalid:  result.CoverageInvalid,
		TenantID:         input.TenantID,
		EmployeeID:       input.EmployeeID,
		RequestID:        input.RequestID,
		ReservationID:    result.ReservationID,
		AttemptNo:        1,
		LedgerVersion:    result.LedgerVersion,
	}
	return reservation, nil
}

func (s *Service) TopUp(ctx context.Context, reservation *ports.EmployeeCostReservation, input ports.EmployeeCostTopUpRequest) (ports.EmployeeCostAttemptDecision, error) {
	if reservation == nil || !reservation.Active {
		return ports.EmployeeCostAttemptDecision{}, nil
	}
	now := s.now().UTC()
	pin, err := s.pricingPin(ctx, input.ProviderPricingKeys, input.ModelPricingKeys, input.EstimatedInputTokens, input.MaxOutputTokens, now)
	if err != nil {
		s.invalidateCoverage(ctx, reservation.TenantID, "PROJECT_APPLICATION_GUARD_INPUT_UNAVAILABLE", now)
		if reservation.Observed {
			reservation.Active = false
			reservation.HasPending = true
			return ports.EmployeeCostAttemptDecision{}, nil
		}
		return ports.EmployeeCostAttemptDecision{}, guardError(err)
	}
	nextAttempt := reservation.AttemptNo + 1
	var result employeepostgres.TopUpResult
	err = s.inTransaction(ctx, func(tx pgx.Tx) error {
		var topUpErr error
		result, topUpErr = s.store.TopUpAttempt(ctx, tx, employeepostgres.TopUpAttemptInput{
			TenantID:      reservation.TenantID,
			EmployeeID:    reservation.EmployeeID,
			Surface:       employeecost.SurfaceProjectApplication,
			RequestID:     reservation.RequestID,
			ReservationID: reservation.ReservationID,
			CandidateTier: input.CandidateTier,
			Attempt: employeepostgres.AttemptInput{
				AttemptNo:  nextAttempt,
				Kind:       employeecost.AttemptKindFallback,
				ProviderID: strings.TrimSpace(input.ProviderID),
				ModelKey:   strings.TrimSpace(input.ModelKey),
				Pricing:    pin,
			},
			DispatchIntentExpiresAt: input.DispatchIntentExpiresAt,
			Now:                     now,
		})
		return topUpErr
	})
	if err != nil {
		s.invalidateCoverage(ctx, reservation.TenantID, "PROJECT_APPLICATION_ACCOUNTING_ERROR", now)
		if reservation.Observed {
			reservation.Active = false
			reservation.HasPending = true
			return ports.EmployeeCostAttemptDecision{}, nil
		}
		return ports.EmployeeCostAttemptDecision{}, guardError(err)
	}
	decision := ports.EmployeeCostAttemptDecision{
		Active:           result.Applied && !result.RestrictHighCost && !result.GuardUnavailable,
		RestrictHighCost: result.RestrictHighCost,
		GuardUnavailable: result.GuardUnavailable,
		CoverageInvalid:  result.CoverageInvalid,
		AttemptNo:        nextAttempt,
	}
	if decision.Active {
		reservation.AttemptNo = nextAttempt
		reservation.LedgerVersion = result.LedgerVersion
	}
	return decision, nil
}

func (s *Service) MarkDispatched(ctx context.Context, reservation *ports.EmployeeCostReservation) error {
	return s.transition(ctx, reservation, func(tx pgx.Tx, ref employeepostgres.AttemptRef) (employeepostgres.TransitionResult, error) {
		return s.store.MarkDispatched(ctx, tx, ref)
	})
}

func (s *Service) RecordConfirmed(ctx context.Context, reservation *ports.EmployeeCostReservation, usage ports.EmployeeCostUsage, outcome employeecost.AttemptOutcome) error {
	return s.transition(ctx, reservation, func(tx pgx.Tx, ref employeepostgres.AttemptRef) (employeepostgres.TransitionResult, error) {
		return s.store.RecordConfirmedAttempt(ctx, tx, employeepostgres.RecordConfirmedAttemptInput{
			AttemptRef: ref,
			Usage: employeepostgres.ConfirmedUsage{
				InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens,
				CacheReadInputTokens: usage.CacheReadInputTokens,
			},
			Outcome: outcome,
		})
	})
}

func (s *Service) RecordPreCallFailure(ctx context.Context, reservation *ports.EmployeeCostReservation) error {
	return s.transition(ctx, reservation, func(tx pgx.Tx, ref employeepostgres.AttemptRef) (employeepostgres.TransitionResult, error) {
		return s.store.RecordPreCallFailure(ctx, tx, ref)
	})
}

func (s *Service) MarkPending(ctx context.Context, reservation *ports.EmployeeCostReservation, outcome employeecost.AttemptOutcome) error {
	err := s.transition(ctx, reservation, func(tx pgx.Tx, ref employeepostgres.AttemptRef) (employeepostgres.TransitionResult, error) {
		return s.store.MarkPending(ctx, tx, employeepostgres.MarkPendingInput{AttemptRef: ref, Outcome: outcome})
	})
	if err == nil && reservation != nil && reservation.Active {
		reservation.HasPending = true
	}
	return err
}

func (s *Service) Settle(ctx context.Context, reservation *ports.EmployeeCostReservation) (int64, error) {
	if reservation == nil || !reservation.Active || reservation.HasPending {
		return 0, nil
	}
	now := s.now().UTC()
	var result employeepostgres.TransitionResult
	err := s.inTransaction(ctx, func(tx pgx.Tx) error {
		var settleErr error
		result, settleErr = s.store.Settle(ctx, tx, employeepostgres.SettleInput{
			TenantID: reservation.TenantID, EmployeeID: reservation.EmployeeID,
			Surface: employeecost.SurfaceProjectApplication, RequestID: reservation.RequestID,
			ReservationID: reservation.ReservationID, AttemptNo: reservation.AttemptNo,
			ExpectedLedgerVersion: reservation.LedgerVersion, Now: now,
		})
		return settleErr
	})
	if err != nil {
		s.invalidateCoverage(ctx, reservation.TenantID, "PROJECT_APPLICATION_ACCOUNTING_ERROR", now)
		if reservation.Observed {
			reservation.Active = false
			reservation.HasPending = true
			return 0, nil
		}
		return 0, guardError(err)
	}
	reservation.Active = false
	reservation.LedgerVersion = result.LedgerVersion
	return result.ConfirmedCostMicroUSD, nil
}

func (s *Service) Release(ctx context.Context, reservation *ports.EmployeeCostReservation) error {
	if reservation == nil || !reservation.Active || reservation.HasPending {
		return nil
	}
	now := s.now().UTC()
	var result employeepostgres.TransitionResult
	err := s.inTransaction(ctx, func(tx pgx.Tx) error {
		var releaseErr error
		result, releaseErr = s.store.Release(ctx, tx, employeepostgres.ReleaseInput{
			TenantID: reservation.TenantID, EmployeeID: reservation.EmployeeID,
			Surface: employeecost.SurfaceProjectApplication, RequestID: reservation.RequestID,
			ReservationID: reservation.ReservationID, ExpectedLedgerVersion: reservation.LedgerVersion,
			Now: now,
		})
		return releaseErr
	})
	if err != nil {
		s.invalidateCoverage(ctx, reservation.TenantID, "PROJECT_APPLICATION_ACCOUNTING_ERROR", now)
		if reservation.Observed {
			reservation.Active = false
			reservation.HasPending = true
			return nil
		}
		return guardError(err)
	}
	reservation.Active = false
	reservation.LedgerVersion = result.LedgerVersion
	return nil
}

func (s *Service) transition(ctx context.Context, reservation *ports.EmployeeCostReservation, call func(pgx.Tx, employeepostgres.AttemptRef) (employeepostgres.TransitionResult, error)) error {
	if reservation == nil || !reservation.Active {
		return nil
	}
	now := s.now().UTC()
	ref := employeepostgres.AttemptRef{
		TenantID: reservation.TenantID, EmployeeID: reservation.EmployeeID,
		Surface: employeecost.SurfaceProjectApplication, RequestID: reservation.RequestID,
		ReservationID: reservation.ReservationID, AttemptNo: reservation.AttemptNo, Now: now,
	}
	var result employeepostgres.TransitionResult
	err := s.inTransaction(ctx, func(tx pgx.Tx) error {
		var transitionErr error
		result, transitionErr = call(tx, ref)
		return transitionErr
	})
	if err != nil {
		s.invalidateCoverage(ctx, reservation.TenantID, "PROJECT_APPLICATION_ACCOUNTING_ERROR", now)
		if reservation.Observed {
			reservation.Active = false
			reservation.HasPending = true
			return nil
		}
		return guardError(err)
	}
	reservation.LedgerVersion = result.LedgerVersion
	return nil
}

func (s *Service) pricingPin(ctx context.Context, providerKeys, modelKeys []string, estimatedInputTokens, maxOutputTokens int64, now time.Time) (employeecost.PricingPin, error) {
	if s == nil || s.pricing == nil || estimatedInputTokens < 1 || maxOutputTokens < 1 {
		return employeecost.PricingPin{}, employeecost.ErrGuardUnavailable
	}
	rule, err := s.pricing.LookupPricingRule(ctx, costing.PricingLookup{
		ProviderKeys: providerKeys, ModelKeys: modelKeys, EffectiveAt: now,
	})
	if err != nil {
		return employeecost.PricingPin{}, err
	}
	pin := employeecost.PricingPin{
		RuleID: strings.TrimSpace(rule.ID), Version: strings.TrimSpace(rule.PricingVersion),
		Currency:                 strings.TrimSpace(rule.Currency),
		InputMicroUSDPerMillion:  rule.InputMicroUSDPer1MTokens,
		OutputMicroUSDPerMillion: rule.OutputMicroUSDPer1MTokens,
		EstimateVersion:          estimateVersion, EstimatedInputTokens: estimatedInputTokens,
		MaxOutputTokens: maxOutputTokens,
	}
	if err := pin.Validate(); err != nil {
		return employeecost.PricingPin{}, err
	}
	return pin, nil
}

func (s *Service) effectiveMode(ctx context.Context, tenantID string) (employeecost.RolloutMode, bool, error) {
	if s == nil || s.pool == nil || strings.TrimSpace(tenantID) == "" {
		return "", false, employeecost.ErrGuardUnavailable
	}
	var raw string
	var activation *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT mode, activation_boundary_at
		FROM tenant_employee_cost_ledger_rollouts
		WHERE tenant_id = $1::uuid
	`, tenantID).Scan(&raw, &activation)
	if errors.Is(err, pgx.ErrNoRows) {
		return employeecost.RolloutModeOff, false, nil
	}
	if err != nil {
		return "", false, err
	}
	mode, err := (employeecost.Rollout{Mode: employeecost.RolloutMode(raw), ActivationBoundaryAt: activation}).EffectiveMode(s.now().UTC())
	return mode, true, err
}

func (s *Service) inTransaction(ctx context.Context, call func(pgx.Tx) error) (err error) {
	if s == nil || s.pool == nil || s.store == nil {
		return employeecost.ErrGuardUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err = call(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) invalidateCoverage(ctx context.Context, tenantID, code string, now time.Time) {
	tenantID = strings.TrimSpace(tenantID)
	code = strings.TrimSpace(code)
	if s == nil || s.pool == nil || tenantID == "" || code == "" {
		return
	}
	now = now.UTC()
	durableCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), coverageInvalidationTimeout)
	defer cancel()
	_ = s.inTransaction(durableCtx, func(tx pgx.Tx) error {
		var previous rolloutAuditSnapshot
		err := tx.QueryRow(durableCtx, `
			SELECT mode, activation_boundary_at, project_application_covered_from,
			       tenant_chat_covered_from, coverage_invalidated_at,
			       coverage_error_code, version, updated_by_kind, updated_by
			FROM tenant_employee_cost_ledger_rollouts
			WHERE tenant_id = $1::uuid
			FOR UPDATE
		`, tenantID).Scan(
			&previous.Mode,
			&previous.ActivationBoundaryAt,
			&previous.ProjectApplicationCoveredFrom,
			&previous.TenantChatCoveredFrom,
			&previous.CoverageInvalidatedAt,
			&previous.CoverageErrorCode,
			&previous.Version,
			&previous.UpdatedByKind,
			&previous.UpdatedBy,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if previous.Mode == string(employeecost.RolloutModeOff) || previous.CoverageInvalidatedAt != nil {
			return nil
		}

		next := previous
		next.CoverageInvalidatedAt = &now
		next.CoverageErrorCode = &code
		next.Version++
		next.UpdatedByKind = "system"
		next.UpdatedBy = "gateway"
		previousJSON, err := json.Marshal(previous)
		if err != nil {
			return err
		}
		nextJSON, err := json.Marshal(next)
		if err != nil {
			return err
		}

		updated, err := tx.Exec(durableCtx, `
			UPDATE tenant_employee_cost_ledger_rollouts
			SET coverage_invalidated_at = $3,
			    coverage_error_code = $4,
			    version = $5,
			    updated_by_kind = $6,
			    updated_by = $7,
			    updated_at = $3
			WHERE tenant_id = $1::uuid AND version = $2
		`, tenantID, previous.Version, now, code, next.Version, next.UpdatedByKind, next.UpdatedBy)
		if err != nil {
			return err
		}
		if updated.RowsAffected() != 1 {
			return errors.New("employee cost rollout invalidation version conflict")
		}

		_, err = tx.Exec(durableCtx, `
			INSERT INTO tenant_employee_cost_ledger_rollout_audits (
				tenant_id, actor_kind, actor_id, rollout_version, action,
				previous_rollout, next_rollout, created_at
			) VALUES (
				$1::uuid, $2, $3, $4, 'coverage_invalidated',
				$5::jsonb, $6::jsonb, $7
			)
		`, tenantID, next.UpdatedByKind, next.UpdatedBy, next.Version, previousJSON, nextJSON, now)
		return err
	})
}

type rolloutAuditSnapshot struct {
	Mode                          string     `json:"mode"`
	ActivationBoundaryAt          *time.Time `json:"activationBoundaryAt"`
	ProjectApplicationCoveredFrom *time.Time `json:"projectApplicationCoveredFrom"`
	TenantChatCoveredFrom         *time.Time `json:"tenantChatCoveredFrom"`
	CoverageInvalidatedAt         *time.Time `json:"coverageInvalidatedAt"`
	CoverageErrorCode             *string    `json:"coverageErrorCode"`
	Version                       int64      `json:"version"`
	UpdatedByKind                 string     `json:"updatedByKind"`
	UpdatedBy                     string     `json:"updatedBy"`
}

func deterministicReservationID(tenantID, requestID string) string {
	sum := sha256.Sum256([]byte("project_application\x00" + tenantID + "\x00" + requestID))
	b := sum[:16]
	b[6] = (b[6] & 0x0f) | 0x50
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s-%s-%s-%s-%s", hex.EncodeToString(b[0:4]), hex.EncodeToString(b[4:6]), hex.EncodeToString(b[6:8]), hex.EncodeToString(b[8:10]), hex.EncodeToString(b[10:16]))
}

func guardError(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%w: %v", employeecost.ErrGuardUnavailable, err)
}
