package sanitization

import (
	"context"
	"errors"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantchatruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

const testPolicyDigest = "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

type fakeSnapshots struct {
	snapshot tenantchatruntime.Snapshot
	err      error
	calls    int
}

func (f *fakeSnapshots) Resolve(_ context.Context, _ tenantchat.RequestContext) (tenantchatruntime.Snapshot, error) {
	f.calls++
	return f.snapshot, f.err
}

type fakeAdmissions struct {
	err   error
	calls int
}

func (f *fakeAdmissions) ValidateActive(_ context.Context, _ tenantchat.RequestContext) error {
	f.calls++
	return f.err
}

type fakeSafety struct {
	evaluation tenantchat.SanitizationEvaluation
	err        error
	calls      int
}

func (f *fakeSafety) Sanitize(
	_ context.Context,
	_ tenantchatruntime.Snapshot,
	_ tenantchat.SanitizationInput,
) (tenantchat.SanitizationEvaluation, error) {
	f.calls++
	return f.evaluation, f.err
}

type fakeLedgerless struct {
	err             error
	calls           int
	recordCalls     int
	recordedSummary tenantchat.SafetySummary
	terminalOutcome string
	errorCode       string
	cacheOutcome    string
}

func (f *fakeLedgerless) RecordSafetySummary(
	_ context.Context,
	_ tenantchat.RequestContext,
	summary tenantchat.SafetySummary,
) (bool, error) {
	f.recordCalls++
	f.recordedSummary = summary
	return false, f.err
}

func (f *fakeLedgerless) FinalizeLedgerless(
	_ context.Context,
	_ tenantchat.RequestContext,
	_ tenantchatruntime.Snapshot,
	terminalOutcome string,
	errorCode string,
	cacheOutcome string,
	_ tenantchat.LedgerlessObservability,
) (bool, error) {
	f.calls++
	f.terminalOutcome = terminalOutcome
	f.errorCode = errorCode
	f.cacheOutcome = cacheOutcome
	return false, f.err
}

func TestSanitizeReturnsStorageSafeMessagesWithoutConsumingAdmission(t *testing.T) {
	snapshot := sanitizationSnapshot()
	admissions := &fakeAdmissions{}
	safety := &fakeSafety{evaluation: tenantchat.SanitizationEvaluation{
		Messages:     []tenantchat.SanitizedMessage{{ItemIndex: 0, Content: "safe [EMAIL_1]"}},
		PolicyDigest: testPolicyDigest,
		Summary:      testSafetySummary("redacted"),
	}}
	ledger := &fakeLedgerless{}
	service := New(&fakeSnapshots{snapshot: snapshot}, admissions, safety, ledger)

	response, err := service.Sanitize(context.Background(), sanitizationRequest())
	if err != nil {
		t.Fatalf("sanitize allowed input: %v", err)
	}
	if admissions.calls != 1 || safety.calls != 1 || ledger.calls != 0 || ledger.recordCalls != 1 {
		t.Fatalf("unexpected allowed call flow: admissions=%d safety=%d ledger=%d records=%d", admissions.calls, safety.calls, ledger.calls, ledger.recordCalls)
	}
	if response.PolicyDigest != testPolicyDigest || len(response.Messages) != 1 ||
		response.Messages[0].Content != "safe [EMAIL_1]" {
		t.Fatalf("unexpected sanitization response: %+v", response)
	}
}

func TestSanitizeBlockFinalizesLedgerlessBeforeReturningSafetyBlock(t *testing.T) {
	ledger := &fakeLedgerless{}
	service := New(
		&fakeSnapshots{snapshot: sanitizationSnapshot()},
		&fakeAdmissions{},
		&fakeSafety{evaluation: tenantchat.SanitizationEvaluation{
			Blocked: true, PolicyDigest: testPolicyDigest, Summary: testSafetySummary("blocked"),
		}},
		ledger,
	)

	_, err := service.Sanitize(context.Background(), sanitizationRequest())
	if !errors.Is(err, tenantchat.ErrSafetyBlocked) {
		t.Fatalf("expected safety block, got %v", err)
	}
	if ledger.recordCalls != 1 || ledger.calls != 1 || ledger.terminalOutcome != "safety_blocked" ||
		ledger.errorCode != "CHAT_SAFETY_BLOCKED" || ledger.cacheOutcome != "off" {
		t.Fatalf("unexpected blocked ledger settlement: %+v", ledger)
	}
}

func testSafetySummary(action string) tenantchat.SafetySummary {
	return tenantchat.SafetySummary{
		MaskingAction: action, MaskingDetectedTypes: []string{"email"},
		MaskingDetectedCount: 1, SafetyPolicyDigest: testPolicyDigest,
	}
}

func TestSanitizeRejectsInactiveAdmissionBeforeSnapshotOrSafety(t *testing.T) {
	snapshots := &fakeSnapshots{snapshot: sanitizationSnapshot()}
	safety := &fakeSafety{}
	service := New(snapshots, &fakeAdmissions{err: tenantchat.ErrAdmissionExpired}, safety, &fakeLedgerless{})

	_, err := service.Sanitize(context.Background(), sanitizationRequest())
	if !errors.Is(err, tenantchat.ErrAdmissionExpired) {
		t.Fatalf("expected expired admission, got %v", err)
	}
	if snapshots.calls != 0 || safety.calls != 0 {
		t.Fatalf("inactive admission must stop before inspection: snapshots=%d safety=%d", snapshots.calls, safety.calls)
	}
}

func sanitizationSnapshot() tenantchatruntime.Snapshot {
	return tenantchatruntime.Snapshot{Policies: tenantchatruntime.Policies{Safety: tenantchatruntime.SafetyPolicy{
		Enabled: true, PolicyDigest: testPolicyDigest,
		DetectorSet: []tenantchatruntime.SafetyDetector{{DetectorType: "email", Action: "redact"}},
	}}}
}

func sanitizationRequest() tenantchat.SanitizationRequest {
	return tenantchat.SanitizationRequest{
		Context: tenantchat.RequestContext{Phase: tenantchat.PhaseSanitization},
		Input: tenantchat.SanitizationInput{
			Messages: []tenantchat.EphemeralMessage{{Role: "user", Content: "raw input"}},
		},
	}
}
