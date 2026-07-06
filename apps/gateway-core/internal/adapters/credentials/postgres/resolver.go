package postgres

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/credentials"

	"github.com/jackc/pgx/v5"
)

const defaultKeyVersion = "v1"

type Queryer interface {
	QueryRow(ctx context.Context, sql string, arguments ...any) pgx.Row
}

type Config struct {
	EncryptionKey        string
	EncryptionKeyVersion string
}

type Resolver struct {
	db         Queryer
	key        []byte
	keyVersion string
}

func NewResolver(db Queryer, cfg Config) (*Resolver, error) {
	key, err := parseEncryptionKey(cfg.EncryptionKey)
	if err != nil {
		return nil, err
	}
	return NewResolverWithKey(db, key, cfg.EncryptionKeyVersion), nil
}

func NewResolverWithKey(db Queryer, key []byte, keyVersion string) *Resolver {
	keyCopy := append([]byte(nil), key...)
	keyVersion = strings.TrimSpace(keyVersion)
	if keyVersion == "" {
		keyVersion = defaultKeyVersion
	}
	return &Resolver{
		db:         db,
		key:        keyCopy,
		keyVersion: keyVersion,
	}
}

func (r *Resolver) Resolve(ctx context.Context, ref credentials.Ref) (credentials.Resolved, error) {
	if err := ctx.Err(); err != nil {
		return credentials.Resolved{}, err
	}
	ref = ref.Normalize()
	if err := ref.ValidateActive(); err != nil {
		return credentials.Resolved{}, err
	}
	if r == nil || r.db == nil || len(r.key) == 0 {
		return credentials.Resolved{}, credentials.ErrUnavailable
	}

	row, err := r.lookup(ctx, ref.CredentialRefID)
	if err != nil {
		return credentials.Resolved{}, err
	}
	if !strings.EqualFold(row.status, "ACTIVE") {
		return credentials.Resolved{}, credentials.ErrInactive
	}
	if strings.TrimSpace(row.keyVersion) != r.keyVersion {
		return credentials.Resolved{}, fmt.Errorf("credential encryption key version is unavailable")
	}

	value, err := decryptCredential(r.key, row)
	if err != nil {
		return credentials.Resolved{}, fmt.Errorf("decrypt provider credential: %w", err)
	}
	return credentials.Resolved{Value: value}, nil
}

func (r *Resolver) lookup(ctx context.Context, credentialRefID string) (storedCredential, error) {
	var row storedCredential
	err := r.db.QueryRow(ctx, lookupCredentialSQL, credentialRefID).Scan(
		&row.refID,
		&row.status,
		&row.ciphertext,
		&row.nonce,
		&row.tag,
		&row.keyVersion,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return storedCredential{}, credentials.ErrUnavailable
		}
		return storedCredential{}, fmt.Errorf("%w: query provider credential", credentials.ErrUnavailable)
	}
	return row, nil
}

type storedCredential struct {
	refID      string
	status     string
	ciphertext string
	nonce      string
	tag        string
	keyVersion string
}

func decryptCredential(key []byte, row storedCredential) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce, err := base64.StdEncoding.DecodeString(row.nonce)
	if err != nil {
		return "", err
	}
	ciphertext, err := base64.StdEncoding.DecodeString(row.ciphertext)
	if err != nil {
		return "", err
	}
	tag, err := base64.StdEncoding.DecodeString(row.tag)
	if err != nil {
		return "", err
	}

	sealed := make([]byte, len(ciphertext)+len(tag))
	copy(sealed, ciphertext)
	copy(sealed[len(ciphertext):], tag)
	plaintext, err := gcm.Open(nil, nonce, sealed, []byte(row.refID))
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func parseEncryptionKey(raw string) ([]byte, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("provider credential encryption key is not configured")
	}
	if strings.HasPrefix(strings.ToLower(raw), "base64:") {
		value := raw[len("base64:"):]
		decoded, err := base64.StdEncoding.DecodeString(value)
		if err != nil {
			return nil, err
		}
		return validateEncryptionKey(decoded)
	}
	if strings.HasPrefix(strings.ToLower(raw), "hex:") {
		value := raw[len("hex:"):]
		decoded, err := hex.DecodeString(value)
		if err != nil {
			return nil, err
		}
		return validateEncryptionKey(decoded)
	}
	if len(raw) == 64 {
		if decoded, err := hex.DecodeString(raw); err == nil {
			return validateEncryptionKey(decoded)
		}
	}
	if decoded, err := base64.StdEncoding.DecodeString(raw); err == nil && len(decoded) == 32 {
		return validateEncryptionKey(decoded)
	}
	return validateEncryptionKey([]byte(raw))
}

func validateEncryptionKey(key []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("provider credential encryption key must be 32 bytes")
	}
	return append([]byte(nil), key...), nil
}

const lookupCredentialSQL = `
select
  "credentialRefId",
  status::text,
  "encryptedValue",
  "encryptionNonce",
  "encryptionTag",
  "encryptionKeyVersion"
from provider_credentials
where "credentialRefId" = $1
limit 1`
