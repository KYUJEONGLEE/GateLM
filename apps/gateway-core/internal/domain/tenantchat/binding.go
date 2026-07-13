package tenantchat

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"

	"github.com/cyberphone/json-canonicalization/go/src/webpki.org/jsoncanonicalizer"
)

const EmptyPayloadDigest = "sha256:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU"

type BindingObject struct {
	AdmissionID     *string        `json:"admissionId"`
	ExecutionScope  ExecutionScope `json:"executionScope"`
	IdempotencyKey  string         `json:"idempotencyKey"`
	PayloadDigest   string         `json:"payloadDigest"`
	Phase           Phase          `json:"phase"`
	RequestID       string         `json:"requestId"`
	SnapshotDigest  string         `json:"snapshotDigest"`
	SnapshotVersion int64          `json:"snapshotVersion"`
	TurnID          string         `json:"turnId"`
	UsageIntent     *UsageIntent   `json:"usageIntent,omitempty"`
}

func BuildBindingObject(context RequestContext, payloadDigest string) BindingObject {
	var admissionID *string
	if context.AdmissionID != "" {
		value := context.AdmissionID
		admissionID = &value
	}
	return BindingObject{
		AdmissionID:     admissionID,
		ExecutionScope:  context.ExecutionScope,
		IdempotencyKey:  context.IdempotencyKey,
		PayloadDigest:   payloadDigest,
		Phase:           context.Phase,
		RequestID:       context.RequestID,
		SnapshotDigest:  context.Snapshot.Digest,
		SnapshotVersion: context.Snapshot.Version,
		TurnID:          context.TurnID,
		UsageIntent:     context.UsageIntent,
	}
}

func ComputePayloadDigest(value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("marshal payload for digest: %w", err)
	}
	canonical, err := jsoncanonicalizer.Transform(raw)
	if err != nil {
		return "", fmt.Errorf("canonicalize payload: %w", err)
	}
	digest := sha256.Sum256(canonical)
	return "sha256:" + base64.RawURLEncoding.EncodeToString(digest[:]), nil
}

func ComputeBindingDigest(value BindingObject, key []byte) (string, []byte, error) {
	if len(key) != 32 {
		return "", nil, fmt.Errorf("binding HMAC key must contain 32 bytes")
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return "", nil, fmt.Errorf("marshal binding object: %w", err)
	}
	canonical, err := jsoncanonicalizer.Transform(raw)
	if err != nil {
		return "", nil, fmt.Errorf("canonicalize binding object: %w", err)
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(canonical)
	digest := "hmac-sha256:" + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return digest, canonical, nil
}

func BindingDigestMatches(expected, actual string) bool {
	return subtle.ConstantTimeCompare([]byte(expected), []byte(actual)) == 1
}
