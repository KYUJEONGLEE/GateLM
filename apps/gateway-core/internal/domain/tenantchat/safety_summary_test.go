package tenantchat

import (
	"strings"
	"testing"
)

func TestSafetyAllowsExactCacheRequiresExplicitNonMaskingEvidence(t *testing.T) {
	digest := "sha256:" + strings.Repeat("A", 43)
	tests := []struct {
		name          string
		safetyEnabled bool
		summary       *SafetySummary
		want          bool
	}{
		{name: "disabled safety", safetyEnabled: false, want: true},
		{name: "missing evidence", safetyEnabled: true, want: false},
		{name: "explicit none", safetyEnabled: true, summary: &SafetySummary{
			MaskingAction: "none", MaskingDetectedTypes: []string{}, SafetyPolicyDigest: digest,
		}, want: true},
		{name: "redacted", safetyEnabled: true, summary: &SafetySummary{
			MaskingAction: "redacted", MaskingDetectedTypes: []string{"email"},
			MaskingDetectedCount: 1, SafetyPolicyDigest: digest,
		}, want: false},
		{name: "blocked", safetyEnabled: true, summary: &SafetySummary{
			MaskingAction: "blocked", MaskingDetectedTypes: []string{"api_key"},
			MaskingDetectedCount: 1, SafetyPolicyDigest: digest,
		}, want: false},
		{name: "invalid none", safetyEnabled: true, summary: &SafetySummary{
			MaskingAction: "none", MaskingDetectedTypes: []string{"INVALID"}, SafetyPolicyDigest: digest,
		}, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := SafetyAllowsExactCache(test.safetyEnabled, test.summary); got != test.want {
				t.Fatalf("SafetyAllowsExactCache() = %t, want %t", got, test.want)
			}
		})
	}
}
