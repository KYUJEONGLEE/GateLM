package workloadauth

import (
	"crypto/ed25519"
	"errors"
	"regexp"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/ragembedding"

	"github.com/golang-jwt/jwt/v5"
)

const (
	TokenType        = "gatelm-rag-workload+jwt"
	ExpectedAudience = "gatelm-gateway-rag-embedding"
	ChatAPIIssuer    = "gatelm-chat-api"
	ChatAPISubject   = "service:chat-api"
	WorkerIssuer     = "gatelm-control-plane-worker"
	WorkerSubject    = "service:control-plane-worker"
	maximumLifetime  = 60 * time.Second
	clockSkew        = 5 * time.Second
)

var (
	errVerifierTokenInvalid = errors.New("rag embedding workload token is invalid")
	hmacPattern             = regexp.MustCompile(`^hmac-sha256:[A-Za-z0-9_-]{43}$`)
)

type Claims struct {
	jwt.RegisteredClaims
	RequestID      string               `json:"requestId"`
	OperationID    string               `json:"operationId"`
	TenantID       string               `json:"tenantId"`
	Purpose        ragembedding.Purpose `json:"purpose"`
	ProfileVersion int                  `json:"profileVersion"`
	BindingDigest  string               `json:"bindingDigest"`
}

type IdentityConfig struct {
	Issuer          string
	Subject         string
	AllowedPurposes []ragembedding.Purpose
}

type identity struct {
	issuer          string
	subject         string
	allowedPurposes map[ragembedding.Purpose]struct{}
}

type verifiedToken struct {
	claims     Claims
	kid        string
	bindingKey []byte
	identity   identity
}

type Verifier struct {
	publicKeys  map[string]ed25519.PublicKey
	bindingKeys map[string][]byte
	identities  map[string]identity
	now         func() time.Time
}

func NewVerifier(
	publicKeys map[string]ed25519.PublicKey,
	bindingKeys map[string][]byte,
	identities map[string]IdentityConfig,
) (*Verifier, error) {
	if len(publicKeys) == 0 || len(publicKeys) != len(bindingKeys) || len(publicKeys) != len(identities) {
		return nil, errors.New("rag workload key configuration is incomplete")
	}

	publicCopy := make(map[string]ed25519.PublicKey, len(publicKeys))
	bindingCopy := make(map[string][]byte, len(bindingKeys))
	identityCopy := make(map[string]identity, len(identities))
	publicMaterialOwners := make(map[string]string, len(publicKeys))

	for kid, publicKey := range publicKeys {
		if !ragembedding.IsOpaqueID(kid) || len(publicKey) != ed25519.PublicKeySize {
			return nil, errors.New("rag workload public key configuration is invalid")
		}
		material := string(publicKey)
		if owner, duplicate := publicMaterialOwners[material]; duplicate && owner != kid {
			return nil, errors.New("rag workload public key material cannot be shared across identities")
		}
		publicMaterialOwners[material] = kid

		bindingKey, ok := bindingKeys[kid]
		if !ok || len(bindingKey) != 32 {
			return nil, errors.New("rag workload binding key configuration is invalid")
		}
		configuredIdentity, ok := identities[kid]
		if !ok {
			return nil, errors.New("rag workload identity configuration is incomplete")
		}
		caller, err := ragembedding.NewCallerIdentity(configuredIdentity.Issuer, configuredIdentity.Subject, kid)
		if err != nil {
			return nil, errors.New("rag workload identity configuration is invalid")
		}
		expectedPurpose, ok := contractPurposeForPrincipal(caller.Issuer(), caller.Subject())
		if !ok || len(configuredIdentity.AllowedPurposes) != 1 ||
			configuredIdentity.AllowedPurposes[0] != expectedPurpose {
			return nil, errors.New("rag workload identity does not match an allowed principal-purpose contract")
		}
		allowedPurposes := make(map[ragembedding.Purpose]struct{}, len(configuredIdentity.AllowedPurposes))
		for _, purpose := range configuredIdentity.AllowedPurposes {
			if !purpose.Valid() {
				return nil, errors.New("rag workload identity purpose is invalid")
			}
			if _, duplicate := allowedPurposes[purpose]; duplicate {
				return nil, errors.New("rag workload identity purpose is duplicated")
			}
			allowedPurposes[purpose] = struct{}{}
		}
		if len(allowedPurposes) == 0 {
			return nil, errors.New("rag workload identity must allow at least one purpose")
		}

		publicCopy[kid] = append(ed25519.PublicKey(nil), publicKey...)
		bindingCopy[kid] = append([]byte(nil), bindingKey...)
		identityCopy[kid] = identity{
			issuer:          caller.Issuer(),
			subject:         caller.Subject(),
			allowedPurposes: allowedPurposes,
		}
	}

	for kid := range bindingKeys {
		if _, ok := publicKeys[kid]; !ok {
			return nil, errors.New("rag workload binding key has no matching public key")
		}
	}
	for kid := range identities {
		if _, ok := publicKeys[kid]; !ok {
			return nil, errors.New("rag workload identity has no matching public key")
		}
	}

	return &Verifier{
		publicKeys:  publicCopy,
		bindingKeys: bindingCopy,
		identities:  identityCopy,
		now:         time.Now,
	}, nil
}

func (v *Verifier) verify(rawToken string) (verifiedToken, error) {
	if v == nil || strings.TrimSpace(rawToken) == "" {
		return verifiedToken{}, errVerifierTokenInvalid
	}

	claims := Claims{}
	var selectedKID string
	var selectedIdentity identity
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}),
		jwt.WithAudience(ExpectedAudience),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithLeeway(clockSkew),
		jwt.WithTimeFunc(v.now),
		jwt.WithStrictDecoding(),
	)
	token, err := parser.ParseWithClaims(rawToken, &claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodEdDSA || token.Header["typ"] != TokenType {
			return nil, errVerifierTokenInvalid
		}
		kid, ok := token.Header["kid"].(string)
		if !ok || !ragembedding.IsOpaqueID(kid) {
			return nil, errVerifierTokenInvalid
		}
		publicKey, ok := v.publicKeys[kid]
		if !ok {
			return nil, errVerifierTokenInvalid
		}
		configuredIdentity, ok := v.identities[kid]
		if !ok {
			return nil, errVerifierTokenInvalid
		}
		selectedKID = kid
		selectedIdentity = configuredIdentity
		return publicKey, nil
	})
	if err != nil || token == nil || !token.Valid || selectedKID == "" {
		return verifiedToken{}, errVerifierTokenInvalid
	}
	if err := validateClaims(claims, selectedIdentity); err != nil {
		return verifiedToken{}, errVerifierTokenInvalid
	}
	bindingKey, ok := v.bindingKeys[selectedKID]
	if !ok || len(bindingKey) != 32 {
		return verifiedToken{}, errVerifierTokenInvalid
	}
	return verifiedToken{
		claims:     claims,
		kid:        selectedKID,
		bindingKey: append([]byte(nil), bindingKey...),
		identity:   selectedIdentity,
	}, nil
}

func validateClaims(claims Claims, configuredIdentity identity) error {
	if claims.Issuer != configuredIdentity.issuer || claims.Subject != configuredIdentity.subject ||
		claims.ID == "" || claims.IssuedAt == nil || claims.NotBefore == nil || claims.ExpiresAt == nil {
		return errVerifierTokenInvalid
	}
	if len(claims.Audience) != 1 || claims.Audience[0] != ExpectedAudience {
		return errVerifierTokenInvalid
	}
	lifetime := claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time)
	if lifetime <= 0 || lifetime > maximumLifetime || claims.NotBefore.Time.After(claims.ExpiresAt.Time) {
		return errVerifierTokenInvalid
	}
	if !ragembedding.IsOpaqueID(claims.ID) || !ragembedding.IsOpaqueID(claims.RequestID) ||
		!ragembedding.IsOpaqueID(claims.OperationID) || !ragembedding.IsCanonicalTenantID(claims.TenantID) ||
		!claims.Purpose.Valid() || claims.ProfileVersion != ragembedding.ProfileVersion ||
		!hmacPattern.MatchString(claims.BindingDigest) {
		return errVerifierTokenInvalid
	}
	if _, allowed := configuredIdentity.allowedPurposes[claims.Purpose]; !allowed {
		return errVerifierTokenInvalid
	}
	return nil
}

func contractPurposeForPrincipal(issuer, subject string) (ragembedding.Purpose, bool) {
	switch {
	case issuer == ChatAPIIssuer && subject == ChatAPISubject:
		return ragembedding.PurposeQuery, true
	case issuer == WorkerIssuer && subject == WorkerSubject:
		return ragembedding.PurposeIngestion, true
	default:
		return "", false
	}
}
