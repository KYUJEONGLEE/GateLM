package workloadauth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/ragembedding"

	"github.com/golang-jwt/jwt/v5"
)

const (
	chatKID            = "chat-rag-key-1"
	workerKID          = "worker-rag-key-1"
	chatIssuer         = "gatelm-chat-api"
	chatSubject        = "service:chat-api"
	workerIssuer       = "gatelm-control-plane-worker"
	workerSubject      = "service:control-plane-worker"
	fixtureTenantID    = "00000000-0000-4000-8000-000000000001"
	fixtureRequestID   = "request_fixture_001"
	fixtureOperationID = "operation_fixture_001"
)

type authFixture struct {
	now         time.Time
	privateKeys map[string]ed25519.PrivateKey
	publicKeys  map[string]ed25519.PublicKey
	bindingKeys map[string][]byte
	identities  map[string]IdentityConfig
	verifier    *Verifier
}

type tokenOptions struct {
	kid              string
	signingKID       string
	issuer           string
	subject          string
	tenantID         string
	requestID        string
	operationID      string
	purpose          ragembedding.Purpose
	profileVersion   int
	requestForDigest ragembedding.Request
	bindingTenantID  string
	bindingRequestID string
	bindingOperation string
	bindingPurpose   ragembedding.Purpose
	bindingProfile   int
	issuedAt         time.Time
	notBefore        time.Time
	expiresAt        time.Time
	audience         jwt.ClaimStrings
	typ              string
}

type fakeJTIConsumer struct {
	err       error
	calls     int
	lastJTI   string
	expiresAt time.Time
}

func (c *fakeJTIConsumer) Consume(_ context.Context, jti string, expiresAt time.Time) error {
	c.calls++
	c.lastJTI = jti
	c.expiresAt = expiresAt
	return c.err
}

func TestAuthenticatorReturnsVerifiedJWTDerivedScope(t *testing.T) {
	fixture := newAuthFixture(t)
	for _, test := range []struct {
		name    string
		kid     string
		issuer  string
		subject string
		purpose ragembedding.Purpose
	}{
		{name: "chat query", kid: chatKID, issuer: chatIssuer, subject: chatSubject, purpose: ragembedding.PurposeQuery},
		{name: "worker ingestion", kid: workerKID, issuer: workerIssuer, subject: workerSubject, purpose: ragembedding.PurposeIngestion},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := embeddingRequest(test.purpose, "first", "second")
			token := fixture.sign(t, tokenOptions{
				kid: test.kid, issuer: test.issuer, subject: test.subject,
				purpose: test.purpose, requestForDigest: request,
			})
			jti := &fakeJTIConsumer{}
			authenticator := NewAuthenticator(fixture.verifier, jti)
			scope, err := authenticator.Authenticate(context.Background(), "Bearer "+token, request)
			if err != nil {
				t.Fatalf("authenticate: %v", err)
			}
			if scope.TenantID() != fixtureTenantID || scope.RequestID() != fixtureRequestID ||
				scope.OperationID() != fixtureOperationID || scope.Purpose() != test.purpose ||
				scope.ProfileVersion() != ragembedding.ProfileVersion {
				t.Fatalf("unexpected verified scope")
			}
			if scope.Caller().Issuer() != test.issuer || scope.Caller().Subject() != test.subject ||
				scope.Caller().KeyID() != test.kid {
				t.Fatalf("caller did not come from configured identity")
			}
			if jti.calls != 1 || jti.lastJTI != "jti_fixture_001" {
				t.Fatalf("JTI was not consumed exactly once after verification: %+v", jti)
			}
		})
	}
}

func TestAuthenticatorEnforcesIdentityPurposeAuthorization(t *testing.T) {
	fixture := newAuthFixture(t)
	for _, test := range []struct {
		name    string
		kid     string
		issuer  string
		subject string
		purpose ragembedding.Purpose
	}{
		{name: "chat cannot ingest", kid: chatKID, issuer: chatIssuer, subject: chatSubject, purpose: ragembedding.PurposeIngestion},
		{name: "worker cannot query", kid: workerKID, issuer: workerIssuer, subject: workerSubject, purpose: ragembedding.PurposeQuery},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := embeddingRequest(test.purpose, "content")
			token := fixture.sign(t, tokenOptions{
				kid: test.kid, issuer: test.issuer, subject: test.subject,
				purpose: test.purpose, requestForDigest: request,
			})
			jti := &fakeJTIConsumer{}
			_, err := NewAuthenticator(fixture.verifier, jti).Authenticate(context.Background(), "Bearer "+token, request)
			if !errors.Is(err, ErrTokenInvalid) {
				t.Fatalf("expected token invalid, got %v", err)
			}
			if jti.calls != 0 {
				t.Fatalf("unauthorized purpose consumed JTI")
			}
		})
	}
}

func TestAuthenticatorRejectsChangedPayloadOrderAndBindingContextBeforeJTI(t *testing.T) {
	fixture := newAuthFixture(t)
	base := embeddingRequest(ragembedding.PurposeQuery, "first", "second")
	for _, test := range []struct {
		name    string
		options tokenOptions
		request ragembedding.Request
	}{
		{
			name: "changed input",
			options: tokenOptions{kid: chatKID, issuer: chatIssuer, subject: chatSubject,
				purpose: ragembedding.PurposeQuery, requestForDigest: base},
			request: embeddingRequest(ragembedding.PurposeQuery, "first", "changed"),
		},
		{
			name: "changed order",
			options: tokenOptions{kid: chatKID, issuer: chatIssuer, subject: chatSubject,
				purpose: ragembedding.PurposeQuery, requestForDigest: base},
			request: embeddingRequest(ragembedding.PurposeQuery, "second", "first"),
		},
		{
			name: "changed operation binding",
			options: tokenOptions{kid: chatKID, issuer: chatIssuer, subject: chatSubject,
				purpose: ragembedding.PurposeQuery, requestForDigest: base,
				bindingOperation: "different_operation"},
			request: base,
		},
		{
			name: "changed tenant binding",
			options: tokenOptions{kid: chatKID, issuer: chatIssuer, subject: chatSubject,
				purpose: ragembedding.PurposeQuery, requestForDigest: base,
				bindingTenantID: "00000000-0000-4000-8000-000000000002"},
			request: base,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			token := fixture.sign(t, test.options)
			jti := &fakeJTIConsumer{}
			_, err := NewAuthenticator(fixture.verifier, jti).Authenticate(context.Background(), "Bearer "+token, test.request)
			if !errors.Is(err, ErrTokenInvalid) {
				t.Fatalf("expected token invalid, got %v", err)
			}
			if jti.calls != 0 {
				t.Fatalf("invalid binding consumed JTI")
			}
		})
	}
}

func TestAuthenticatorMapsReplayAndGuardFailures(t *testing.T) {
	fixture := newAuthFixture(t)
	request := embeddingRequest(ragembedding.PurposeQuery, "content")
	token := fixture.sign(t, tokenOptions{
		kid: chatKID, issuer: chatIssuer, subject: chatSubject,
		purpose: ragembedding.PurposeQuery, requestForDigest: request,
	})
	for _, test := range []struct {
		name string
		err  error
		want error
	}{
		{name: "replay", err: errJTIReplayed, want: ErrTokenInvalid},
		{name: "guard unavailable", err: errors.New("redis unavailable"), want: ErrGuardUnavailable},
	} {
		t.Run(test.name, func(t *testing.T) {
			jti := &fakeJTIConsumer{err: test.err}
			_, err := NewAuthenticator(fixture.verifier, jti).Authenticate(context.Background(), "Bearer "+token, request)
			if !errors.Is(err, test.want) {
				t.Fatalf("expected %v, got %v", test.want, err)
			}
			if jti.calls != 1 {
				t.Fatalf("verified token did not reach JTI guard exactly once")
			}
		})
	}
}

func TestAuthenticatorRejectsWrongIdentitySignatureExpiryAndTenant(t *testing.T) {
	fixture := newAuthFixture(t)
	request := embeddingRequest(ragembedding.PurposeQuery, "content")
	for _, test := range []struct {
		name    string
		options tokenOptions
	}{
		{
			name: "kid identity mismatch",
			options: tokenOptions{kid: chatKID, issuer: workerIssuer, subject: workerSubject,
				purpose: ragembedding.PurposeQuery, requestForDigest: request},
		},
		{
			name: "wrong signing key for kid",
			options: tokenOptions{kid: workerKID, signingKID: chatKID, issuer: workerIssuer, subject: workerSubject,
				purpose:          ragembedding.PurposeIngestion,
				requestForDigest: embeddingRequest(ragembedding.PurposeIngestion, "content")},
		},
		{
			name: "expired",
			options: tokenOptions{kid: chatKID, issuer: chatIssuer, subject: chatSubject,
				purpose: ragembedding.PurposeQuery, requestForDigest: request,
				issuedAt: fixture.now.Add(-45 * time.Second), notBefore: fixture.now.Add(-50 * time.Second),
				expiresAt: fixture.now.Add(-10 * time.Second)},
		},
		{
			name: "tenant is not UUID",
			options: tokenOptions{kid: chatKID, issuer: chatIssuer, subject: chatSubject,
				purpose: ragembedding.PurposeQuery, requestForDigest: request, tenantID: "tenant_fixture_001"},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			token := fixture.sign(t, test.options)
			jti := &fakeJTIConsumer{}
			requestToAuthenticate := test.options.requestForDigest
			_, err := NewAuthenticator(fixture.verifier, jti).Authenticate(context.Background(), "Bearer "+token, requestToAuthenticate)
			if !errors.Is(err, ErrTokenInvalid) {
				t.Fatalf("expected token invalid, got %v", err)
			}
			if jti.calls != 0 {
				t.Fatalf("invalid identity/token consumed JTI")
			}
		})
	}
}

func TestAuthenticatorRejectsInvalidBodyBeforeJTI(t *testing.T) {
	fixture := newAuthFixture(t)
	jti := &fakeJTIConsumer{}
	_, err := NewAuthenticator(fixture.verifier, jti).Authenticate(
		context.Background(),
		"Bearer invalid",
		ragembedding.Request{Purpose: ragembedding.PurposeQuery, ProfileVersion: 1},
	)
	if !errors.Is(err, ErrInvalidRequest) || jti.calls != 0 {
		t.Fatalf("invalid request was not rejected before auth guard: err=%v calls=%d", err, jti.calls)
	}
}

func TestVerifierRejectsSharedSignatureMaterialAcrossIdentities(t *testing.T) {
	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	_, err = NewVerifier(
		map[string]ed25519.PublicKey{"key-a": publicKey, "key-b": append(ed25519.PublicKey(nil), publicKey...)},
		map[string][]byte{"key-a": bytesOf(1, 32), "key-b": bytesOf(2, 32)},
		map[string]IdentityConfig{
			"key-a": {Issuer: chatIssuer, Subject: chatSubject, AllowedPurposes: []ragembedding.Purpose{ragembedding.PurposeQuery}},
			"key-b": {Issuer: workerIssuer, Subject: workerSubject, AllowedPurposes: []ragembedding.Purpose{ragembedding.PurposeIngestion}},
		},
	)
	if err == nil {
		t.Fatal("same Ed25519 public material was allowed to represent two identities")
	}
}

func TestVerifierRejectsNonContractPrincipalPurposeConfiguration(t *testing.T) {
	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	for _, test := range []struct {
		name     string
		identity IdentityConfig
	}{
		{
			name: "one kid cannot allow both purposes",
			identity: IdentityConfig{
				Issuer: ChatAPIIssuer, Subject: ChatAPISubject,
				AllowedPurposes: []ragembedding.Purpose{ragembedding.PurposeQuery, ragembedding.PurposeIngestion},
			},
		},
		{
			name: "chat principal cannot ingest",
			identity: IdentityConfig{
				Issuer: ChatAPIIssuer, Subject: ChatAPISubject,
				AllowedPurposes: []ragembedding.Purpose{ragembedding.PurposeIngestion},
			},
		},
		{
			name: "worker principal cannot query",
			identity: IdentityConfig{
				Issuer: WorkerIssuer, Subject: WorkerSubject,
				AllowedPurposes: []ragembedding.Purpose{ragembedding.PurposeQuery},
			},
		},
		{
			name: "issuer and subject cannot be crossed",
			identity: IdentityConfig{
				Issuer: ChatAPIIssuer, Subject: WorkerSubject,
				AllowedPurposes: []ragembedding.Purpose{ragembedding.PurposeQuery},
			},
		},
		{
			name: "unknown principal is rejected",
			identity: IdentityConfig{
				Issuer: "unknown-service", Subject: "service:unknown",
				AllowedPurposes: []ragembedding.Purpose{ragembedding.PurposeQuery},
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, verifierErr := NewVerifier(
				map[string]ed25519.PublicKey{"key-a": publicKey},
				map[string][]byte{"key-a": bytesOf(1, 32)},
				map[string]IdentityConfig{"key-a": test.identity},
			)
			if verifierErr == nil {
				t.Fatal("non-contract principal-purpose mapping was accepted")
			}
		})
	}
}

func TestLoadBindsSeparateJWKSBindingAndIdentityFiles(t *testing.T) {
	fixture := newAuthFixture(t)
	directory := t.TempDir()
	jwksPath := filepath.Join(directory, "jwks.json")
	bindingPath := filepath.Join(directory, "binding.json")
	identitiesPath := filepath.Join(directory, "identities.json")

	writeJSON(t, jwksPath, map[string]any{"keys": []any{
		map[string]any{"kty": "OKP", "crv": "Ed25519", "alg": "EdDSA", "use": "sig", "kid": chatKID, "x": base64.RawURLEncoding.EncodeToString(fixture.publicKeys[chatKID])},
		map[string]any{"kty": "OKP", "crv": "Ed25519", "alg": "EdDSA", "use": "sig", "kid": workerKID, "x": base64.RawURLEncoding.EncodeToString(fixture.publicKeys[workerKID])},
	}})
	writeJSON(t, bindingPath, map[string]any{"keys": []any{
		map[string]any{"kid": chatKID, "key": base64.RawURLEncoding.EncodeToString(fixture.bindingKeys[chatKID])},
		map[string]any{"kid": workerKID, "key": base64.RawURLEncoding.EncodeToString(fixture.bindingKeys[workerKID])},
	}})
	writeJSON(t, identitiesPath, map[string]any{"identities": []any{
		map[string]any{"kid": chatKID, "issuer": chatIssuer, "subject": chatSubject, "allowedPurposes": []string{"RAG_QUERY"}},
		map[string]any{"kid": workerKID, "issuer": workerIssuer, "subject": workerSubject, "allowedPurposes": []string{"RAG_INGESTION"}},
	}})

	loaded, err := Load(jwksPath, bindingPath, identitiesPath)
	if err != nil {
		t.Fatalf("load verifier: %v", err)
	}
	loaded.now = func() time.Time { return fixture.now }
	request := embeddingRequest(ragembedding.PurposeQuery, "content")
	token := fixture.sign(t, tokenOptions{
		kid: chatKID, issuer: chatIssuer, subject: chatSubject,
		purpose: ragembedding.PurposeQuery, requestForDigest: request,
	})
	if _, err := NewAuthenticator(loaded, &fakeJTIConsumer{}).Authenticate(context.Background(), "Bearer "+token, request); err != nil {
		t.Fatalf("loaded verifier did not authenticate mapped identity: %v", err)
	}
}

func newAuthFixture(t *testing.T) authFixture {
	t.Helper()
	privateKeys := make(map[string]ed25519.PrivateKey, 2)
	publicKeys := make(map[string]ed25519.PublicKey, 2)
	for _, kid := range []string{chatKID, workerKID} {
		publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatalf("generate %s: %v", kid, err)
		}
		publicKeys[kid] = publicKey
		privateKeys[kid] = privateKey
	}
	bindingKeys := map[string][]byte{
		chatKID:   bytesOf(11, 32),
		workerKID: bytesOf(29, 32),
	}
	identities := map[string]IdentityConfig{
		chatKID: {
			Issuer: chatIssuer, Subject: chatSubject,
			AllowedPurposes: []ragembedding.Purpose{ragembedding.PurposeQuery},
		},
		workerKID: {
			Issuer: workerIssuer, Subject: workerSubject,
			AllowedPurposes: []ragembedding.Purpose{ragembedding.PurposeIngestion},
		},
	}
	verifier, err := NewVerifier(publicKeys, bindingKeys, identities)
	if err != nil {
		t.Fatalf("new verifier: %v", err)
	}
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	verifier.now = func() time.Time { return now }
	return authFixture{
		now: now, privateKeys: privateKeys, publicKeys: publicKeys,
		bindingKeys: bindingKeys, identities: identities, verifier: verifier,
	}
}

func embeddingRequest(purpose ragembedding.Purpose, inputs ...string) ragembedding.Request {
	return ragembedding.Request{Purpose: purpose, ProfileVersion: ragembedding.ProfileVersion, Inputs: inputs}
}

func (f authFixture) sign(t *testing.T, options tokenOptions) string {
	t.Helper()
	if options.kid == "" {
		options.kid = chatKID
	}
	if options.signingKID == "" {
		options.signingKID = options.kid
	}
	if options.tenantID == "" {
		options.tenantID = fixtureTenantID
	}
	if options.requestID == "" {
		options.requestID = fixtureRequestID
	}
	if options.operationID == "" {
		options.operationID = fixtureOperationID
	}
	if options.profileVersion == 0 {
		options.profileVersion = ragembedding.ProfileVersion
	}
	if options.issuedAt.IsZero() {
		options.issuedAt = f.now.Add(-5 * time.Second)
	}
	if options.notBefore.IsZero() {
		options.notBefore = f.now.Add(-5 * time.Second)
	}
	if options.expiresAt.IsZero() {
		options.expiresAt = f.now.Add(25 * time.Second)
	}
	if len(options.audience) == 0 {
		options.audience = jwt.ClaimStrings{ExpectedAudience}
	}
	if options.typ == "" {
		options.typ = TokenType
	}

	bindingTenantID := firstNonEmpty(options.bindingTenantID, options.tenantID)
	bindingRequestID := firstNonEmpty(options.bindingRequestID, options.requestID)
	bindingOperation := firstNonEmpty(options.bindingOperation, options.operationID)
	bindingPurpose := options.bindingPurpose
	if bindingPurpose == "" {
		bindingPurpose = options.purpose
	}
	bindingProfile := options.bindingProfile
	if bindingProfile == 0 {
		bindingProfile = options.profileVersion
	}
	payloadDigest, err := ragembedding.ComputePayloadDigest(options.requestForDigest)
	if err != nil {
		t.Fatalf("payload digest: %v", err)
	}
	bindingDigest, _, err := ragembedding.ComputeBindingDigest(ragembedding.BindingObject{
		TenantID: bindingTenantID, RequestID: bindingRequestID, OperationID: bindingOperation,
		Purpose: bindingPurpose, ProfileVersion: bindingProfile, PayloadDigest: payloadDigest,
	}, f.bindingKeys[options.kid])
	if err != nil {
		t.Fatalf("binding digest: %v", err)
	}
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: options.issuer, Subject: options.subject, Audience: options.audience,
			ID: "jti_fixture_001", IssuedAt: jwt.NewNumericDate(options.issuedAt),
			NotBefore: jwt.NewNumericDate(options.notBefore), ExpiresAt: jwt.NewNumericDate(options.expiresAt),
		},
		RequestID: options.requestID, OperationID: options.operationID, TenantID: options.tenantID,
		Purpose: options.purpose, ProfileVersion: options.profileVersion, BindingDigest: bindingDigest,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	token.Header["typ"] = options.typ
	token.Header["kid"] = options.kid
	signed, err := token.SignedString(f.privateKeys[options.signingKID])
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}

func bytesOf(value byte, length int) []byte {
	result := make([]byte, length)
	for index := range result {
		result[index] = value
	}
	return result
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func writeJSON(t *testing.T, path string, value any) {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
}
