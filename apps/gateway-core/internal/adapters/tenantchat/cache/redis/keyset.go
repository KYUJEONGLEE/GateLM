package redis

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

var ErrKeySetUnavailable = errors.New("tenant chat cache key set unavailable")

type KeySet struct {
	ID             string
	FingerprintKey []byte
	EncryptionKey  []byte
}

type KeySets struct {
	byID map[string]KeySet
}

type keySetFile struct {
	KeySets []keySetDocument `json:"keySets"`
}

type keySetDocument struct {
	KeySetID       string `json:"keySetId"`
	FingerprintKey string `json:"fingerprintKey"`
	EncryptionKey  string `json:"encryptionKey"`
}

func LoadKeySets(path string) (*KeySets, error) {
	if strings.TrimSpace(path) == "" {
		return nil, ErrKeySetUnavailable
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("%w: read key set file", ErrKeySetUnavailable)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var document keySetFile
	if err := decoder.Decode(&document); err != nil {
		return nil, fmt.Errorf("%w: decode key set file", ErrKeySetUnavailable)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) || len(document.KeySets) == 0 {
		return nil, ErrKeySetUnavailable
	}
	loaded := &KeySets{byID: make(map[string]KeySet, len(document.KeySets))}
	for _, item := range document.KeySets {
		id := strings.TrimSpace(item.KeySetID)
		fingerprintKey, fingerprintErr := base64.RawURLEncoding.DecodeString(item.FingerprintKey)
		encryptionKey, encryptionErr := base64.RawURLEncoding.DecodeString(item.EncryptionKey)
		if id == "" || fingerprintErr != nil || encryptionErr != nil || len(fingerprintKey) != 32 || len(encryptionKey) != 32 {
			return nil, ErrKeySetUnavailable
		}
		if _, exists := loaded.byID[id]; exists {
			return nil, ErrKeySetUnavailable
		}
		loaded.byID[id] = KeySet{ID: id, FingerprintKey: fingerprintKey, EncryptionKey: encryptionKey}
	}
	return loaded, nil
}

func (k *KeySets) Resolve(id string) (KeySet, error) {
	if k == nil {
		return KeySet{}, ErrKeySetUnavailable
	}
	keySet, ok := k.byID[strings.TrimSpace(id)]
	if !ok {
		return KeySet{}, ErrKeySetUnavailable
	}
	return keySet, nil
}
