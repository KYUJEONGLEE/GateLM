package redis

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadKeySetsValidatesShapeAndKeyLengths(t *testing.T) {
	directory := t.TempDir()
	validPath := filepath.Join(directory, "valid.json")
	key := base64.RawURLEncoding.EncodeToString(bytesOf(7))
	if err := os.WriteFile(validPath, []byte(`{"keySets":[{"keySetId":"keys_001","fingerprintKey":"`+key+`","encryptionKey":"`+key+`"}]}`), 0o600); err != nil {
		t.Fatalf("write synthetic keyset: %v", err)
	}
	loaded, err := LoadKeySets(validPath)
	if err != nil {
		t.Fatalf("load valid keyset: %v", err)
	}
	if _, err := loaded.Resolve("keys_001"); err != nil {
		t.Fatalf("resolve valid keyset: %v", err)
	}

	invalidPath := filepath.Join(directory, "invalid.json")
	if err := os.WriteFile(invalidPath, []byte(`{"keySets":[{"keySetId":"keys_001","fingerprintKey":"short","encryptionKey":"short"}]}`), 0o600); err != nil {
		t.Fatalf("write invalid synthetic keyset: %v", err)
	}
	if _, err := LoadKeySets(invalidPath); err == nil {
		t.Fatal("short cache keys must fail closed")
	}
}
