package usagereceipt

import (
	"os"
	"path/filepath"
	"testing"
)

func TestTokenRequiresDedicatedExactBearer(t *testing.T) {
	path := filepath.Join(t.TempDir(), "receipt-token")
	value := "synthetic_receipt_token_0123456789abcdef"
	if err := os.WriteFile(path, []byte(value+"\n"), 0o600); err != nil {
		t.Fatalf("write receipt token: %v", err)
	}
	token, err := LoadToken(path)
	if err != nil {
		t.Fatalf("load receipt token: %v", err)
	}
	if !token.Authenticate("Bearer "+value) || token.Authenticate("Bearer "+value+"x") || token.Authenticate(value) {
		t.Fatal("receipt token did not enforce an exact dedicated bearer")
	}
}
