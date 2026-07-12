package runtime

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

type validationVectors struct {
	Cases []struct {
		ID    string `json:"id"`
		Path  string `json:"path"`
		Value any    `json:"value"`
		Valid bool   `json:"valid"`
	} `json:"cases"`
}

func TestEmbeddedSchemaMatchesContractDocument(t *testing.T) {
	docsRoot := tenantChatDocsRoot(t)
	contractSchema, err := os.ReadFile(filepath.Join(docsRoot, "schemas/tenant-runtime-snapshot.schema.json"))
	if err != nil {
		t.Fatalf("read contract schema: %v", err)
	}
	if !bytes.Equal(normalizeLineEndings(contractSchema), normalizeLineEndings(snapshotSchemaDocument)) {
		t.Fatal("embedded runtime snapshot schema drifted from docs/tenant-chat contract")
	}
}

func normalizeLineEndings(document []byte) []byte {
	return bytes.ReplaceAll(document, []byte("\r\n"), []byte("\n"))
}

func TestRuntimeSnapshotValidationVectors(t *testing.T) {
	docsRoot := tenantChatDocsRoot(t)
	fixtureRaw, err := os.ReadFile(filepath.Join(docsRoot, "fixtures/tenant-runtime-snapshot.fixture.json"))
	if err != nil {
		t.Fatalf("read runtime snapshot fixture: %v", err)
	}
	vectorsRaw, err := os.ReadFile(filepath.Join(docsRoot, "vectors/runtime-snapshot-validation-vectors.json"))
	if err != nil {
		t.Fatalf("read runtime snapshot vectors: %v", err)
	}
	var vectors validationVectors
	if err := json.Unmarshal(vectorsRaw, &vectors); err != nil {
		t.Fatalf("decode runtime snapshot vectors: %v", err)
	}

	for _, vector := range vectors.Cases {
		vector := vector
		t.Run(vector.ID, func(t *testing.T) {
			var document any
			decoder := json.NewDecoder(bytes.NewReader(fixtureRaw))
			decoder.UseNumber()
			if err := decoder.Decode(&document); err != nil {
				t.Fatalf("decode fixture: %v", err)
			}
			setJSONPath(t, document, strings.Split(vector.Path, "."), vector.Value)
			mutated, err := json.Marshal(document)
			if err != nil {
				t.Fatalf("encode mutated fixture: %v", err)
			}
			_, err = ParseSnapshot(mutated)
			if (err == nil) != vector.Valid {
				t.Fatalf("valid=%t, parse error=%v", vector.Valid, err)
			}
		})
	}
}

func tenantChatDocsRoot(t *testing.T) string {
	t.Helper()
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve current test file")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(currentFile), "../../../../../../docs/tenant-chat"))
}

func setJSONPath(t *testing.T, current any, path []string, value any) {
	t.Helper()
	if len(path) == 0 {
		t.Fatal("empty JSON mutation path")
	}
	if len(path) == 1 {
		switch target := current.(type) {
		case map[string]any:
			target[path[0]] = value
		case []any:
			index, err := strconv.Atoi(path[0])
			if err != nil || index < 0 || index >= len(target) {
				t.Fatalf("invalid array index %q", path[0])
			}
			target[index] = value
		default:
			t.Fatalf("cannot set JSON path on %T", current)
		}
		return
	}
	switch target := current.(type) {
	case map[string]any:
		next, ok := target[path[0]]
		if !ok {
			t.Fatalf("missing JSON object key %q", path[0])
		}
		setJSONPath(t, next, path[1:], value)
	case []any:
		index, err := strconv.Atoi(path[0])
		if err != nil || index < 0 || index >= len(target) {
			t.Fatalf("invalid array index %q", path[0])
		}
		setJSONPath(t, target[index], path[1:], value)
	default:
		t.Fatalf("cannot traverse JSON path on %T", current)
	}
}
