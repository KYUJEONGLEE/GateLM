package tenantchat

import (
	"fmt"
	"regexp"
	"slices"
)

const (
	MaxSafetyDetectedTypes = 32
	MaxSafetyDetectedCount = 1_000_000
)

var (
	safetyDetectorTypePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
	safetyPolicyDigestPattern = regexp.MustCompile(`^sha256:[A-Za-z0-9_-]{43}$`)
)

// SafetySummary is content-free server execution state. It must never contain
// detected values, prompt fragments, spans, offsets, or provider error detail.
type SafetySummary struct {
	MaskingAction        string   `json:"maskingAction"`
	MaskingDetectedTypes []string `json:"maskingDetectedTypes"`
	MaskingDetectedCount int      `json:"maskingDetectedCount"`
	SafetyPolicyDigest   string   `json:"safetyPolicyDigest"`
}

func ValidateSafetySummary(summary SafetySummary) error {
	switch summary.MaskingAction {
	case "none", "redacted", "blocked":
	default:
		return fmt.Errorf("invalid tenant chat masking action")
	}
	if summary.MaskingDetectedCount < 0 || summary.MaskingDetectedCount > MaxSafetyDetectedCount {
		return fmt.Errorf("invalid tenant chat detected count")
	}
	if len(summary.MaskingDetectedTypes) > MaxSafetyDetectedTypes ||
		!safetyPolicyDigestPattern.MatchString(summary.SafetyPolicyDigest) {
		return fmt.Errorf("invalid tenant chat safety summary")
	}
	previous := ""
	for _, detectorType := range summary.MaskingDetectedTypes {
		if !safetyDetectorTypePattern.MatchString(detectorType) || detectorType <= previous {
			return fmt.Errorf("invalid tenant chat detector types")
		}
		previous = detectorType
	}
	return nil
}

func SameSafetySummary(left, right *SafetySummary) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return left.MaskingAction == right.MaskingAction &&
		left.MaskingDetectedCount == right.MaskingDetectedCount &&
		left.SafetyPolicyDigest == right.SafetyPolicyDigest &&
		slices.Equal(left.MaskingDetectedTypes, right.MaskingDetectedTypes)
}

func CloneSafetySummary(summary *SafetySummary) *SafetySummary {
	if summary == nil {
		return nil
	}
	cloned := *summary
	cloned.MaskingDetectedTypes = append([]string(nil), summary.MaskingDetectedTypes...)
	return &cloned
}
