package costing

import (
	"context"
	"errors"
	"strings"
	"time"
)

const (
	CurrencyUSD = "USD"

	TokenCountSourceProviderUsage = "provider_usage"
	TokenCountSourceMissing       = "missing"

	CostSourcePricingCatalog       = "pricing_catalog"
	CostSourcePricingMissing       = "pricing_missing"
	CostSourcePricingUnavailable   = "pricing_unavailable"
	CostSourcePricingError         = "pricing_error"
	CostSourceProviderUsageMissing = "provider_usage_missing"
)

var ErrPricingRuleNotFound = errors.New("pricing rule not found")

type PricingCatalog interface {
	LookupPricingRule(ctx context.Context, lookup PricingLookup) (PricingRule, error)
}

type PricingLookup struct {
	ProviderKeys []string
	ModelKeys    []string
	EffectiveAt  time.Time
}

type PricingRule struct {
	ID                        string
	Provider                  string
	Model                     string
	Currency                  string
	InputMicroUSDPer1MTokens  int64
	OutputMicroUSDPer1MTokens int64
	PricingVersion            string
	EffectiveFrom             time.Time
	EffectiveTo               *time.Time
	Source                    string
}

type Calculator struct {
	catalog PricingCatalog
	now     func() time.Time
}

func NewCalculator(catalog PricingCatalog) *Calculator {
	return &Calculator{
		catalog: catalog,
		now:     time.Now,
	}
}

type Request struct {
	ProviderKeys     []string
	ModelKeys        []string
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
	CompletedAt      time.Time
}

type Result struct {
	CostMicroUSD              int64  `json:"costMicroUsd"`
	Currency                  string `json:"currency"`
	PricingRuleID             string `json:"pricingRuleId,omitempty"`
	PricingVersion            string `json:"pricingVersion,omitempty"`
	PricingProvider           string `json:"pricingProvider,omitempty"`
	PricingModel              string `json:"pricingModel,omitempty"`
	InputMicroUSDPer1MTokens  int64  `json:"inputMicroUsdPer1MTokens,omitempty"`
	OutputMicroUSDPer1MTokens int64  `json:"outputMicroUsdPer1MTokens,omitempty"`
	TokenCountSource          string `json:"tokenCountSource"`
	CostSource                string `json:"costSource"`
	PromptTokens              int    `json:"promptTokens"`
	CompletionTokens          int    `json:"completionTokens"`
	TotalTokens               int    `json:"totalTokens"`
	Source                    string `json:"source,omitempty"`
}

func (r Result) HasMetadata() bool {
	return strings.TrimSpace(r.CostSource) != "" || strings.TrimSpace(r.TokenCountSource) != "" || r.CostMicroUSD > 0
}

func (r Result) Metadata() map[string]any {
	if !r.HasMetadata() {
		return nil
	}
	metadata := map[string]any{
		"schemaVersion":    1,
		"costMicroUsd":     r.CostMicroUSD,
		"currency":         firstNonEmpty(r.Currency, CurrencyUSD),
		"tokenCountSource": strings.TrimSpace(r.TokenCountSource),
		"costSource":       strings.TrimSpace(r.CostSource),
		"promptTokens":     r.PromptTokens,
		"completionTokens": r.CompletionTokens,
		"totalTokens":      r.TotalTokens,
	}
	if value := strings.TrimSpace(r.PricingRuleID); value != "" {
		metadata["pricingRuleId"] = value
	}
	if value := strings.TrimSpace(r.PricingVersion); value != "" {
		metadata["pricingVersion"] = value
	}
	if value := strings.TrimSpace(r.PricingProvider); value != "" {
		metadata["pricingProvider"] = value
	}
	if value := strings.TrimSpace(r.PricingModel); value != "" {
		metadata["pricingModel"] = value
	}
	if r.InputMicroUSDPer1MTokens > 0 {
		metadata["inputMicroUsdPer1MTokens"] = r.InputMicroUSDPer1MTokens
	}
	if r.OutputMicroUSDPer1MTokens > 0 {
		metadata["outputMicroUsdPer1MTokens"] = r.OutputMicroUSDPer1MTokens
	}
	if value := strings.TrimSpace(r.Source); value != "" {
		metadata["source"] = value
	}
	return metadata
}

func (c *Calculator) Calculate(ctx context.Context, req Request) (Result, error) {
	result := baseResult(req)
	if result.PromptTokens <= 0 && result.CompletionTokens <= 0 {
		result.TokenCountSource = TokenCountSourceMissing
		result.CostSource = CostSourceProviderUsageMissing
		return result, nil
	}
	result.TokenCountSource = TokenCountSourceProviderUsage

	if c == nil || c.catalog == nil {
		result.CostSource = CostSourcePricingUnavailable
		return result, nil
	}

	lookup := PricingLookup{
		ProviderKeys: normalizeKeys(req.ProviderKeys),
		ModelKeys:    normalizeKeys(req.ModelKeys),
		EffectiveAt:  req.CompletedAt,
	}
	if lookup.EffectiveAt.IsZero() {
		if c.now != nil {
			lookup.EffectiveAt = c.now()
		} else {
			lookup.EffectiveAt = time.Now()
		}
	}

	rule, err := c.catalog.LookupPricingRule(ctx, lookup)
	if errors.Is(err, ErrPricingRuleNotFound) {
		result.CostSource = CostSourcePricingMissing
		return result, nil
	}
	if err != nil {
		result.CostSource = CostSourcePricingError
		return result, err
	}

	rule = normalizeRule(rule)
	result.CostMicroUSD = CalculateMicroUSD(
		result.PromptTokens,
		result.CompletionTokens,
		rule.InputMicroUSDPer1MTokens,
		rule.OutputMicroUSDPer1MTokens,
	)
	result.Currency = firstNonEmpty(rule.Currency, CurrencyUSD)
	result.PricingRuleID = rule.ID
	result.PricingVersion = rule.PricingVersion
	result.PricingProvider = rule.Provider
	result.PricingModel = rule.Model
	result.InputMicroUSDPer1MTokens = rule.InputMicroUSDPer1MTokens
	result.OutputMicroUSDPer1MTokens = rule.OutputMicroUSDPer1MTokens
	result.CostSource = CostSourcePricingCatalog
	result.Source = rule.Source
	return result, nil
}

func CalculateMicroUSD(promptTokens int, completionTokens int, inputMicroUSDPer1MTokens int64, outputMicroUSDPer1MTokens int64) int64 {
	if promptTokens < 0 {
		promptTokens = 0
	}
	if completionTokens < 0 {
		completionTokens = 0
	}
	if inputMicroUSDPer1MTokens < 0 {
		inputMicroUSDPer1MTokens = 0
	}
	if outputMicroUSDPer1MTokens < 0 {
		outputMicroUSDPer1MTokens = 0
	}

	numerator := int64(promptTokens)*inputMicroUSDPer1MTokens + int64(completionTokens)*outputMicroUSDPer1MTokens
	if numerator <= 0 {
		return 0
	}
	return (numerator + 500_000) / 1_000_000
}

func baseResult(req Request) Result {
	promptTokens := nonNegativeInt(req.PromptTokens)
	completionTokens := nonNegativeInt(req.CompletionTokens)
	totalTokens := nonNegativeInt(req.TotalTokens)
	if totalTokens <= 0 {
		totalTokens = promptTokens + completionTokens
	}
	return Result{
		Currency:         CurrencyUSD,
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		TotalTokens:      totalTokens,
	}
}

func nonNegativeInt(value int) int {
	if value < 0 {
		return 0
	}
	return value
}

func normalizeRule(rule PricingRule) PricingRule {
	rule.ID = strings.TrimSpace(rule.ID)
	rule.Provider = strings.TrimSpace(rule.Provider)
	rule.Model = strings.TrimSpace(rule.Model)
	rule.Currency = strings.TrimSpace(rule.Currency)
	rule.PricingVersion = strings.TrimSpace(rule.PricingVersion)
	rule.Source = strings.TrimSpace(rule.Source)
	return rule
}

func normalizeKeys(keys []string) []string {
	seen := map[string]struct{}{}
	normalized := make([]string, 0, len(keys))
	for _, key := range keys {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, key)
	}
	return normalized
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
