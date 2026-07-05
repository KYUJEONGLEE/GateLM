package costing

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestCalculatorUsesProviderUsageAndPricingRule(t *testing.T) {
	catalog := &fakePricingCatalog{rule: PricingRule{
		ID:                        "price_openai_gpt_4o_mini_v1",
		Provider:                  "openai-main",
		Model:                     "gpt-4o-mini",
		Currency:                  "USD",
		InputMicroUSDPer1MTokens:  150_000,
		OutputMicroUSDPer1MTokens: 600_000,
		PricingVersion:            "pricing_2026_07_demo",
		Source:                    "test",
	}}
	calculator := NewCalculator(catalog)

	result, err := calculator.Calculate(context.Background(), Request{
		ProviderKeys:     []string{"openai-main", "openai-main"},
		ModelKeys:        []string{"gpt-4o-mini"},
		PromptTokens:     2,
		CompletionTokens: 3,
		TotalTokens:      5,
		CompletedAt:      time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("Calculate returned error: %v", err)
	}
	if result.CostMicroUSD != 2 {
		t.Fatalf("unexpected cost: got %d", result.CostMicroUSD)
	}
	if result.TokenCountSource != TokenCountSourceProviderUsage || result.CostSource != CostSourcePricingCatalog {
		t.Fatalf("unexpected costing source: %+v", result)
	}
	if result.PricingRuleID != "price_openai_gpt_4o_mini_v1" || result.PricingVersion != "pricing_2026_07_demo" {
		t.Fatalf("unexpected pricing metadata: %+v", result)
	}
	if catalog.lookup.ProviderKeys[0] != "openai-main" || catalog.lookup.ModelKeys[0] != "gpt-4o-mini" {
		t.Fatalf("unexpected lookup keys: %+v", catalog.lookup)
	}
}

func TestCalculatorMarksMissingPricingWithoutSilentZero(t *testing.T) {
	calculator := NewCalculator(&fakePricingCatalog{err: ErrPricingRuleNotFound})

	result, err := calculator.Calculate(context.Background(), Request{
		ProviderKeys:     []string{"gemini"},
		ModelKeys:        []string{"gemini-1.5-flash"},
		PromptTokens:     12,
		CompletionTokens: 7,
		TotalTokens:      19,
	})
	if err != nil {
		t.Fatalf("Calculate returned error: %v", err)
	}
	if result.CostMicroUSD != 0 || result.CostSource != CostSourcePricingMissing {
		t.Fatalf("unexpected missing pricing result: %+v", result)
	}
	metadata := result.Metadata()
	if metadata["costSource"] != CostSourcePricingMissing || metadata["tokenCountSource"] != TokenCountSourceProviderUsage {
		t.Fatalf("missing pricing must remain visible in metadata: %v", metadata)
	}
}

func TestCalculatorMarksMissingProviderUsage(t *testing.T) {
	calculator := NewCalculator(&fakePricingCatalog{})

	result, err := calculator.Calculate(context.Background(), Request{
		ProviderKeys: []string{"claude"},
		ModelKeys:    []string{"claude-3-5-sonnet-latest"},
	})
	if err != nil {
		t.Fatalf("Calculate returned error: %v", err)
	}
	if result.CostSource != CostSourceProviderUsageMissing || result.TokenCountSource != TokenCountSourceMissing {
		t.Fatalf("unexpected missing usage result: %+v", result)
	}
}

func TestCalculatorDoesNotPriceTotalOnlyUsage(t *testing.T) {
	catalog := &fakePricingCatalog{rule: PricingRule{
		ID:                        "price_total_only_should_not_be_used",
		Provider:                  "openai-main",
		Model:                     "gpt-4o-mini",
		Currency:                  "USD",
		InputMicroUSDPer1MTokens:  150_000,
		OutputMicroUSDPer1MTokens: 600_000,
	}}
	calculator := NewCalculator(catalog)

	result, err := calculator.Calculate(context.Background(), Request{
		ProviderKeys: []string{"openai-main"},
		ModelKeys:    []string{"gpt-4o-mini"},
		TotalTokens:  42,
	})
	if err != nil {
		t.Fatalf("Calculate returned error: %v", err)
	}
	if result.CostMicroUSD != 0 || result.CostSource != CostSourceProviderUsageMissing || result.TokenCountSource != TokenCountSourceMissing {
		t.Fatalf("total-only usage must not be priced as a silent zero: %+v", result)
	}
	if catalog.calls != 0 {
		t.Fatalf("pricing catalog should not be queried without split usage tokens, got %d calls", catalog.calls)
	}
}
func TestCalculatorSurfacesPricingErrors(t *testing.T) {
	calculator := NewCalculator(&fakePricingCatalog{err: errors.New("database unavailable")})

	result, err := calculator.Calculate(context.Background(), Request{
		ProviderKeys:     []string{"openai-main"},
		ModelKeys:        []string{"gpt-4o"},
		PromptTokens:     1,
		CompletionTokens: 1,
		TotalTokens:      2,
	})
	if err == nil {
		t.Fatalf("expected pricing error")
	}
	if result.CostSource != CostSourcePricingError {
		t.Fatalf("unexpected error cost source: %+v", result)
	}
}

func TestCalculateMicroUSDRoundsHalfUpOnce(t *testing.T) {
	cost := CalculateMicroUSD(2, 3, 150_000, 600_000)
	if cost != 2 {
		t.Fatalf("unexpected rounded cost: got %d", cost)
	}
}

type fakePricingCatalog struct {
	rule   PricingRule
	calls  int
	err    error
	lookup PricingLookup
}

func (c *fakePricingCatalog) LookupPricingRule(ctx context.Context, lookup PricingLookup) (PricingRule, error) {
	if err := ctx.Err(); err != nil {
		return PricingRule{}, err
	}
	c.calls++
	c.lookup = lookup
	if c.err != nil {
		return PricingRule{}, c.err
	}
	return c.rule, nil
}
