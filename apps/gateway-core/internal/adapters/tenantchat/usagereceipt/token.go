package usagereceipt

import (
	"crypto/subtle"
	"errors"
	"os"
	"strings"
)

var ErrTokenUnavailable = errors.New("tenant chat usage receipt token unavailable")

type Token struct {
	value []byte
}

func LoadToken(path string) (*Token, error) {
	if strings.TrimSpace(path) == "" {
		return nil, ErrTokenUnavailable
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, ErrTokenUnavailable
	}
	value := strings.TrimSpace(string(raw))
	if len(value) < 32 || len(value) > 512 || strings.ContainsAny(value, " \t\r\n") {
		return nil, ErrTokenUnavailable
	}
	return &Token{value: []byte(value)}, nil
}

func (t *Token) Authenticate(authorization string) bool {
	if t == nil || len(t.value) == 0 {
		return false
	}
	prefix, value, ok := strings.Cut(strings.TrimSpace(authorization), " ")
	if !ok || prefix != "Bearer" || value == "" || strings.Contains(value, " ") {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(value), t.value) == 1
}
