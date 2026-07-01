package main

import (
	"testing"

	"gatelm/apps/gateway-core/internal/config"
)

func TestIsStrictRuntimeSnapshotMode(t *testing.T) {
	tests := []struct {
		name string
		mode string
		want bool
	}{
		{name: "default demo mode", mode: "demo", want: false},
		{name: "empty mode", mode: "", want: false},
		{name: "strict mode", mode: "strict", want: true},
		{name: "strict snapshot alias", mode: "strict_snapshot", want: true},
		{name: "case and space tolerant", mode: " Strict ", want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isStrictRuntimeSnapshotMode(config.Config{RuntimeSnapshotMode: tt.mode})
			if got != tt.want {
				t.Fatalf("isStrictRuntimeSnapshotMode(%q) = %v, want %v", tt.mode, got, tt.want)
			}
		})
	}
}
