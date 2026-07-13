package cached

import (
	"context"
	"errors"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/costing"
)

func TestReaderCachesEffectivePricingRule(t *testing.T) {
	now := time.Date(2026, 7, 12, 0, 0, 0, 0, time.UTC)
	delegate := &fakePricingCatalog{rule: pricingRule(now.Add(-time.Hour), nil)}
	reader := NewReader(delegate, Config{
		Enabled:    true,
		TTL:        time.Minute,
		MaxEntries: 2,
		Now:        func() time.Time { return now },
	})
	lookup := pricingLookup(now)

	for range 2 {
		rule, err := reader.LookupPricingRule(context.Background(), lookup)
		if err != nil || rule.ID != "pricing-rule-id" {
			t.Fatalf("lookup cached pricing rule: rule=%+v err=%v", rule, err)
		}
	}
	if delegate.calls != 1 {
		t.Fatalf("expected one delegate pricing lookup, got %d", delegate.calls)
	}
}

func TestReaderExpiresPricingRule(t *testing.T) {
	now := time.Date(2026, 7, 12, 0, 0, 0, 0, time.UTC)
	delegate := &fakePricingCatalog{rule: pricingRule(now.Add(-time.Hour), nil)}
	reader := NewReader(delegate, Config{
		Enabled:    true,
		TTL:        time.Second,
		MaxEntries: 2,
		Now:        func() time.Time { return now },
	})

	if _, err := reader.LookupPricingRule(context.Background(), pricingLookup(now)); err != nil {
		t.Fatalf("initial pricing lookup: %v", err)
	}
	now = now.Add(time.Second)
	if _, err := reader.LookupPricingRule(context.Background(), pricingLookup(now)); err != nil {
		t.Fatalf("expired pricing lookup: %v", err)
	}
	if delegate.calls != 2 {
		t.Fatalf("expected TTL expiry to requery pricing, got %d calls", delegate.calls)
	}
}

func TestReaderRequeriesOutsideRuleEffectiveWindow(t *testing.T) {
	now := time.Date(2026, 7, 12, 0, 0, 0, 0, time.UTC)
	effectiveTo := now.Add(time.Second)
	delegate := &fakePricingCatalog{rule: pricingRule(now.Add(-time.Hour), &effectiveTo)}
	reader := NewReader(delegate, Config{
		Enabled:    true,
		TTL:        time.Minute,
		MaxEntries: 2,
		Now:        func() time.Time { return now },
	})

	if _, err := reader.LookupPricingRule(context.Background(), pricingLookup(now)); err != nil {
		t.Fatalf("initial pricing lookup: %v", err)
	}
	now = effectiveTo
	if _, err := reader.LookupPricingRule(context.Background(), pricingLookup(now)); err != nil {
		t.Fatalf("pricing lookup outside effective window: %v", err)
	}
	if delegate.calls != 2 {
		t.Fatalf("expected effective-window miss to requery, got %d calls", delegate.calls)
	}
}

func TestReaderDoesNotCachePricingErrors(t *testing.T) {
	delegate := &fakePricingCatalog{err: errors.New("database unavailable")}
	reader := NewReader(delegate, Config{Enabled: true, TTL: time.Minute, MaxEntries: 2})

	for range 2 {
		if _, err := reader.LookupPricingRule(context.Background(), pricingLookup(time.Now())); err == nil {
			t.Fatal("expected pricing lookup error")
		}
	}
	if delegate.calls != 2 {
		t.Fatalf("pricing errors must not be cached, got %d delegate calls", delegate.calls)
	}
}

func TestReaderBoundsCacheEntries(t *testing.T) {
	now := time.Date(2026, 7, 12, 0, 0, 0, 0, time.UTC)
	delegate := &fakePricingCatalog{rule: pricingRule(now.Add(-time.Hour), nil)}
	reader := NewReader(delegate, Config{
		Enabled:    true,
		TTL:        time.Minute,
		MaxEntries: 1,
		Now:        func() time.Time { return now },
	})

	if _, err := reader.LookupPricingRule(context.Background(), pricingLookup(now)); err != nil {
		t.Fatalf("first pricing lookup: %v", err)
	}
	second := pricingLookup(now)
	second.ModelKeys = []string{"mock-smart"}
	if _, err := reader.LookupPricingRule(context.Background(), second); err != nil {
		t.Fatalf("second pricing lookup: %v", err)
	}
	if reader.order.Len() != 1 {
		t.Fatalf("expected bounded pricing cache, got %d entries", reader.order.Len())
	}
}

func pricingLookup(effectiveAt time.Time) costing.PricingLookup {
	return costing.PricingLookup{
		ProviderKeys: []string{"mock"},
		ModelKeys:    []string{"mock-fast"},
		EffectiveAt:  effectiveAt,
	}
}

func pricingRule(effectiveFrom time.Time, effectiveTo *time.Time) costing.PricingRule {
	return costing.PricingRule{
		ID:                        "pricing-rule-id",
		Provider:                  "mock",
		Model:                     "mock-fast",
		Currency:                  costing.CurrencyUSD,
		InputMicroUSDPer1MTokens:  1,
		OutputMicroUSDPer1MTokens: 2,
		PricingVersion:            "v1",
		EffectiveFrom:             effectiveFrom,
		EffectiveTo:               effectiveTo,
	}
}

type fakePricingCatalog struct {
	rule  costing.PricingRule
	err   error
	calls int
}

func (c *fakePricingCatalog) LookupPricingRule(context.Context, costing.PricingLookup) (costing.PricingRule, error) {
	c.calls++
	return c.rule, c.err
}
