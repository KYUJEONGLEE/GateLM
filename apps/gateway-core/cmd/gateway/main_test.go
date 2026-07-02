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
				t.Errorf("isStrictRuntimeSnapshotMode(%q) = %v, want %v", tt.mode, got, tt.want)
			}
		})
	}
}

func TestValidateRuntimeSnapshotMode(t *testing.T) {
	tests := []struct {
		name    string
		mode    string
		wantErr bool
	}{
		{name: "demo", mode: "demo", wantErr: false},
		{name: "empty", mode: "", wantErr: false},
		{name: "strict", mode: "strict", wantErr: false},
		{name: "strict snapshot alias", mode: "strict_snapshot", wantErr: false},
		{name: "case and space tolerant", mode: " Strict ", wantErr: false},
		{name: "typo", mode: "stric", wantErr: true},
		{name: "unknown", mode: "control_plane", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateRuntimeSnapshotMode(config.Config{RuntimeSnapshotMode: tt.mode})
			if (err != nil) != tt.wantErr {
				t.Errorf("validateRuntimeSnapshotMode(%q) error = %v, wantErr %v", tt.mode, err, tt.wantErr)
			}
		})
	}
}
