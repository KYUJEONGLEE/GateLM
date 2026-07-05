package postgres

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/costing"

	"github.com/jackc/pgx/v5"
)

type Queryer interface {
	QueryRow(ctx context.Context, sql string, arguments ...any) pgx.Row
}

type Reader struct {
	db Queryer
}

func NewReader(db Queryer) *Reader {
	return &Reader{db: db}
}

func (r *Reader) LookupPricingRule(ctx context.Context, lookup costing.PricingLookup) (costing.PricingRule, error) {
	if err := ctx.Err(); err != nil {
		return costing.PricingRule{}, err
	}
	providerKeys := normalizeKeys(lookup.ProviderKeys)
	modelKeys := normalizeKeys(lookup.ModelKeys)
	if r == nil || r.db == nil || len(providerKeys) == 0 || len(modelKeys) == 0 {
		return costing.PricingRule{}, costing.ErrPricingRuleNotFound
	}
	effectiveAt := lookup.EffectiveAt
	if effectiveAt.IsZero() {
		effectiveAt = time.Now().UTC()
	}

	var rule costing.PricingRule
	var effectiveTo sql.NullTime
	err := r.db.QueryRow(ctx, lookupPricingRuleSQL,
		providerKeys,
		modelKeys,
		effectiveAt.UTC(),
	).Scan(
		&rule.ID,
		&rule.Provider,
		&rule.Model,
		&rule.Currency,
		&rule.InputMicroUSDPer1MTokens,
		&rule.OutputMicroUSDPer1MTokens,
		&rule.PricingVersion,
		&rule.EffectiveFrom,
		&effectiveTo,
		&rule.Source,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return costing.PricingRule{}, costing.ErrPricingRuleNotFound
		}
		return costing.PricingRule{}, err
	}
	if effectiveTo.Valid {
		rule.EffectiveTo = &effectiveTo.Time
	}
	return rule, nil
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

const lookupPricingRuleSQL = `
select
  id::text,
  provider,
  model,
  currency,
  input_micro_usd_per_1m_tokens,
  output_micro_usd_per_1m_tokens,
  pricing_version,
  effective_from,
  effective_to,
  coalesce(source, '')
from model_pricing_rules
where provider = any($1::text[])
  and model = any($2::text[])
  and effective_from <= $3::timestamptz
  and (effective_to is null or effective_to > $3::timestamptz)
order by effective_from desc, created_at desc
limit 1`
