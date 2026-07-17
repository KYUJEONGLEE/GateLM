package tenantchat

import (
	"fmt"
	"regexp"
)

var (
	opaqueIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	digestPattern   = regexp.MustCompile(`^sha256:[A-Za-z0-9_-]{43}$`)
	hmacPattern     = regexp.MustCompile(`^hmac-sha256:[A-Za-z0-9_-]{43}$`)
)

func ValidateUsageReceipt(receipt UsageReceipt) error {
	if !opaqueIDPattern.MatchString(receipt.RequestID) || !opaqueIDPattern.MatchString(receipt.ProviderID) ||
		receipt.AttemptNo < 1 || receipt.AttemptNo > 4 ||
		receipt.InputTokens < 0 || receipt.OutputTokens < 0 ||
		receipt.CacheReadInputTokens < 0 || receipt.CacheReadInputTokens > receipt.InputTokens {
		return fmt.Errorf("usage receipt is invalid")
	}
	return nil
}

func ValidateContext(value RequestContext, expectedPhase Phase) error {
	if value.Surface != "tenant_chat" || value.Phase != expectedPhase {
		return fmt.Errorf("invalid tenant chat surface or phase")
	}
	for name, id := range map[string]string{
		"requestId":      value.RequestID,
		"turnId":         value.TurnID,
		"idempotencyKey": value.IdempotencyKey,
	} {
		if !opaqueIDPattern.MatchString(id) {
			return fmt.Errorf("%s is invalid", name)
		}
	}
	if expectedPhase == PhaseAdmission {
		if value.AdmissionID != "" || value.UsageIntent != nil {
			return fmt.Errorf("admission context has forbidden fields")
		}
	} else if !opaqueIDPattern.MatchString(value.AdmissionID) {
		return fmt.Errorf("admissionId is invalid")
	}
	if expectedPhase == PhaseCompletion && value.UsageIntent == nil {
		return fmt.Errorf("completion usageIntent is required")
	}
	if (expectedPhase == PhaseCancel || expectedPhase == PhaseSanitization) && value.UsageIntent != nil {
		return fmt.Errorf("non-completion usageIntent is forbidden")
	}
	if err := ValidateExecutionScope(value.ExecutionScope); err != nil {
		return err
	}
	if value.Snapshot.Version < 1 || value.Snapshot.PolicyVersion < 1 ||
		value.Snapshot.EmployeeNoticeVersion < 1 || value.Snapshot.PricingVersion < 1 ||
		!digestPattern.MatchString(value.Snapshot.Digest) {
		return fmt.Errorf("snapshot reference is invalid")
	}
	if !hmacPattern.MatchString(value.BindingDigest) {
		return fmt.Errorf("bindingDigest is invalid")
	}
	if value.UsageIntent != nil {
		if value.UsageIntent.EstimatedInputTokens < 0 || value.UsageIntent.MaxOutputTokens < 1 {
			return fmt.Errorf("usageIntent token values are invalid")
		}
		if !oneOf(value.UsageIntent.RequestedTier, "auto", "high_quality", "standard", "economy") ||
			!oneOf(value.UsageIntent.CacheStrategy, "off", "exact") {
			return fmt.Errorf("usageIntent policy values are invalid")
		}
	}
	return nil
}

func ValidateExecutionScope(value ExecutionScope) error {
	if value.Kind != "tenant_chat" || !opaqueIDPattern.MatchString(value.TenantID) {
		return fmt.Errorf("execution scope is invalid")
	}
	if !opaqueIDPattern.MatchString(value.Actor.UserID) || !oneOf(value.Actor.ActorKind, "tenant_admin", "employee") {
		return fmt.Errorf("actor is invalid")
	}
	if value.Actor.ActorKind == "employee" && !opaqueIDPattern.MatchString(value.Actor.EmployeeID) {
		return fmt.Errorf("employeeId is required for employee actor")
	}
	if value.QuotaScope.Type != "user" || value.QuotaScope.ID != value.Actor.UserID {
		return fmt.Errorf("quota scope is invalid")
	}
	if value.BudgetScope.Type != "tenant" || value.BudgetScope.ID != value.TenantID {
		return fmt.Errorf("budget scope is invalid")
	}
	return nil
}

func oneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}
