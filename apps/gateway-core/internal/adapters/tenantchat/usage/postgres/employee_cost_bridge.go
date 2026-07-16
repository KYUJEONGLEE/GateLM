package postgres

import (
	"context"
	"time"

	employeepostgres "gatelm/apps/gateway-core/internal/adapters/employeecost/postgres"
	"gatelm/apps/gateway-core/internal/domain/employeecost"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/jackc/pgx/v5"
)

func (s *ReservationStore) recordEmployeeConfirmedAttempt(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
	attemptNo int,
	usage tenantchat.ConfirmedUsage,
	outcome string,
) error {
	ref, applied, err := s.employeeAttemptRef(requestContext, reservationID, attemptNo)
	if err != nil || !applied {
		return err
	}
	_, err = s.employeeCosts.RecordConfirmedAttempt(ctx, tx, employeepostgres.RecordConfirmedAttemptInput{
		AttemptRef: ref,
		Usage: employeepostgres.ConfirmedUsage{
			InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens,
			CacheReadInputTokens: usage.CacheReadInputTokens,
		},
		Outcome: employeecost.AttemptOutcome(outcome),
	})
	return employeeCostAdapterErrorOrNil(err)
}

func (s *ReservationStore) confirmEmployeePendingAttempt(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
	attemptNo int,
	usage tenantchat.ConfirmedUsage,
) error {
	ref, applied, err := s.employeeAttemptRef(requestContext, reservationID, attemptNo)
	if err != nil || !applied {
		return err
	}
	_, err = s.employeeCosts.ConfirmPendingAttempt(ctx, tx, employeepostgres.ConfirmPendingAttemptInput{
		AttemptRef: ref,
		Usage: employeepostgres.ConfirmedUsage{
			InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens,
			CacheReadInputTokens: usage.CacheReadInputTokens,
		},
	})
	return employeeCostAdapterErrorOrNil(err)
}

func (s *ReservationStore) recordEmployeePreCallFailure(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
	attemptNo int,
) error {
	ref, applied, err := s.employeeAttemptRef(requestContext, reservationID, attemptNo)
	if err != nil || !applied {
		return err
	}
	_, err = s.employeeCosts.RecordPreCallFailure(ctx, tx, ref)
	return employeeCostAdapterErrorOrNil(err)
}

func (s *ReservationStore) markEmployeePending(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
	attemptNo int,
	outcome string,
) error {
	ref, applied, err := s.employeeAttemptRef(requestContext, reservationID, attemptNo)
	if err != nil || !applied {
		return err
	}
	_, err = s.employeeCosts.MarkPending(ctx, tx, employeepostgres.MarkPendingInput{
		AttemptRef: ref,
		Outcome:    employeecost.AttemptOutcome(outcome),
	})
	return employeeCostAdapterErrorOrNil(err)
}

func (s *ReservationStore) settleEmployeeCost(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
	attemptNo int,
	expectedLedgerVersion int64,
) error {
	employeeID, applied, err := s.employeeCostActor(requestContext)
	if err != nil || !applied {
		return err
	}
	result, err := s.employeeCosts.Settle(ctx, tx, employeepostgres.SettleInput{
		TenantID: requestContext.ExecutionScope.TenantID, EmployeeID: employeeID,
		Surface: employeecost.SurfaceTenantChat, RequestID: requestContext.RequestID,
		ReservationID: reservationID, AttemptNo: attemptNo,
		ExpectedLedgerVersion: expectedLedgerVersion, Now: s.now().UTC(),
	})
	if err != nil {
		return employeeCostAdapterError(err)
	}
	return validateEmployeeLedgerVersion(result, expectedLedgerVersion+1)
}

func (s *ReservationStore) releaseEmployeeCost(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
	attemptNo *int,
	expectedLedgerVersion int64,
) error {
	employeeID, applied, err := s.employeeCostActor(requestContext)
	if err != nil || !applied {
		return err
	}
	result, err := s.employeeCosts.Release(ctx, tx, employeepostgres.ReleaseInput{
		TenantID: requestContext.ExecutionScope.TenantID, EmployeeID: employeeID,
		Surface: employeecost.SurfaceTenantChat, RequestID: requestContext.RequestID,
		ReservationID: reservationID, AttemptNo: attemptNo,
		ExpectedLedgerVersion: expectedLedgerVersion, Now: s.now().UTC(),
	})
	if err != nil {
		return employeeCostAdapterError(err)
	}
	return validateEmployeeLedgerVersion(result, expectedLedgerVersion+1)
}

func (s *ReservationStore) reconcileEmployeeCost(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
	expectedLedgerVersion int64,
	now time.Time,
) error {
	employeeID, applied, err := s.employeeCostActor(requestContext)
	if err != nil || !applied {
		return err
	}
	result, err := s.employeeCosts.ReconcileToUnconfirmed(ctx, tx, employeepostgres.ReconcileInput{
		TenantID: requestContext.ExecutionScope.TenantID, EmployeeID: employeeID,
		Surface: employeecost.SurfaceTenantChat, RequestID: requestContext.RequestID,
		ReservationID: reservationID, ExpectedLedgerVersion: expectedLedgerVersion,
		Now: now.UTC(),
	})
	if err != nil {
		return employeeCostAdapterError(err)
	}
	return validateEmployeeLedgerVersion(result, expectedLedgerVersion+1)
}

func (s *ReservationStore) applyEmployeeLateReceipt(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
	attemptNo int,
	usage tenantchat.ConfirmedUsage,
	expectedLedgerVersion int64,
	now time.Time,
) error {
	ref, applied, err := s.employeeAttemptRefAt(requestContext, reservationID, attemptNo, now)
	if err != nil || !applied {
		return err
	}
	result, err := s.employeeCosts.ApplyLateReceipt(ctx, tx, employeepostgres.LateReceiptInput{
		AttemptRef: ref,
		Usage: employeepostgres.ConfirmedUsage{
			InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens,
			CacheReadInputTokens: usage.CacheReadInputTokens,
		},
		ExpectedLedgerVersion: expectedLedgerVersion,
	})
	if err != nil {
		return employeeCostAdapterError(err)
	}
	return validateEmployeeLedgerVersion(result, expectedLedgerVersion+1)
}

func (s *ReservationStore) employeeAttemptRef(
	requestContext tenantchat.RequestContext,
	reservationID string,
	attemptNo int,
) (employeepostgres.AttemptRef, bool, error) {
	return s.employeeAttemptRefAt(requestContext, reservationID, attemptNo, s.now().UTC())
}

func (s *ReservationStore) employeeAttemptRefAt(
	requestContext tenantchat.RequestContext,
	reservationID string,
	attemptNo int,
	now time.Time,
) (employeepostgres.AttemptRef, bool, error) {
	employeeID, applied, err := s.employeeCostActor(requestContext)
	if err != nil || !applied {
		return employeepostgres.AttemptRef{}, applied, err
	}
	return employeepostgres.AttemptRef{
		TenantID: requestContext.ExecutionScope.TenantID, EmployeeID: employeeID,
		Surface: employeecost.SurfaceTenantChat, RequestID: requestContext.RequestID,
		ReservationID: reservationID, AttemptNo: attemptNo, Now: now.UTC(),
	}, true, nil
}

func (s *ReservationStore) employeeCostActor(
	requestContext tenantchat.RequestContext,
) (string, bool, error) {
	employeeID := employeeCostEmployeeID(requestContext)
	if employeeID == "" {
		return "", false, nil
	}
	if s == nil || s.employeeCosts == nil {
		return "", false, tenantchat.ErrUsageGuardUnavailable
	}
	return employeeID, true, nil
}

func employeeCostAdapterErrorOrNil(err error) error {
	if err == nil {
		return nil
	}
	return employeeCostAdapterError(err)
}

func validateEmployeeLedgerVersion(result employeepostgres.TransitionResult, expected int64) error {
	if !result.Applied {
		return nil
	}
	if result.LedgerVersion != expected {
		return tenantchat.ErrUsageGuardUnavailable
	}
	return nil
}
