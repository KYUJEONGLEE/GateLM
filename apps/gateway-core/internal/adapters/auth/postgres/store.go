package postgres

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/auth"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/scrypt"
)

type Queryer interface {
	Query(ctx context.Context, sql string, arguments ...any) (pgx.Rows, error)
}

type Store struct {
	db Queryer
}

var issuedCredentialPrefixes = []string{"gsk_live_", "gat_app_"}

type credentialCandidate struct {
	id            string
	tenantID      string
	projectID     string
	applicationID string
	secretHash    string
	hashAlgorithm string
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
		APIKeyID:      candidate.id,
		TenantID:      candidate.tenantID,
		ProjectID:     candidate.projectID,
		ApplicationID: candidate.applicationID,
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
	if lookup.prefix == "" || lookup.last4 == "" {
		return credentialCandidate{}, invalidErr
	}

	rows, err := s.db.Query(ctx, query, lookup.prefix, lookup.last4)
	if err != nil {
		return credentialCandidate{}, fmt.Errorf("query gateway credential candidates: %w", err)
	}
	candidates, err := readCredentialCandidates(rows)
	if err != nil {
		return credentialCandidate{}, err
	}

	var matched credentialCandidate
	for _, candidate := range candidates {
		if credentialSecretMatches(candidate.hashAlgorithm, candidate.secretHash, plaintext) {
			matched = candidate
		}
	}
	if matched.id == "" {
		return credentialCandidate{}, invalidErr
	}

	return matched, nil
}

func readCredentialCandidates(rows pgx.Rows) ([]credentialCandidate, error) {
	defer rows.Close()

	candidates := make([]credentialCandidate, 0, 1)
	for rows.Next() {
		var candidate credentialCandidate
		if err := rows.Scan(
			&candidate.id,
			&candidate.tenantID,
			&candidate.projectID,
			&candidate.applicationID,
			&candidate.secretHash,
			&candidate.hashAlgorithm,
		); err != nil {
			return nil, fmt.Errorf("scan gateway credential candidate: %w", err)
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read gateway credential candidates: %w", err)
	}
	return candidates, nil
}

type credentialLookup struct {
	prefix string
	last4  string
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
		prefix: prefix,
		last4:  last4,
	}
}

func knownCredentialPrefix(plaintext string) string {
	for _, prefix := range issuedCredentialPrefixes {
		if strings.HasPrefix(plaintext, prefix) && len(plaintext) > len(prefix) {
			return prefix
		}
	}

	if strings.HasPrefix(plaintext, "glm_") {
		return legacyDemoCredentialPrefix(plaintext)
	}

	parts := strings.SplitN(plaintext, "_", 3)
	if len(parts) < 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return ""
	}
	return parts[0] + "_" + parts[1] + "_"
}

func legacyDemoCredentialPrefix(plaintext string) string {
	prefixEnd := strings.LastIndexByte(plaintext, '_') + 1
	if prefixEnd <= 1 || prefixEnd >= len(plaintext) {
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

const (
	credentialHashAlgorithmSHA256 = "sha256"
	credentialHashAlgorithmScrypt = "scrypt-v1"
	credentialScryptN             = 32768
	credentialScryptR             = 8
	credentialScryptP             = 1
	credentialScryptKeyLength     = 32
	credentialScryptSaltLength    = 16
)

func credentialSecretMatches(hashAlgorithm, encodedHash, plaintext string) bool {
	normalized := strings.TrimSpace(plaintext)
	if normalized == "" || encodedHash == "" {
		return false
	}

	switch hashAlgorithm {
	case credentialHashAlgorithmSHA256:
		return credentialHashesEqual(encodedHash, credentialHash(normalized))
	case credentialHashAlgorithmScrypt:
		return scryptCredentialSecretMatches(encodedHash, normalized)
	default:
		return false
	}
}

func scryptCredentialSecretMatches(encodedHash, plaintext string) bool {
	parts := strings.Split(encodedHash, "$")
	if len(parts) != 6 || parts[0] != credentialHashAlgorithmScrypt ||
		parts[1] != strconv.Itoa(credentialScryptN) ||
		parts[2] != strconv.Itoa(credentialScryptR) ||
		parts[3] != strconv.Itoa(credentialScryptP) {
		return false
	}

	salt, err := base64.RawURLEncoding.DecodeString(parts[4])
	if err != nil || len(salt) != credentialScryptSaltLength {
		return false
	}
	expected, err := base64.RawURLEncoding.DecodeString(parts[5])
	if err != nil || len(expected) != credentialScryptKeyLength {
		return false
	}
	actual, err := scrypt.Key([]byte(plaintext), salt, credentialScryptN, credentialScryptR, credentialScryptP, credentialScryptKeyLength)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(expected, actual) == 1
}

const apiKeyLookupSQL = `
select
  api_keys.id::text,
  api_keys."tenantId"::text,
  api_keys."projectId"::text,
  coalesce(default_application.id::text, '') as "applicationId",
  api_keys."secretHash",
  api_keys."hashAlgorithm"
from gateway_api_keys api_keys
join projects on projects.id = api_keys."projectId"
  and projects."tenantId" = api_keys."tenantId"
  and projects.status = 'ACTIVE'
left join lateral (
  select applications.id
  from applications
  where applications."tenantId" = api_keys."tenantId"
    and applications."projectId" = api_keys."projectId"
    and applications.status = 'ACTIVE'
  order by applications."createdAt" asc, applications.id asc
  limit 1
) default_application on true
where api_keys.prefix = $1
  and api_keys."last4" = $2
  and api_keys."hashAlgorithm" in ('sha256', 'scrypt-v1')
  and api_keys.status = 'ACTIVE'
  and (api_keys."expiresAt" is null or api_keys."expiresAt" > now())
order by api_keys."createdAt" desc`

const appTokenLookupSQL = `
select
  id::text,
  "tenantId"::text,
  "projectId"::text,
  "applicationId"::text,
  "secretHash",
  "hashAlgorithm"
from app_tokens
where prefix = $1
  and "last4" = $2
  and "hashAlgorithm" in ('sha256', 'scrypt-v1')
  and status = 'ACTIVE'
  and ("expiresAt" is null or "expiresAt" > now())
order by "createdAt" desc`
