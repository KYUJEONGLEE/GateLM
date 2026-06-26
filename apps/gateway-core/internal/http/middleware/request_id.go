package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
)

const RequestIDHeader = "X-GateLM-Request-Id"

func NewRequestID() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "request_fallback"
	}

	return "request_" + hex.EncodeToString(bytes[:])
}

func NormalizeRequestID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 128 {
		return ""
	}
	return value
}
