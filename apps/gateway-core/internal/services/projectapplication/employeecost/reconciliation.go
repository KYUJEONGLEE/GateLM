package employeecostservice

import (
	"context"
	"errors"
	"time"

	employeepostgres "gatelm/apps/gateway-core/internal/adapters/employeecost/postgres"
	"gatelm/apps/gateway-core/internal/domain/employeecost"

	"github.com/jackc/pgx/v5"
)

const (
	reconciliationInterval   = 30 * time.Second
	reconciliationPendingAge = 15 * time.Minute
	reconciliationBatchSize  = 100
)

func (s *Service) RunReconciliation(ctx context.Context) {
	if s == nil || s.pool == nil {
		return
	}
	_ = s.ProcessReconciliation(ctx)
	ticker := time.NewTicker(reconciliationInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = s.ProcessReconciliation(ctx)
		}
	}
}

func (s *Service) ProcessReconciliation(ctx context.Context) error {
	for index := 0; index < reconciliationBatchSize; index++ {
		processed, err := s.reconcileNextPending(ctx, s.now().UTC().Add(-reconciliationPendingAge))
		if err != nil || !processed {
			return err
		}
	}
	return nil
}

func (s *Service) reconcileNextPending(ctx context.Context, cutoff time.Time) (processed bool, err error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	var tenantID, employeeID, requestID, reservationID string
	var ledgerVersion int64
	err = tx.QueryRow(ctx, `
		SELECT tenant_id::text, employee_id::text, request_id,
		       reservation_id::text, ledger_version
		FROM tenant_employee_cost_reservations
		WHERE surface = 'project_application' AND state = 'reserved'
		  AND usage_pending_at IS NOT NULL AND usage_pending_at <= $1
		ORDER BY usage_pending_at, reservation_id
		FOR UPDATE SKIP LOCKED
		LIMIT 1
	`, cutoff).Scan(&tenantID, &employeeID, &requestID, &reservationID, &ledgerVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	rows, err := tx.Query(ctx, `
		SELECT attempt_no
		FROM tenant_employee_cost_provider_attempts
		WHERE surface = 'project_application' AND request_id = $1
		  AND reservation_id = $2::uuid AND usage_quality = 'not_available'
		ORDER BY attempt_no
	`, requestID, reservationID)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	attempts := make([]int, 0, 1)
	for rows.Next() {
		var attemptNo int
		if err := rows.Scan(&attemptNo); err != nil {
			return false, err
		}
		attempts = append(attempts, attemptNo)
	}
	err = rows.Err()
	if err != nil {
		return false, err
	}
	now := s.now().UTC()
	for _, attemptNo := range attempts {
		result, markErr := s.store.MarkPending(ctx, tx, employeepostgres.MarkPendingInput{
			AttemptRef: employeepostgres.AttemptRef{
				TenantID: tenantID, EmployeeID: employeeID,
				Surface: employeecost.SurfaceProjectApplication, RequestID: requestID,
				ReservationID: reservationID, AttemptNo: attemptNo, Now: now,
			},
			Outcome: employeecost.AttemptOutcomeTimedOut,
		})
		if markErr != nil {
			return false, markErr
		}
		ledgerVersion = result.LedgerVersion
	}
	_, err = s.store.ReconcileToUnconfirmed(ctx, tx, employeepostgres.ReconcileInput{
		TenantID: tenantID, EmployeeID: employeeID,
		Surface: employeecost.SurfaceProjectApplication, RequestID: requestID,
		ReservationID: reservationID, ExpectedLedgerVersion: ledgerVersion, Now: now,
	})
	if err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}
