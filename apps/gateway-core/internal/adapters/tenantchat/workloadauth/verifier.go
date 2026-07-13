package workloadauth

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/golang-jwt/jwt/v5"
)

const (
	expectedIssuer   = "gatelm-chat-api"
	expectedAudience = "gatelm-gateway-tenant-chat"
	expectedSubject  = "service:chat-api"
	expectedType     = "gatelm-workload+jwt"
	maximumLifetime  = 60 * time.Second
	clockSkew        = 5 * time.Second
)

var (
	ErrTokenInvalid = errors.New("tenant chat workload token is invalid")
	opaqueIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	digestPattern   = regexp.MustCompile(`^sha256:[A-Za-z0-9_-]{43}$`)
	hmacPattern     = regexp.MustCompile(`^hmac-sha256:[A-Za-z0-9_-]{43}$`)
)

type Claims struct {
	jwt.RegisteredClaims
	Phase              tenantchat.Phase `json:"phase"`
	RequestID          string           `json:"requestId"`
	TurnID             string           `json:"turnId"`
	IdempotencyKey     string           `json:"idempotencyKey"`
	TenantID           string           `json:"tenantId"`
	UserID             string           `json:"userId"`
	ActorKind          string           `json:"actorKind"`
	EmployeeID         string           `json:"employeeId,omitempty"`
	ActorAuthzVersion  int64            `json:"actorAuthzVersion"`
	TenantAuthzVersion int64            `json:"tenantAuthzVersion"`
	SessionVersion     int64            `json:"sessionVersion"`
	SnapshotVersion    int64            `json:"snapshotVersion"`
	SnapshotDigest     string           `json:"snapshotDigest"`
	BindingDigest      string           `json:"bindingDigest"`
	AdmissionID        string           `json:"admissionId,omitempty"`
}

type VerifiedToken struct {
	Claims     Claims
	KID        string
	BindingKey []byte
}

type Verifier struct {
	publicKeys  map[string]ed25519.PublicKey
	bindingKeys map[string][]byte
	now         func() time.Time
}

type jwksFile struct {
	Keys []struct {
		KTY string `json:"kty"`
		CRV string `json:"crv"`
		Alg string `json:"alg"`
		Use string `json:"use"`
		KID string `json:"kid"`
		X   string `json:"x"`
	} `json:"keys"`
}

type bindingKeysFile struct {
	Keys []struct {
		KID string `json:"kid"`
		Key string `json:"key"`
	} `json:"keys"`
}

func Load(jwksPath, bindingKeysPath string) (*Verifier, error) {
	publicKeys, err := loadPublicKeys(jwksPath)
	if err != nil {
		return nil, err
	}
	bindingKeys, err := loadBindingKeys(bindingKeysPath)
	if err != nil {
		return nil, err
	}
	for kid := range publicKeys {
		if _, ok := bindingKeys[kid]; !ok {
			return nil, fmt.Errorf("binding key for workload kid %q is missing", kid)
		}
	}
	return &Verifier{publicKeys: publicKeys, bindingKeys: bindingKeys, now: time.Now}, nil
}

func New(publicKeys map[string]ed25519.PublicKey, bindingKeys map[string][]byte) (*Verifier, error) {
	if len(publicKeys) == 0 {
		return nil, fmt.Errorf("at least one workload public key is required")
	}
	publicCopy := make(map[string]ed25519.PublicKey, len(publicKeys))
	bindingCopy := make(map[string][]byte, len(bindingKeys))
	for kid, key := range publicKeys {
		if !opaqueIDPattern.MatchString(kid) || len(key) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("workload public key is invalid")
		}
		publicCopy[kid] = append(ed25519.PublicKey(nil), key...)
		bindingKey, ok := bindingKeys[kid]
		if !ok || len(bindingKey) != 32 {
			return nil, fmt.Errorf("binding key for workload kid %q is invalid", kid)
		}
		bindingCopy[kid] = append([]byte(nil), bindingKey...)
	}
	return &Verifier{publicKeys: publicCopy, bindingKeys: bindingCopy, now: time.Now}, nil
}

func (v *Verifier) Verify(rawToken string, expectedPhase tenantchat.Phase) (VerifiedToken, error) {
	if v == nil || strings.TrimSpace(rawToken) == "" {
		return VerifiedToken{}, ErrTokenInvalid
	}
	claims := Claims{}
	var selectedKID string
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}),
		jwt.WithIssuer(expectedIssuer),
		jwt.WithAudience(expectedAudience),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithLeeway(clockSkew),
		jwt.WithTimeFunc(v.now),
		jwt.WithStrictDecoding(),
	)
	token, err := parser.ParseWithClaims(rawToken, &claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodEdDSA || token.Header["typ"] != expectedType {
			return nil, ErrTokenInvalid
		}
		kid, ok := token.Header["kid"].(string)
		if !ok || !opaqueIDPattern.MatchString(kid) {
			return nil, ErrTokenInvalid
		}
		key, ok := v.publicKeys[kid]
		if !ok {
			return nil, ErrTokenInvalid
		}
		selectedKID = kid
		return key, nil
	})
	if err != nil || token == nil || !token.Valid || selectedKID == "" {
		return VerifiedToken{}, ErrTokenInvalid
	}
	if err := validateClaims(claims, expectedPhase); err != nil {
		return VerifiedToken{}, ErrTokenInvalid
	}
	return VerifiedToken{
		Claims:     claims,
		KID:        selectedKID,
		BindingKey: append([]byte(nil), v.bindingKeys[selectedKID]...),
	}, nil
}

func MatchContext(token VerifiedToken, context tenantchat.RequestContext) error {
	claims := token.Claims
	actor := context.ExecutionScope.Actor
	if claims.Phase != context.Phase || claims.RequestID != context.RequestID ||
		claims.TurnID != context.TurnID || claims.IdempotencyKey != context.IdempotencyKey ||
		claims.TenantID != context.ExecutionScope.TenantID || claims.UserID != actor.UserID ||
		claims.ActorKind != actor.ActorKind || claims.EmployeeID != actor.EmployeeID ||
		claims.SnapshotVersion != context.Snapshot.Version || claims.SnapshotDigest != context.Snapshot.Digest ||
		claims.AdmissionID != context.AdmissionID || claims.BindingDigest != context.BindingDigest {
		return ErrTokenInvalid
	}
	return nil
}

func BearerToken(authorization string) (string, error) {
	parts := strings.Fields(authorization)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", ErrTokenInvalid
	}
	return parts[1], nil
}

func validateClaims(claims Claims, expectedPhase tenantchat.Phase) error {
	if claims.Subject != expectedSubject || claims.ID == "" || claims.IssuedAt == nil ||
		claims.NotBefore == nil || claims.ExpiresAt == nil || claims.Phase != expectedPhase {
		return ErrTokenInvalid
	}
	lifetime := claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time)
	if lifetime <= 0 || lifetime > maximumLifetime {
		return ErrTokenInvalid
	}
	for _, value := range []string{
		claims.ID, claims.RequestID, claims.TurnID, claims.IdempotencyKey,
		claims.TenantID, claims.UserID,
	} {
		if !opaqueIDPattern.MatchString(value) {
			return ErrTokenInvalid
		}
	}
	if claims.ActorKind != "tenant_admin" && claims.ActorKind != "employee" {
		return ErrTokenInvalid
	}
	if claims.ActorKind == "employee" && !opaqueIDPattern.MatchString(claims.EmployeeID) {
		return ErrTokenInvalid
	}
	if claims.ActorAuthzVersion < 1 || claims.TenantAuthzVersion < 1 || claims.SessionVersion < 1 ||
		claims.SnapshotVersion < 1 || !digestPattern.MatchString(claims.SnapshotDigest) ||
		!hmacPattern.MatchString(claims.BindingDigest) {
		return ErrTokenInvalid
	}
	if expectedPhase == tenantchat.PhaseAdmission && claims.AdmissionID != "" {
		return ErrTokenInvalid
	}
	if expectedPhase != tenantchat.PhaseAdmission && !opaqueIDPattern.MatchString(claims.AdmissionID) {
		return ErrTokenInvalid
	}
	return nil
}

func loadPublicKeys(path string) (map[string]ed25519.PublicKey, error) {
	var document jwksFile
	if err := readJSONFile(path, &document); err != nil {
		return nil, fmt.Errorf("load workload JWKS: %w", err)
	}
	keys := make(map[string]ed25519.PublicKey, len(document.Keys))
	for _, item := range document.Keys {
		if item.KTY != "OKP" || item.CRV != "Ed25519" || item.Alg != "EdDSA" || item.Use != "sig" ||
			!opaqueIDPattern.MatchString(item.KID) {
			return nil, fmt.Errorf("workload JWKS contains an invalid key")
		}
		decoded, err := base64.RawURLEncoding.DecodeString(item.X)
		if err != nil || len(decoded) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("workload JWKS contains invalid Ed25519 material")
		}
		if _, duplicate := keys[item.KID]; duplicate {
			return nil, fmt.Errorf("workload JWKS contains duplicate kid %q", item.KID)
		}
		keys[item.KID] = ed25519.PublicKey(decoded)
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("workload JWKS has no keys")
	}
	return keys, nil
}

func loadBindingKeys(path string) (map[string][]byte, error) {
	var document bindingKeysFile
	if err := readJSONFile(path, &document); err != nil {
		return nil, fmt.Errorf("load binding HMAC keys: %w", err)
	}
	keys := make(map[string][]byte, len(document.Keys))
	for _, item := range document.Keys {
		decoded, err := base64.RawURLEncoding.DecodeString(item.Key)
		if err != nil || len(decoded) != 32 || !opaqueIDPattern.MatchString(item.KID) {
			return nil, fmt.Errorf("binding HMAC key entry is invalid")
		}
		if _, duplicate := keys[item.KID]; duplicate {
			return nil, fmt.Errorf("binding HMAC keys contain duplicate kid %q", item.KID)
		}
		keys[item.KID] = decoded
	}
	return keys, nil
}

func readJSONFile(path string, target any) error {
	raw, err := os.ReadFile(strings.TrimSpace(path))
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return fmt.Errorf("JSON document contains more than one value")
		}
		return err
	}
	return nil
}
