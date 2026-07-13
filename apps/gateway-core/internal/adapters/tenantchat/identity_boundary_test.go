package tenantchat_test

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
)

func TestTenantChatGatewayDoesNotQueryControlPlaneIdentityTables(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve ownership test path")
	}
	gatewayRoot := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "../../.."))
	paths := []string{
		filepath.Join(gatewayRoot, "internal/adapters/tenantchat"),
		filepath.Join(gatewayRoot, "internal/services/tenantchat"),
		filepath.Join(gatewayRoot, "internal/http/tenantchat"),
		filepath.Join(gatewayRoot, "cmd/gateway/main.go"),
	}
	identityQuery := regexp.MustCompile(`(?i)\b(?:FROM|JOIN)\s+(?:users|tenant_memberships|employees)\b`)

	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("stat Tenant Chat ownership path %s: %v", path, err)
		}
		if !info.IsDir() {
			assertNoIdentityQuery(t, path, identityQuery)
			continue
		}
		err = filepath.WalkDir(path, func(candidate string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
				return nil
			}
			assertNoIdentityQuery(t, candidate, identityQuery)
			return nil
		})
		if err != nil {
			t.Fatalf("walk Tenant Chat ownership path %s: %v", path, err)
		}
	}
}

func assertNoIdentityQuery(t *testing.T, path string, identityQuery *regexp.Regexp) {
	t.Helper()
	document, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if match := identityQuery.Find(document); match != nil {
		t.Fatalf("Tenant Chat Gateway must not query Control Plane identity tables: %s contains %q", path, match)
	}
}
