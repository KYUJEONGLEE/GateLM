package cache

import (
	"context"
)

type ExactKeyBuilder struct {
	Secret []byte
}

func NewExactKeyBuilder(secret []byte) ExactKeyBuilder {
	return ExactKeyBuilder{Secret: secret}
}

func (b ExactKeyBuilder) BuildExactKey(_ context.Context, material KeyMaterial) (string, error) {
	return BuildExactKey(b.Secret, material)
}
