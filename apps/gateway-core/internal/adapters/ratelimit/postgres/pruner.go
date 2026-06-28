package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

const (
	DefaultCounterRetention = 24 * time.Hour
	DefaultPruneBatchSize   = 1000
)

var ErrMissingPrunerStore = errors.New("rate limit counter pruner requires a database executor")

type Executor interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

type CounterPruner struct {
	db Executor
}

type PruneRequest struct {
	Retention time.Duration
	BatchSize int
	Now       time.Time
}

type PruneResult struct {
	Deleted   int64
	Cutoff    time.Time
	Retention time.Duration
	BatchSize int
}

func NewCounterPruner(db Executor) *CounterPruner {
	return &CounterPruner{db: db}
}

func (p *CounterPruner) Prune(ctx context.Context, req PruneRequest) (PruneResult, error) {
	retention := req.Retention
	if retention <= 0 {
		retention = DefaultCounterRetention
	}
	batchSize := req.BatchSize
	if batchSize <= 0 {
		batchSize = DefaultPruneBatchSize
	}
	now := req.Now
	if now.IsZero() {
		now = time.Now().UTC()
	} else {
		now = now.UTC()
	}
	result := PruneResult{
		Cutoff:    now.Add(-retention),
		Retention: retention,
		BatchSize: batchSize,
	}

	if p == nil || p.db == nil {
		return result, ErrMissingPrunerStore
	}

	tag, err := p.db.Exec(ctx, pruneExpiredCountersSQL, result.Cutoff, batchSize)
	if err != nil {
		return result, fmt.Errorf("prune postgres rate limit counters: %w", err)
	}

	result.Deleted = tag.RowsAffected()
	return result, nil
}

const pruneExpiredCountersSQL = `
with expired as (
  select tenant_id, application_id, window_start
  from gateway_rate_limit_counters
  where updated_at < $1::timestamptz
  order by updated_at asc
  limit $2::int
)
delete from gateway_rate_limit_counters counters
using expired
where counters.tenant_id = expired.tenant_id
  and counters.application_id = expired.application_id
  and counters.window_start = expired.window_start`
