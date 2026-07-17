package postgres

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/auth"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/scrypt"
)

func TestStoreAuthenticatesAPIKeyWithHashCandidate(t *testing.T) {
	plaintext := "gsk_live_test_secret_1234"
	queryer := &fakeQueryer{
		rows: newFakeRows([]credentialCandidate{{
			id:            "00000000-0000-4000-8000-000000000400",
			tenantID:      "00000000-0000-4000-8000-000000000100",
			projectID:     "00000000-0000-4000-8000-000000000200",
			applicationID: "00000000-0000-4000-8000-000000000300",
			secretHash:    credentialHash(plaintext),
			hashAlgorithm: credentialHashAlgorithmSHA256,
		}}),
	}

	identity, err := NewStore(queryer).AuthenticateAPIKey(context.Background(), plaintext)
	if err != nil {
		t.Fatalf("AuthenticateAPIKey returned error: %v", err)
	}

	if identity.APIKeyID != "00000000-0000-4000-8000-000000000400" ||
		identity.TenantID != "00000000-0000-4000-8000-000000000100" ||
		identity.ProjectID != "00000000-0000-4000-8000-000000000200" ||
		identity.ApplicationID != "00000000-0000-4000-8000-000000000300" {
		t.Fatalf("unexpected api key identity: %+v", identity)
	}
	assertLookupArgs(t, queryer, "gsk_live_", "1234")
}

func TestAPIKeyLookupRequiresActiveProject(t *testing.T) {
	if !strings.Contains(apiKeyLookupSQL, "join projects") ||
		!strings.Contains(apiKeyLookupSQL, "projects.status = 'ACTIVE'") {
		t.Fatal("api key lookup must require the owning project to be ACTIVE")
	}
}

func TestStoreRejectsAPIKeyHashMismatch(t *testing.T) {
	queryer := &fakeQueryer{
		rows: newFakeRows([]credentialCandidate{{
			id:            "00000000-0000-4000-8000-000000000400",
			tenantID:      "00000000-0000-4000-8000-000000000100",
			projectID:     "00000000-0000-4000-8000-000000000200",
			secretHash:    credentialHash("gsk_live_other_secret_1234"),
			hashAlgorithm: credentialHashAlgorithmSHA256,
		}}),
	}

	_, err := NewStore(queryer).AuthenticateAPIKey(context.Background(), "gsk_live_test_secret_1234")
	if !errors.Is(err, auth.ErrInvalidAPIKey) {
		t.Fatalf("expected invalid api key error, got %v", err)
	}
}

func TestStoreValidatesAppTokenWithApplicationScope(t *testing.T) {
	plaintext := "gat_app_test_secret_5678"
	queryer := &fakeQueryer{
		rows: newFakeRows([]credentialCandidate{{
			id:            "00000000-0000-4000-8000-000000000500",
			tenantID:      "00000000-0000-4000-8000-000000000100",
			projectID:     "00000000-0000-4000-8000-000000000200",
			applicationID: "00000000-0000-4000-8000-000000000300",
			secretHash:    credentialHash(plaintext),
			hashAlgorithm: credentialHashAlgorithmSHA256,
		}}),
	}

	identity, err := NewStore(queryer).ValidateAppToken(context.Background(), plaintext)
	if err != nil {
		t.Fatalf("ValidateAppToken returned error: %v", err)
	}

	if identity.AppTokenID != "00000000-0000-4000-8000-000000000500" ||
		identity.TenantID != "00000000-0000-4000-8000-000000000100" ||
		identity.ProjectID != "00000000-0000-4000-8000-000000000200" ||
		identity.ApplicationID != "00000000-0000-4000-8000-000000000300" {
		t.Fatalf("unexpected app token identity: %+v", identity)
	}
	assertLookupArgs(t, queryer, "gat_app_", "5678")
}

func TestCredentialLookupSupportsDemoSeedPrefixes(t *testing.T) {
	tests := []struct {
		name      string
		plaintext string
		prefix    string
		last4     string
	}{
		{
			name:      "demo api key",
			plaintext: "glm_api_test_redacted",
			prefix:    "glm_api_test_",
			last4:     "cted",
		},
		{
			name:      "demo app token",
			plaintext: "glm_app_token_test_redacted",
			prefix:    "glm_app_token_test_",
			last4:     "cted",
		},
		{
			name:      "issued api key",
			plaintext: "gsk_live_body_with_underscore_1234",
			prefix:    "gsk_live_",
			last4:     "1234",
		},
		{
			name:      "issued app token",
			plaintext: "gat_app_body_with_underscore_5678",
			prefix:    "gat_app_",
			last4:     "5678",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			lookup := credentialLookupFromPlaintext(tt.plaintext)

			if lookup.prefix != tt.prefix || lookup.last4 != tt.last4 {
				t.Fatalf("unexpected lookup: got prefix=%q last4=%q", lookup.prefix, lookup.last4)
			}
			if lookup.prefix == "" || lookup.last4 == "" {
				t.Fatal("expected lookup to preserve credential routing metadata")
			}
		})
	}
}

func TestStoreAuthenticatesScryptCredentialCandidate(t *testing.T) {
	plaintext := "gsk_live_scrypt_secret_1234"
	queryer := &fakeQueryer{
		rows: newFakeRows([]credentialCandidate{{
			id:            "00000000-0000-4000-8000-000000000400",
			tenantID:      "00000000-0000-4000-8000-000000000100",
			projectID:     "00000000-0000-4000-8000-000000000200",
			applicationID: "00000000-0000-4000-8000-000000000300",
			secretHash:    testScryptCredentialHash(t, plaintext),
			hashAlgorithm: credentialHashAlgorithmScrypt,
		}}),
	}

	if _, err := NewStore(queryer).AuthenticateAPIKey(context.Background(), plaintext); err != nil {
		t.Fatalf("AuthenticateAPIKey returned error: %v", err)
	}
}

func TestStoreRejectsMalformedCredentialWithoutQuery(t *testing.T) {
	queryer := &fakeQueryer{}

	_, err := NewStore(queryer).AuthenticateAPIKey(context.Background(), "not-a-gatelm-key")
	if !errors.Is(err, auth.ErrInvalidAPIKey) {
		t.Fatalf("expected invalid api key error, got %v", err)
	}
	if queryer.called {
		t.Fatal("malformed credential should not query database")
	}
}

func TestStoreReturnsQueryFailureWithoutMappingToInvalidCredential(t *testing.T) {
	queryErr := errors.New("database unavailable")
	queryer := &fakeQueryer{err: queryErr}

	_, err := NewStore(queryer).ValidateAppToken(context.Background(), "gat_app_test_secret_5678")
	if !errors.Is(err, queryErr) {
		t.Fatalf("expected query error, got %v", err)
	}
	if errors.Is(err, auth.ErrInvalidAppToken) {
		t.Fatal("database failures must not be reported as invalid app tokens")
	}
}

func assertLookupArgs(t *testing.T, queryer *fakeQueryer, prefix string, last4 string) {
	t.Helper()
	if !queryer.called {
		t.Fatal("expected database query")
	}
	if len(queryer.args) != 2 {
		t.Fatalf("expected 2 query args, got %d", len(queryer.args))
	}
	if queryer.args[0] != prefix || queryer.args[1] != last4 {
		t.Fatalf("unexpected query args: %+v", queryer.args)
	}
}

type fakeQueryer struct {
	rows   pgx.Rows
	err    error
	called bool
	args   []any
}

func (q *fakeQueryer) Query(_ context.Context, _ string, arguments ...any) (pgx.Rows, error) {
	q.called = true
	q.args = append([]any(nil), arguments...)
	if q.err != nil {
		return nil, q.err
	}
	return q.rows, nil
}

type fakeRows struct {
	candidates []credentialCandidate
	index      int
	err        error
	closed     bool
}

func newFakeRows(candidates []credentialCandidate) *fakeRows {
	return &fakeRows{candidates: candidates, index: -1}
}

func (r *fakeRows) Close() {
	r.closed = true
}

func (r *fakeRows) Err() error {
	return r.err
}

func (r *fakeRows) CommandTag() pgconn.CommandTag {
	return pgconn.CommandTag{}
}

func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription {
	return nil
}

func (r *fakeRows) Next() bool {
	r.index++
	if r.index >= len(r.candidates) {
		r.Close()
		return false
	}
	return true
}

func (r *fakeRows) Scan(dest ...any) error {
	if r.index < 0 || r.index >= len(r.candidates) {
		return errors.New("scan called without current row")
	}
	if len(dest) != 6 {
		return errors.New("unexpected scan destination count")
	}
	candidate := r.candidates[r.index]
	*(dest[0].(*string)) = candidate.id
	*(dest[1].(*string)) = candidate.tenantID
	*(dest[2].(*string)) = candidate.projectID
	*(dest[3].(*string)) = candidate.applicationID
	*(dest[4].(*string)) = candidate.secretHash
	*(dest[5].(*string)) = candidate.hashAlgorithm
	return nil
}

func testScryptCredentialHash(t *testing.T, plaintext string) string {
	t.Helper()
	salt := make([]byte, credentialScryptSaltLength)
	if _, err := rand.Read(salt); err != nil {
		t.Fatalf("generate salt: %v", err)
	}
	derived, err := scrypt.Key([]byte(plaintext), salt, credentialScryptN, credentialScryptR, credentialScryptP, credentialScryptKeyLength)
	if err != nil {
		t.Fatalf("derive scrypt credential hash: %v", err)
	}
	return strings.Join([]string{
		credentialHashAlgorithmScrypt,
		"32768",
		"8",
		"1",
		base64.RawURLEncoding.EncodeToString(salt),
		base64.RawURLEncoding.EncodeToString(derived),
	}, "$")
}

func (r *fakeRows) Values() ([]any, error) {
	return nil, nil
}

func (r *fakeRows) RawValues() [][]byte {
	return nil
}

func (r *fakeRows) Conn() *pgx.Conn {
	return nil
}
