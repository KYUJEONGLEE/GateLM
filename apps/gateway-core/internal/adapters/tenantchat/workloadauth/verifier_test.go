package workloadauth

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/golang-jwt/jwt/v5"
)

type workloadVectorFile struct {
	JOSEHeader map[string]string `json:"joseHeader"`
	Payloads   []Claims          `json:"payloads"`
}

func TestVerifierAcceptsContractPhaseVectors(t *testing.T) {
	vectors := loadWorkloadVectors(t)
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate signing key: %v", err)
	}
	kid := vectors.JOSEHeader["kid"]
	verifier, err := New(
		map[string]ed25519.PublicKey{kid: publicKey},
		map[string][]byte{kid: make([]byte, 32)},
	)
	if err != nil {
		t.Fatalf("create verifier: %v", err)
	}

	for _, claims := range vectors.Payloads {
		claims := claims
		t.Run(string(claims.Phase), func(t *testing.T) {
			verifier.now = func() time.Time { return claims.IssuedAt.Time.Add(10 * time.Second) }
			rawToken := signClaims(t, claims, privateKey, kid, expectedType)
			verified, err := verifier.Verify(rawToken, claims.Phase)
			if err != nil {
				t.Fatalf("verify contract vector: %v", err)
			}
			if verified.KID != kid || verified.Claims.ID != claims.ID {
				t.Fatalf("verified token identity mismatch")
			}
		})
	}
}

func TestVerifierRejectsInvalidContractClaims(t *testing.T) {
	vectors := loadWorkloadVectors(t)
	base := vectors.Payloads[0]
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate signing key: %v", err)
	}
	kid := vectors.JOSEHeader["kid"]
	verifier, err := New(
		map[string]ed25519.PublicKey{kid: publicKey},
		map[string][]byte{kid: make([]byte, 32)},
	)
	if err != nil {
		t.Fatalf("create verifier: %v", err)
	}
	verifier.now = func() time.Time { return base.IssuedAt.Time.Add(10 * time.Second) }

	tests := []struct {
		name          string
		claims        Claims
		tokenType     string
		tokenKID      string
		expectedPhase tenantchat.Phase
	}{
		{name: "wrong phase", claims: base, tokenType: expectedType, tokenKID: kid, expectedPhase: tenantchat.PhaseCompletion},
		{name: "wrong type", claims: base, tokenType: "JWT", tokenKID: kid, expectedPhase: tenantchat.PhaseAdmission},
		{name: "unknown kid", claims: base, tokenType: expectedType, tokenKID: "unknown_kid", expectedPhase: tenantchat.PhaseAdmission},
		{name: "missing employee", claims: mutateClaims(base, func(value *Claims) { value.EmployeeID = "" }), tokenType: expectedType, tokenKID: kid, expectedPhase: tenantchat.PhaseAdmission},
		{name: "excessive lifetime", claims: mutateClaims(base, func(value *Claims) { value.ExpiresAt = jwt.NewNumericDate(value.IssuedAt.Time.Add(61 * time.Second)) }), tokenType: expectedType, tokenKID: kid, expectedPhase: tenantchat.PhaseAdmission},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			rawToken := signClaims(t, test.claims, privateKey, test.tokenKID, test.tokenType)
			if _, err := verifier.Verify(rawToken, test.expectedPhase); err == nil {
				t.Fatal("expected token verification failure")
			}
		})
	}
}

func TestMatchContextRequiresExactIdentityAndSnapshot(t *testing.T) {
	claims := loadWorkloadVectors(t).Payloads[1]
	verified := VerifiedToken{Claims: claims}
	context := tenantchat.RequestContext{
		Surface:        "tenant_chat",
		Phase:          claims.Phase,
		RequestID:      claims.RequestID,
		TurnID:         claims.TurnID,
		IdempotencyKey: claims.IdempotencyKey,
		AdmissionID:    claims.AdmissionID,
		ExecutionScope: tenantchat.ExecutionScope{
			Kind:     "tenant_chat",
			TenantID: claims.TenantID,
			Actor: tenantchat.Actor{
				UserID:     claims.UserID,
				ActorKind:  claims.ActorKind,
				EmployeeID: claims.EmployeeID,
			},
			QuotaScope:  tenantchat.ScopeReference{Type: "user", ID: claims.UserID},
			BudgetScope: tenantchat.ScopeReference{Type: "tenant", ID: claims.TenantID},
		},
		Snapshot: tenantchat.SnapshotReference{
			Version: claims.SnapshotVersion,
			Digest:  claims.SnapshotDigest,
		},
		BindingDigest: claims.BindingDigest,
	}
	if err := MatchContext(verified, context); err != nil {
		t.Fatalf("match exact context: %v", err)
	}

	context.ExecutionScope.TenantID = "another_tenant"
	if err := MatchContext(verified, context); err == nil {
		t.Fatal("expected tenant mismatch rejection")
	}
}

func TestBearerToken(t *testing.T) {
	if token, err := BearerToken("Bearer signed-token"); err != nil || token != "signed-token" {
		t.Fatalf("parse bearer token: token=%q err=%v", token, err)
	}
	for _, value := range []string{"", "Bearer", "Basic signed-token", "Bearer one two"} {
		if _, err := BearerToken(value); err == nil {
			t.Fatalf("expected invalid authorization header %q", value)
		}
	}
}

func loadWorkloadVectors(t *testing.T) workloadVectorFile {
	t.Helper()
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve current test file")
	}
	path := filepath.Join(filepath.Dir(currentFile), "../../../../../../docs/tenant-chat/vectors/workload-jwt-phase-vectors.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read workload vectors: %v", err)
	}
	var vectors workloadVectorFile
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatalf("decode workload vectors: %v", err)
	}
	return vectors
}

func signClaims(t *testing.T, claims Claims, privateKey ed25519.PrivateKey, kid, tokenType string) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	token.Header["kid"] = kid
	token.Header["typ"] = tokenType
	rawToken, err := token.SignedString(privateKey)
	if err != nil {
		t.Fatalf("sign workload token: %v", err)
	}
	return rawToken
}

func mutateClaims(value Claims, mutate func(*Claims)) Claims {
	mutate(&value)
	return value
}
