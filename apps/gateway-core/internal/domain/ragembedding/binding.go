package ragembedding

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"

	"github.com/cyberphone/json-canonicalization/go/src/webpki.org/jsoncanonicalizer"
)

type BindingObject struct {
	TenantID       string  `json:"tenantId"`
	RequestID      string  `json:"requestId"`
	OperationID    string  `json:"operationId"`
	Purpose        Purpose `json:"purpose"`
	ProfileVersion int     `json:"profileVersion"`
	PayloadDigest  string  `json:"payloadDigest"`
}

func ComputePayloadDigest(value Request) (string, error) {
	canonical, err := canonicalJSON(value)
	if err != nil {
		return "", fmt.Errorf("canonicalize rag embedding request: %w", err)
	}
	digest := sha256.Sum256(canonical)
	return "sha256:" + base64.RawURLEncoding.EncodeToString(digest[:]), nil
}

func ComputeBindingDigest(value BindingObject, key []byte) (string, []byte, error) {
	if len(key) != 32 {
		return "", nil, fmt.Errorf("rag embedding binding HMAC key must contain 32 bytes")
	}
	canonical, err := canonicalJSON(value)
	if err != nil {
		return "", nil, fmt.Errorf("canonicalize rag embedding binding: %w", err)
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(canonical)
	digest := "hmac-sha256:" + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return digest, canonical, nil
}

func BindingDigestMatches(expected, actual string) bool {
	return subtle.ConstantTimeCompare([]byte(expected), []byte(actual)) == 1
}

func canonicalJSON(value any) ([]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return jsoncanonicalizer.Transform(raw)
}
