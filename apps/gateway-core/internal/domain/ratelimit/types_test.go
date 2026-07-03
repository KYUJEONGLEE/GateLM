package ratelimit

import "testing"

func TestScopeID(t *testing.T) {
	req := Request{
		ProjectID:     "project_test",
		ApplicationID: "application_test",
	}

	tests := []struct {
		name  string
		scope string
		want  string
	}{
		{name: "application scope", scope: ScopeApplication, want: "application_test"},
		{name: "project scope", scope: ScopeProject, want: "project_test"},
		{name: "unsupported scope", scope: "user", want: ""},
		{name: "empty scope", scope: "", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ScopeID(tt.scope, req); got != tt.want {
				t.Errorf("ScopeID(%q) = %q, want %q", tt.scope, got, tt.want)
			}
		})
	}
}
