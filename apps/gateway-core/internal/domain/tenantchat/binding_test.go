package tenantchat

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

type bindingVectorFile struct {
	Vectors []struct {
		VectorID              string        `json:"vectorId"`
		KeyHex                string        `json:"keyHex"`
		BindingObject         BindingObject `json:"bindingObject"`
		CanonicalBinding      string        `json:"canonicalBinding"`
		ExpectedBindingDigest string        `json:"expectedBindingDigest"`
	} `json:"vectors"`
}

func TestBindingDigestVectors(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve current test file")
	}
	path := filepath.Join(filepath.Dir(currentFile), "../../../../../docs/tenant-chat/vectors/binding-digest-vectors.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read binding vectors: %v", err)
	}
	var vectors bindingVectorFile
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatalf("decode binding vectors: %v", err)
	}

	for _, vector := range vectors.Vectors {
		vector := vector
		t.Run(vector.VectorID, func(t *testing.T) {
			key, err := hex.DecodeString(vector.KeyHex)
			if err != nil {
				t.Fatalf("decode key: %v", err)
			}
			digest, canonical, err := ComputeBindingDigest(vector.BindingObject, key)
			if err != nil {
				t.Fatalf("compute binding digest: %v", err)
			}
			if string(canonical) != vector.CanonicalBinding {
				t.Fatalf("canonical binding mismatch\nwant: %s\n got: %s", vector.CanonicalBinding, canonical)
			}
			if digest != vector.ExpectedBindingDigest {
				t.Fatalf("digest mismatch: want %s, got %s", vector.ExpectedBindingDigest, digest)
			}
		})
	}
}
