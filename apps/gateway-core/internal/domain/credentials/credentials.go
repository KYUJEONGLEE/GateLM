package credentials

import (
	"context"
	"errors"
	"strings"
)

const StateActive = "active"

var (
	ErrMissingReference = errors.New("credential reference is missing")
	ErrInactive         = errors.New("credential reference is not active")
	ErrUnavailable      = errors.New("credential is unavailable")
)

type Ref struct {
	CredentialRefID   string
	CredentialVersion int
	CredentialState   string
	CredentialHash    string
}

type Resolved struct {
	Value string
}

type Resolver interface {
	Resolve(ctx context.Context, ref Ref) (Resolved, error)
}

func (r Ref) Normalize() Ref {
	return Ref{
		CredentialRefID:   strings.TrimSpace(r.CredentialRefID),
		CredentialVersion: r.CredentialVersion,
		CredentialState:   strings.TrimSpace(r.CredentialState),
		CredentialHash:    strings.TrimSpace(r.CredentialHash),
	}
}

func (r Ref) IsZero() bool {
	r = r.Normalize()
	return r.CredentialRefID == "" &&
		r.CredentialVersion == 0 &&
		r.CredentialState == "" &&
		r.CredentialHash == ""
}

func (r Ref) ValidateActive() error {
	r = r.Normalize()
	if r.CredentialRefID == "" || r.CredentialVersion <= 0 {
		return ErrMissingReference
	}
	if r.CredentialState != StateActive {
		return ErrInactive
	}
	return nil
}
