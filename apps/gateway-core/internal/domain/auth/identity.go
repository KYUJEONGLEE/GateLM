package auth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"strings"
)

var (
	ErrInvalidAPIKey   = errors.New("invalid api key")
	ErrInvalidAppToken = errors.New("invalid app token")
)

type APIKeyIdentity struct {
	APIKeyID      string
	TenantID      string
	ProjectID     string
	ApplicationID string
}

type AppTokenIdentity struct {
	AppTokenID    string
	TenantID      string
	ProjectID     string
	ApplicationID string
}

type StaticCredentialStore struct {
	apiKeyHash       string
	appTokenHash     string
	apiKeyIdentity   APIKeyIdentity
	appTokenIdentity AppTokenIdentity
}

type StaticCredentialConfig struct {
	APIKey           string
	AppToken         string
	APIKeyIdentity   APIKeyIdentity
	AppTokenIdentity AppTokenIdentity
}

func NewStaticCredentialStore(cfg StaticCredentialConfig) *StaticCredentialStore {
	return &StaticCredentialStore{
		apiKeyHash:       credentialHash(cfg.APIKey),
		appTokenHash:     credentialHash(cfg.AppToken),
		apiKeyIdentity:   cfg.APIKeyIdentity,
		appTokenIdentity: cfg.AppTokenIdentity,
	}
}

func (s *StaticCredentialStore) AuthenticateAPIKey(_ context.Context, bearerToken string) (APIKeyIdentity, error) {
	if s == nil || !credentialHashesEqual(s.apiKeyHash, credentialHash(bearerToken)) {
		return APIKeyIdentity{}, ErrInvalidAPIKey
	}

	return s.apiKeyIdentity, nil
}

func (s *StaticCredentialStore) ValidateAppToken(_ context.Context, appToken string) (AppTokenIdentity, error) {
	if s == nil || !credentialHashesEqual(s.appTokenHash, credentialHash(appToken)) {
		return AppTokenIdentity{}, ErrInvalidAppToken
	}

	return s.appTokenIdentity, nil
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
