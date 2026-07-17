package embedding

import (
	"context"
	"errors"
)

const ProviderOpenAI = "openai"

var (
	ErrCredentialRequired    = errors.New("embedding credential is required")
	ErrCredentialUnavailable = errors.New("embedding credential is unavailable")
	ErrInvalidRequest        = errors.New("embedding request is invalid")
	ErrInputEmpty            = errors.New("embedding input is empty")
	ErrRequestFailed         = errors.New("embedding request failed")
	ErrRateLimited           = errors.New("embedding provider rate limited the request")
	ErrUnauthorized          = errors.New("embedding provider authorization failed")
	ErrTimeout               = errors.New("embedding request timed out")
	ErrInvalidResponse       = errors.New("embedding response is invalid")
	ErrResponseTooLarge      = errors.New("embedding response is too large")
	ErrEmptyVector           = errors.New("embedding response vector is empty")
)

// Request contains only server-owned provider configuration and bounded text
// inputs. Public or private HTTP handlers must not copy client-selectable model
// or dimension values into this type.
type Request struct {
	Inputs     []string
	Model      string
	Dimensions int
}

type Usage struct {
	PromptTokens int
	TotalTokens  int
}

type Result struct {
	Vectors [][]float64
	Model   string
	Usage   Usage
}

// Provider is the provider-neutral batch embedding boundary. Implementations
// must preserve input order in Result.Vectors.
type Provider interface {
	Embed(ctx context.Context, request Request) (Result, error)
	ProviderName() string
}
