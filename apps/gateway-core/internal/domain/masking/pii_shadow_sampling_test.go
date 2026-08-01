package masking

import (
	"context"
	"fmt"
	"testing"
)

func TestPIIShadowSamplerRequiresEnabledAllowedTenantAndRequest(t *testing.T) {
	enabled := NewPIIShadowSampler(true, []string{"tenant_demo"}, PIIShadowSampleScale)
	if enabled.ShouldCapture(context.Background()) {
		t.Fatal("scope-less request must not be captured")
	}
	if enabled.ShouldCapture(WithPIIShadowScope(context.Background(), "tenant_other", "request_1")) {
		t.Fatal("non-allowed tenant must not be captured")
	}
	if !enabled.ShouldCapture(WithPIIShadowScope(context.Background(), "tenant_demo", "request_1")) {
		t.Fatal("allowed tenant should be captured at 100 percent")
	}
	disabled := NewPIIShadowSampler(false, []string{"tenant_demo"}, PIIShadowSampleScale)
	if disabled.ShouldCapture(WithPIIShadowScope(context.Background(), "tenant_demo", "request_1")) {
		t.Fatal("disabled sampler must not capture")
	}
}

func TestPIIShadowSamplerIsDeterministicAndApproximatelyFivePercent(t *testing.T) {
	sampler := NewPIIShadowSampler(true, []string{"tenant_demo"}, 500)
	captured := 0
	for index := 0; index < 10_000; index++ {
		ctx := WithPIIShadowScope(context.Background(), "tenant_demo", fmt.Sprintf("request_%d", index))
		first := sampler.ShouldCapture(ctx)
		if first != sampler.ShouldCapture(ctx) {
			t.Fatal("same tenant and request must produce the same decision")
		}
		if first {
			captured++
		}
	}
	if captured < 400 || captured > 600 {
		t.Fatalf("expected approximately five percent, got %d/10000", captured)
	}
}
