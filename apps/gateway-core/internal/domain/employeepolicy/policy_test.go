package employeepolicy

import "testing"

func TestEvaluateRestrictsHighQualityOnlyAfterQuotaExceeded(t *testing.T) {
	warned := Evaluate(Policy{
		EmployeeID: "employee_1",
		Quota: QuotaPolicy{
			Enabled:                 true,
			LimitMicroUSD:           100,
			UsedMicroUSD:            80,
			WarningThresholdPercent: 80,
		},
	})
	if warned.QuotaOutcome != QuotaOutcomeWarned || RestrictsHighQuality(&warned) {
		t.Fatalf("warning must not restrict high quality, got %#v", warned)
	}

	exceeded := Evaluate(Policy{
		EmployeeID: "employee_1",
		Quota: QuotaPolicy{
			Enabled:                 true,
			LimitMicroUSD:           100,
			UsedMicroUSD:            100,
			WarningThresholdPercent: 80,
		},
	})
	if exceeded.QuotaOutcome != QuotaOutcomeExceeded || !RestrictsHighQuality(&exceeded) {
		t.Fatalf("quota exceed must restrict high quality, got %#v", exceeded)
	}
}

func TestEvaluateTreatsZeroQuotaAsNotConfigured(t *testing.T) {
	decision := Evaluate(Policy{
		EmployeeID: "employee_1",
		Quota: QuotaPolicy{
			Enabled:       true,
			LimitMicroUSD: 0,
		},
	})
	if decision.QuotaOutcome != QuotaOutcomeNotUsed || RestrictsHighQuality(&decision) {
		t.Fatalf("zero quota must remain unconfigured, got %#v", decision)
	}
}
