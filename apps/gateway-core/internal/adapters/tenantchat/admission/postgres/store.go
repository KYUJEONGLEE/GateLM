package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

type admissionRow struct {
	AdmissionID     string
	EmployeeID      *string
	ActorKind       string
	RequestID       string
	TurnID          string
	IdempotencyKey  string
	BindingDigest   string
	SnapshotVersion int64
	State           string
	ExpiresAt       time.Time
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool, now: time.Now}
}

func (s *Store) Create(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	limits tenantchat.AdmissionLimits,
) (result tenantchat.Admission, err error) {
	if s == nil || s.pool == nil || !validLimits(limits) {
		return tenantchat.Admission{}, tenantchat.ErrUsageGuardUnavailable
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return tenantchat.Admission{}, tenantchat.ErrUsageGuardUnavailable
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	now := s.now().UTC()
	actor := requestContext.ExecutionScope.Actor
	if _, err = tx.Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
		requestContext.ExecutionScope.TenantID+":"+actor.UserID,
	); err != nil {
		return tenantchat.Admission{}, tenantchat.ErrUsageGuardUnavailable
	}
	if _, err = tx.Exec(ctx, `
		UPDATE tenant_chat_request_admissions
		SET state = 'expired', slot_released_at = COALESCE(slot_released_at, $3), updated_at = $3
		WHERE tenant_id = $1::uuid AND user_id = $2::uuid
		  AND state = 'active' AND expires_at <= $3
	`, requestContext.ExecutionScope.TenantID, actor.UserID, now); err != nil {
		return tenantchat.Admission{}, tenantchat.ErrUsageGuardUnavailable
	}

	existing, found, err := findByIdempotency(ctx, tx, requestContext)
	if err != nil {
		return tenantchat.Admission{}, tenantchat.ErrUsageGuardUnavailable
	}
	if found {
		if !sameAdmissionBinding(existing, requestContext) {
			return tenantchat.Admission{}, tenantchat.ErrIdempotencyConflict
		}
		if existing.State != "active" || !existing.ExpiresAt.After(now) {
			return tenantchat.Admission{}, tenantchat.ErrAdmissionExpired
		}
		if err = tx.Commit(ctx); err != nil {
			return tenantchat.Admission{}, tenantchat.ErrUsageGuardUnavailable
		}
		return tenantchat.Admission{
			AdmissionID: existing.AdmissionID,
			RequestID:   existing.RequestID,
			State:       existing.State,
			ExpiresAt:   existing.ExpiresAt,
			Replayed:    true,
		}, nil
	}

	var requestsInWindow int
	if err = tx.QueryRow(ctx, `
		SELECT count(*)
		FROM tenant_chat_request_admissions
		WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND created_at >= $3
	`, requestContext.ExecutionScope.TenantID, actor.UserID, now.Add(-limits.Window)).Scan(&requestsInWindow); err != nil {
		return tenantchat.Admission{}, tenantchat.ErrUsageGuardUnavailable
	}
	if requestsInWindow >= limits.RequestsPerWindow {
		return tenantchat.Admission{}, tenantchat.ErrRateLimited
	}

	var activeAdmissions int
	if err = tx.QueryRow(ctx, `
		SELECT count(*)
		FROM tenant_chat_request_admissions
		WHERE tenant_id = $1::uuid AND user_id = $2::uuid
		  AND state = 'active' AND expires_at > $3
	`, requestContext.ExecutionScope.TenantID, actor.UserID, now).Scan(&activeAdmissions); err != nil {
		return tenantchat.Admission{}, tenantchat.ErrUsageGuardUnavailable
	}
	if activeAdmissions >= limits.MaxActiveAdmissionsPerUser {
		return tenantchat.Admission{}, tenantchat.ErrConcurrencyLimited
	}

	admissionID, err := newUUID()
	if err != nil {
		return tenantchat.Admission{}, tenantchat.ErrUsageGuardUnavailable
	}
	expiresAt := now.Add(limits.AdmissionTTL)
	var employeeID any
	if actor.EmployeeID != "" {
		employeeID = actor.EmployeeID
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO tenant_chat_request_admissions (
		  admission_id, tenant_id, user_id, employee_id, actor_kind,
		  request_id, turn_id, idempotency_key, binding_digest,
		  snapshot_version, state, expires_at, created_at, updated_at
		) VALUES (
		  $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
		  $6, $7, $8, $9, $10, 'active', $11, $12, $12
		)
	`,
		admissionID,
		requestContext.ExecutionScope.TenantID,
		actor.UserID,
		employeeID,
		actor.ActorKind,
		requestContext.RequestID,
		requestContext.TurnID,
		requestContext.IdempotencyKey,
		requestContext.BindingDigest,
		requestContext.Snapshot.Version,
		expiresAt,
		now,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return tenantchat.Admission{}, tenantchat.ErrIdempotencyConflict
		}
		return tenantchat.Admission{}, tenantchat.ErrUsageGuardUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return tenantchat.Admission{}, tenantchat.ErrUsageGuardUnavailable
	}
	return tenantchat.Admission{
		AdmissionID: admissionID,
		RequestID:   requestContext.RequestID,
		State:       "active",
		ExpiresAt:   expiresAt,
	}, nil
}

func (s *Store) Cancel(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
) (result tenantchat.AdmissionCancellation, err error) {
	if s == nil || s.pool == nil {
		return tenantchat.AdmissionCancellation{}, tenantchat.ErrUsageGuardUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return tenantchat.AdmissionCancellation{}, tenantchat.ErrUsageGuardUnavailable
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	now := s.now().UTC()
	row, err := findByIDForUpdate(ctx, tx, requestContext)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tenantchat.AdmissionCancellation{}, tenantchat.ErrAdmissionExpired
		}
		return tenantchat.AdmissionCancellation{}, tenantchat.ErrUsageGuardUnavailable
	}
	if !sameAdmissionIdentity(row, requestContext) {
		return tenantchat.AdmissionCancellation{}, tenantchat.ErrIdempotencyConflict
	}
	if row.State == "cancelled" {
		if err = tx.Commit(ctx); err != nil {
			return tenantchat.AdmissionCancellation{}, tenantchat.ErrUsageGuardUnavailable
		}
		return tenantchat.AdmissionCancellation{
			AdmissionID: row.AdmissionID, RequestID: row.RequestID, State: "cancelled",
			SlotReleased: true, Replayed: true,
		}, nil
	}
	if row.State != "active" || !row.ExpiresAt.After(now) {
		if row.State == "active" {
			_, _ = tx.Exec(ctx, `
				UPDATE tenant_chat_request_admissions
				SET state = 'expired', slot_released_at = COALESCE(slot_released_at, $3), updated_at = $3
				WHERE admission_id = $1::uuid AND tenant_id = $2::uuid
			`, row.AdmissionID, requestContext.ExecutionScope.TenantID, now)
			if err = tx.Commit(ctx); err != nil {
				return tenantchat.AdmissionCancellation{}, tenantchat.ErrUsageGuardUnavailable
			}
		}
		return tenantchat.AdmissionCancellation{}, tenantchat.ErrAdmissionExpired
	}
	if _, err = tx.Exec(ctx, `
		UPDATE tenant_chat_request_admissions
		SET state = 'cancelled', cancelled_at = $3,
		    slot_released_at = COALESCE(slot_released_at, $3), updated_at = $3
		WHERE admission_id = $1::uuid AND tenant_id = $2::uuid AND state = 'active'
	`, row.AdmissionID, requestContext.ExecutionScope.TenantID, now); err != nil {
		return tenantchat.AdmissionCancellation{}, tenantchat.ErrUsageGuardUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return tenantchat.AdmissionCancellation{}, tenantchat.ErrUsageGuardUnavailable
	}
	return tenantchat.AdmissionCancellation{
		AdmissionID: row.AdmissionID, RequestID: row.RequestID, State: "cancelled", SlotReleased: true,
	}, nil
}

func (s *Store) ValidateActive(ctx context.Context, requestContext tenantchat.RequestContext) error {
	if s == nil || s.pool == nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	row, err := scanAdmission(s.pool.QueryRow(ctx, `
		SELECT admission_id::text, employee_id::text, actor_kind, request_id, turn_id,
		       idempotency_key, binding_digest, snapshot_version, state, expires_at
		FROM tenant_chat_request_admissions
		WHERE admission_id = $1::uuid AND tenant_id = $2::uuid AND user_id = $3::uuid
		LIMIT 1
	`, requestContext.AdmissionID, requestContext.ExecutionScope.TenantID, requestContext.ExecutionScope.Actor.UserID))
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return contextErr
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return tenantchat.ErrAdmissionExpired
		}
		return tenantchat.ErrUsageGuardUnavailable
	}
	if !sameAdmissionIdentity(row, requestContext) {
		return tenantchat.ErrIdempotencyConflict
	}
	if row.State != "active" || !row.ExpiresAt.After(s.now().UTC()) {
		return tenantchat.ErrAdmissionExpired
	}
	return nil
}

func findByIdempotency(ctx context.Context, tx pgx.Tx, requestContext tenantchat.RequestContext) (admissionRow, bool, error) {
	actor := requestContext.ExecutionScope.Actor
	row, err := scanAdmission(tx.QueryRow(ctx, `
		SELECT admission_id::text, employee_id::text, actor_kind, request_id, turn_id,
		       idempotency_key, binding_digest, snapshot_version, state, expires_at
		FROM tenant_chat_request_admissions
		WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND idempotency_key = $3
		FOR UPDATE
	`, requestContext.ExecutionScope.TenantID, actor.UserID, requestContext.IdempotencyKey))
	if errors.Is(err, pgx.ErrNoRows) {
		return admissionRow{}, false, nil
	}
	return row, err == nil, err
}

func findByIDForUpdate(ctx context.Context, tx pgx.Tx, requestContext tenantchat.RequestContext) (admissionRow, error) {
	return scanAdmission(tx.QueryRow(ctx, `
		SELECT admission_id::text, employee_id::text, actor_kind, request_id, turn_id,
		       idempotency_key, binding_digest, snapshot_version, state, expires_at
		FROM tenant_chat_request_admissions
		WHERE admission_id = $1::uuid AND tenant_id = $2::uuid AND user_id = $3::uuid
		FOR UPDATE
	`, requestContext.AdmissionID, requestContext.ExecutionScope.TenantID, requestContext.ExecutionScope.Actor.UserID))
}

func scanAdmission(row pgx.Row) (result admissionRow, err error) {
	err = row.Scan(
		&result.AdmissionID,
		&result.EmployeeID,
		&result.ActorKind,
		&result.RequestID,
		&result.TurnID,
		&result.IdempotencyKey,
		&result.BindingDigest,
		&result.SnapshotVersion,
		&result.State,
		&result.ExpiresAt,
	)
	return result, err
}

func sameAdmissionBinding(row admissionRow, requestContext tenantchat.RequestContext) bool {
	return sameAdmissionIdentity(row, requestContext) && row.BindingDigest == requestContext.BindingDigest
}

func sameAdmissionIdentity(row admissionRow, requestContext tenantchat.RequestContext) bool {
	actor := requestContext.ExecutionScope.Actor
	employeeID := ""
	if row.EmployeeID != nil {
		employeeID = *row.EmployeeID
	}
	return row.RequestID == requestContext.RequestID &&
		row.TurnID == requestContext.TurnID &&
		row.IdempotencyKey == requestContext.IdempotencyKey &&
		row.SnapshotVersion == requestContext.Snapshot.Version &&
		row.ActorKind == actor.ActorKind && employeeID == actor.EmployeeID
}

func validLimits(limits tenantchat.AdmissionLimits) bool {
	return limits.RequestsPerWindow > 0 && limits.Window > 0 &&
		limits.MaxActiveAdmissionsPerUser > 0 && limits.AdmissionTTL == 30*time.Second
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func newUUID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", fmt.Errorf("generate admission id: %w", err)
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%08x-%04x-%04x-%04x-%012x",
		value[0:4], value[4:6], value[6:8], value[8:10], value[10:16],
	), nil
}
