package postgres

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/auth"

	"github.com/jackc/pgx/v5"
)

type Queryer interface {
	Query(ctx context.Context, sql string, arguments ...any) (pgx.Rows, error)
}

type Store struct {
	db Queryer
}

type credentialCandidate struct {
	id            string
	tenantID      string
	projectID     string
	applicationID string
	secretHash    string
}

func NewStore(db Queryer) *Store {
	return &Store{db: db}
}

func (s *Store) AuthenticateAPIKey(ctx context.Context, bearerToken string) (auth.APIKeyIdentity, error) {
	candidate, err := s.findMatchingCredential(ctx, bearerToken, apiKeyLookupSQL, auth.ErrInvalidAPIKey)
	if err != nil {
		return auth.APIKeyIdentity{}, err
	}

	return auth.APIKeyIdentity{
		APIKeyID:  candidate.id,
		TenantID:  candidate.tenantID,
		ProjectID: candidate.projectID,
	}, nil
}

func (s *Store) ValidateAppToken(ctx context.Context, appToken string) (auth.AppTokenIdentity, error) {
	candidate, err := s.findMatchingCredential(ctx, appToken, appTokenLookupSQL, auth.ErrInvalidAppToken)
	if err != nil {
		return auth.AppTokenIdentity{}, err
	}

	return auth.AppTokenIdentity{
		AppTokenID:    candidate.id,
		TenantID:      candidate.tenantID,
		ProjectID:     candidate.projectID,
		ApplicationID: candidate.applicationID,
	}, nil
}

func (s *Store) findMatchingCredential(ctx context.Context, plaintext string, query string, invalidErr error) (credentialCandidate, error) {
	if err := ctx.Err(); err != nil {
		return credentialCandidate{}, err
	}
	if s == nil || s.db == nil {
		return credentialCandidate{}, errors.New("postgres credential store requires a database queryer")
	}

	lookup := credentialLookupFromPlaintext(plaintext)
	if lookup.prefix == "" || lookup.last4 == "" || lookup.secretHash == "" {
		return credentialCandidate{}, invalidErr
	}

	rows, err := s.db.Query(ctx, query, lookup.prefix, lookup.last4)
	if err != nil {
		return credentialCandidate{}, fmt.Errorf("query gateway credential candidates: %w", err)
	}
	defer rows.Close()

	var matched credentialCandidate
	for rows.Next() {
		var candidate credentialCandidate
		if err := rows.Scan(
			&candidate.id,
			&candidate.tenantID,
			&candidate.projectID,
			&candidate.applicationID,
			&candidate.secretHash,
		); err != nil {
			return credentialCandidate{}, fmt.Errorf("scan gateway credential candidate: %w", err)
		}

		if credentialHashesEqual(candidate.secretHash, lookup.secretHash) {
			matched = candidate
		}
	}
	if err := rows.Err(); err != nil {
		return credentialCandidate{}, fmt.Errorf("read gateway credential candidates: %w", err)
	}
	if matched.id == "" {
		return credentialCandidate{}, invalidErr
	}

	return matched, nil
}

type credentialLookup struct {
	prefix     string
	last4      string
	secretHash string
}

func credentialLookupFromPlaintext(plaintext string) credentialLookup {
	normalized := strings.TrimSpace(plaintext)
	if normalized == "" {
		return credentialLookup{}
	}

	prefix := knownCredentialPrefix(normalized)
	if prefix == "" {
		return credentialLookup{}
	}

	last4 := normalized
	if len(last4) > 4 {
		last4 = last4[len(last4)-4:]
	}

	return credentialLookup{
		prefix:     prefix,
		last4:      last4,
		secretHash: credentialHash(normalized),
	}
}

func knownCredentialPrefix(plaintext string) string {
	first := strings.IndexByte(plaintext, '_')
	if first <= 0 || first >= len(plaintext)-1 {
		return ""
	}
	second := strings.IndexByte(plaintext[first+1:], '_')
	if second <= 0 {
		return ""
	}
	prefixEnd := first + 1 + second + 1
	if prefixEnd >= len(plaintext) {
		return ""
	}
	return plaintext[:prefixEnd]
}

func credentialHash(value string) string {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return ""
	}

	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:])
}

func credentialHashesEqual(expected string, actual string) bool {
	if expected == "" || actual == "" {
		return false
	}

	return subtle.ConstantTimeCompare([]byte(expected), []byte(actual)) == 1
}

const apiKeyLookupSQL = `
select
  id::text,
  "tenantId"::text,
  "projectId"::text,
  ''::text as "applicationId",
  "secretHash"
from gateway_api_keys
where prefix = $1
  and "last4" = $2
  and "hashAlgorithm" = 'sha256'
  and status = 'ACTIVE'
  and ("expiresAt" is null or "expiresAt" > now())
order by "createdAt" desc`

const appTokenLookupSQL = `
select
  id::text,
  "tenantId"::text,
  "projectId"::text,
  "applicationId"::text,
  "secretHash"
from app_tokens
where prefix = $1
  and "last4" = $2
  and "hashAlgorithm" = 'sha256'
  and status = 'ACTIVE'
  and ("expiresAt" is null or "expiresAt" > now())
order by "createdAt" desc`
