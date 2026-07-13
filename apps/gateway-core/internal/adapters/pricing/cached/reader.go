package cached

import (
	"container/list"
	"context"
	"strconv"
	"strings"
	"sync"
	"time"

	"gatelm/apps/gateway-core/internal/domain/costing"
)

type Config struct {
	Enabled    bool
	TTL        time.Duration
	MaxEntries int
	Now        func() time.Time
}

type Reader struct {
	delegate   costing.PricingCatalog
	enabled    bool
	ttl        time.Duration
	maxEntries int
	now        func() time.Time
	mu         sync.Mutex
	items      map[string]*list.Element
	order      *list.List
}

type cacheEntry struct {
	key       string
	rule      costing.PricingRule
	expiresAt time.Time
}

func NewReader(delegate costing.PricingCatalog, cfg Config) *Reader {
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &Reader{
		delegate:   delegate,
		enabled:    cfg.Enabled && cfg.TTL > 0 && cfg.MaxEntries > 0,
		ttl:        cfg.TTL,
		maxEntries: cfg.MaxEntries,
		now:        now,
		items:      make(map[string]*list.Element),
		order:      list.New(),
	}
}

func (r *Reader) LookupPricingRule(ctx context.Context, lookup costing.PricingLookup) (costing.PricingRule, error) {
	if err := ctx.Err(); err != nil {
		return costing.PricingRule{}, err
	}
	if r == nil || r.delegate == nil {
		return costing.PricingRule{}, costing.ErrPricingRuleNotFound
	}
	if !r.enabled {
		return r.delegate.LookupPricingRule(ctx, lookup)
	}

	effectiveAt := lookup.EffectiveAt
	if effectiveAt.IsZero() {
		effectiveAt = r.now().UTC()
	}
	key := pricingCacheKey(lookup)
	if key != "" {
		if rule, ok := r.get(key, effectiveAt, r.now()); ok {
			return rule, nil
		}
	}

	rule, err := r.delegate.LookupPricingRule(ctx, lookup)
	if err != nil {
		return costing.PricingRule{}, err
	}
	if key != "" && ruleEffectiveAt(rule, effectiveAt) {
		r.put(key, rule, r.now())
	}
	return rule, nil
}

func (r *Reader) get(key string, effectiveAt time.Time, now time.Time) (costing.PricingRule, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	element := r.items[key]
	if element == nil {
		return costing.PricingRule{}, false
	}
	entry := element.Value.(cacheEntry)
	if !now.Before(entry.expiresAt) || !ruleEffectiveAt(entry.rule, effectiveAt) {
		delete(r.items, key)
		r.order.Remove(element)
		return costing.PricingRule{}, false
	}
	r.order.MoveToFront(element)
	return cloneRule(entry.rule), true
}

func (r *Reader) put(key string, rule costing.PricingRule, now time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	entry := cacheEntry{key: key, rule: cloneRule(rule), expiresAt: now.Add(r.ttl)}
	if element := r.items[key]; element != nil {
		element.Value = entry
		r.order.MoveToFront(element)
		return
	}
	element := r.order.PushFront(entry)
	r.items[key] = element
	for r.order.Len() > r.maxEntries {
		oldest := r.order.Back()
		oldestEntry := oldest.Value.(cacheEntry)
		delete(r.items, oldestEntry.key)
		r.order.Remove(oldest)
	}
}

func pricingCacheKey(lookup costing.PricingLookup) string {
	providerKeys := normalizeKeys(lookup.ProviderKeys)
	modelKeys := normalizeKeys(lookup.ModelKeys)
	if len(providerKeys) == 0 || len(modelKeys) == 0 {
		return ""
	}
	return encodeKeys(providerKeys) + "|" + encodeKeys(modelKeys)
}

func encodeKeys(keys []string) string {
	var builder strings.Builder
	for _, key := range keys {
		builder.WriteString(strconv.Itoa(len(key)))
		builder.WriteByte(':')
		builder.WriteString(key)
		builder.WriteByte(';')
	}
	return builder.String()
}

func normalizeKeys(keys []string) []string {
	seen := make(map[string]struct{}, len(keys))
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

func ruleEffectiveAt(rule costing.PricingRule, at time.Time) bool {
	at = at.UTC()
	if !rule.EffectiveFrom.IsZero() && at.Before(rule.EffectiveFrom.UTC()) {
		return false
	}
	return rule.EffectiveTo == nil || at.Before(rule.EffectiveTo.UTC())
}

func cloneRule(rule costing.PricingRule) costing.PricingRule {
	if rule.EffectiveTo != nil {
		effectiveTo := *rule.EffectiveTo
		rule.EffectiveTo = &effectiveTo
	}
	return rule
}
