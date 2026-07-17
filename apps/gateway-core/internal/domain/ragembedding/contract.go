package ragembedding

import (
	"errors"
	"regexp"
	"strings"
)

const ProfileVersion = 1

type Purpose string

const (
	PurposeIngestion Purpose = "RAG_INGESTION"
	PurposeQuery     Purpose = "RAG_QUERY"
)

var (
	ErrInvalidRequest = errors.New("rag embedding request is invalid")
	opaqueIDPattern   = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	canonicalUUID     = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
)

// Request is the complete public JSON body accepted by the private RAG
// embedding endpoint. Tenant and provider configuration are deliberately not
// part of this type; tenant identity comes from the verified workload token.
type Request struct {
	Purpose        Purpose  `json:"purpose"`
	ProfileVersion int      `json:"profileVersion"`
	Inputs         []string `json:"inputs"`
}

func ValidateRequest(value Request) error {
	if !value.Purpose.Valid() || value.ProfileVersion != ProfileVersion || len(value.Inputs) == 0 {
		return ErrInvalidRequest
	}
	for _, input := range value.Inputs {
		if strings.TrimSpace(input) == "" {
			return ErrInvalidRequest
		}
	}
	return nil
}

func (p Purpose) Valid() bool {
	return p == PurposeIngestion || p == PurposeQuery
}

type CallerIdentity struct {
	issuer  string
	subject string
	keyID   string
}

func NewCallerIdentity(issuer, subject, keyID string) (CallerIdentity, error) {
	if !validCallerField(issuer) || !validCallerField(subject) || !opaqueIDPattern.MatchString(keyID) {
		return CallerIdentity{}, ErrInvalidRequest
	}
	return CallerIdentity{issuer: issuer, subject: subject, keyID: keyID}, nil
}

func (c CallerIdentity) Issuer() string  { return c.issuer }
func (c CallerIdentity) Subject() string { return c.subject }
func (c CallerIdentity) KeyID() string   { return c.keyID }

// VerifiedScope has no exported mutable fields. Callers receive only values
// copied out through getters, so request code cannot replace the tenant chosen
// by workload authentication.
type VerifiedScope struct {
	tenantID       string
	requestID      string
	operationID    string
	purpose        Purpose
	profileVersion int
	caller         CallerIdentity
}

func NewVerifiedScope(
	tenantID string,
	requestID string,
	operationID string,
	purpose Purpose,
	profileVersion int,
	caller CallerIdentity,
) (VerifiedScope, error) {
	if !canonicalUUID.MatchString(tenantID) ||
		!opaqueIDPattern.MatchString(requestID) ||
		!opaqueIDPattern.MatchString(operationID) ||
		!purpose.Valid() || profileVersion != ProfileVersion ||
		caller.issuer == "" || caller.subject == "" || caller.keyID == "" {
		return VerifiedScope{}, ErrInvalidRequest
	}
	return VerifiedScope{
		tenantID:       tenantID,
		requestID:      requestID,
		operationID:    operationID,
		purpose:        purpose,
		profileVersion: profileVersion,
		caller:         caller,
	}, nil
}

func (s VerifiedScope) TenantID() string       { return s.tenantID }
func (s VerifiedScope) RequestID() string      { return s.requestID }
func (s VerifiedScope) OperationID() string    { return s.operationID }
func (s VerifiedScope) Purpose() Purpose       { return s.purpose }
func (s VerifiedScope) ProfileVersion() int    { return s.profileVersion }
func (s VerifiedScope) Caller() CallerIdentity { return s.caller }

func IsCanonicalTenantID(value string) bool {
	return canonicalUUID.MatchString(value)
}

func IsOpaqueID(value string) bool {
	return opaqueIDPattern.MatchString(value)
}

func validCallerField(value string) bool {
	trimmed := strings.TrimSpace(value)
	return value == trimmed && value != "" && len(value) <= 128 && !strings.ContainsAny(value, "\r\n\t ")
}
