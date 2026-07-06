package postgres

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"errors"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/credentials"

	"github.com/jackc/pgx/v5"
)

func TestResolverDecryptsActiveProviderCredential(t *testing.T) {
	key := []byte("12345678901234567890123456789012")
	refID := "provider_credential:00000000-0000-4000-8000-000000000921"
	encrypted := encryptCredentialForTest(t, key, refID, "resolved-provider-credential")
	db := &fakeCredentialQueryer{
		row: fakeCredentialRow{
			values: []string{
				refID,
				"ACTIVE",
				encrypted.ciphertext,
				encrypted.nonce,
				encrypted.tag,
				"v1",
			},
		},
	}
	resolver := NewResolverWithKey(db, key, "v1")

	resolved, err := resolver.Resolve(context.Background(), credentials.Ref{
		CredentialRefID:   refID,
		CredentialVersion: 1,
		CredentialState:   credentials.StateActive,
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if resolved.Value != "resolved-provider-credential" {
		t.Fatal("unexpected resolved credential value")
	}
	if db.args[0] != refID {
		t.Fatalf("resolver queried unexpected credential ref: %+v", db.args)
	}
}

func TestResolverReturnsUnavailableWhenCredentialRefIsNotStored(t *testing.T) {
	resolver := NewResolverWithKey(&fakeCredentialQueryer{
		row: fakeCredentialRow{err: pgx.ErrNoRows},
	}, []byte("12345678901234567890123456789012"), "v1")

	_, err := resolver.Resolve(context.Background(), credentials.Ref{
		CredentialRefID:   "provider_credential:missing",
		CredentialVersion: 1,
		CredentialState:   credentials.StateActive,
	})
	if !errors.Is(err, credentials.ErrUnavailable) {
		t.Fatalf("expected unavailable error, got %v", err)
	}
}

func TestResolverRejectsInactiveStoredCredentialWithoutDecrypting(t *testing.T) {
	resolver := NewResolverWithKey(&fakeCredentialQueryer{
		row: fakeCredentialRow{
			values: []string{
				"provider_credential:revoked",
				"REVOKED",
				"redacted",
				"redacted",
				"redacted",
				"v1",
			},
		},
	}, []byte("12345678901234567890123456789012"), "v1")

	_, err := resolver.Resolve(context.Background(), credentials.Ref{
		CredentialRefID:   "provider_credential:revoked",
		CredentialVersion: 1,
		CredentialState:   credentials.StateActive,
	})
	if !errors.Is(err, credentials.ErrInactive) {
		t.Fatalf("expected inactive error, got %v", err)
	}
}

func TestResolverRejectsMalformedNonceWithoutPanic(t *testing.T) {
	key := []byte("12345678901234567890123456789012")
	refID := "provider_credential:malformed_nonce"
	encrypted := encryptCredentialForTest(t, key, refID, "resolved-provider-credential")
	db := &fakeCredentialQueryer{
		row: fakeCredentialRow{
			values: []string{
				refID,
				"ACTIVE",
				encrypted.ciphertext,
				base64.StdEncoding.EncodeToString([]byte("short")),
				encrypted.tag,
				"v1",
			},
		},
	}
	resolver := NewResolverWithKey(db, key, "v1")

	_, err := resolver.Resolve(context.Background(), credentials.Ref{
		CredentialRefID:   refID,
		CredentialVersion: 1,
		CredentialState:   credentials.StateActive,
	})
	if err == nil || !strings.Contains(err.Error(), "incorrect nonce length") {
		t.Fatalf("expected nonce length error, got %v", err)
	}
}

func TestResolverReturnsContextErrorWithoutUnavailableWrapping(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	db := &fakeCredentialQueryer{
		onQuery: cancel,
		row:     fakeCredentialRow{err: context.Canceled},
	}
	resolver := NewResolverWithKey(db, []byte("12345678901234567890123456789012"), "v1")

	_, err := resolver.Resolve(ctx, credentials.Ref{
		CredentialRefID:   "provider_credential:canceled",
		CredentialVersion: 1,
		CredentialState:   credentials.StateActive,
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context canceled error, got %v", err)
	}
	if errors.Is(err, credentials.ErrUnavailable) {
		t.Fatalf("context cancellation must not be wrapped as unavailable: %v", err)
	}
}

type encryptedCredentialForTest struct {
	ciphertext string
	nonce      string
	tag        string
}

func encryptCredentialForTest(t *testing.T, key []byte, refID string, plaintext string) encryptedCredentialForTest {
	t.Helper()
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatalf("create cipher: %v", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("create gcm: %v", err)
	}
	nonce := []byte("123456789012")
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), []byte(refID))
	tagStart := len(sealed) - gcm.Overhead()
	return encryptedCredentialForTest{
		ciphertext: base64.StdEncoding.EncodeToString(sealed[:tagStart]),
		nonce:      base64.StdEncoding.EncodeToString(nonce),
		tag:        base64.StdEncoding.EncodeToString(sealed[tagStart:]),
	}
}

type fakeCredentialQueryer struct {
	args    []any
	onQuery func()
	row     fakeCredentialRow
}

func (q *fakeCredentialQueryer) QueryRow(_ context.Context, _ string, arguments ...any) pgx.Row {
	q.args = append([]any{}, arguments...)
	if q.onQuery != nil {
		q.onQuery()
	}
	return q.row
}

type fakeCredentialRow struct {
	values []string
	err    error
}

func (r fakeCredentialRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	for index, value := range r.values {
		target := dest[index].(*string)
		*target = value
	}
	return nil
}
