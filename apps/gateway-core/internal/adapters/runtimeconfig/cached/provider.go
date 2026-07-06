package cached

import (
	"context"
	"strings"
	"sync"
	"time"

	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
)

const (
	DefaultFreshTTL = 5 * time.Second
	DefaultStaleTTL = 60 * time.Second
)

type Config struct {
	FreshTTL time.Duration
	StaleTTL time.Duration
	Now      func() time.Time
}

type Provider struct {
	delegate runtimeconfig.SnapshotProvider
	freshTTL time.Duration
	staleTTL time.Duration
	now      func() time.Time

	mu      sync.Mutex
	entries map[lookupKey]entry
	flights map[lookupKey]*flight
}

type lookupKey struct {
	tenantID      string
	projectID     string
	applicationID string
}

type entry struct {
	snapshot   runtimeconfig.ExecutionSnapshot
	freshUntil time.Time
	staleUntil time.Time
}

type flight struct {
	done     chan struct{}
	snapshot runtimeconfig.ExecutionSnapshot
	err      error
}

func NewProvider(delegate runtimeconfig.SnapshotProvider, cfg Config) *Provider {
	freshTTL := cfg.FreshTTL
	if freshTTL <= 0 {
		freshTTL = DefaultFreshTTL
	}
	staleTTL := cfg.StaleTTL
	if staleTTL == 0 {
		staleTTL = DefaultStaleTTL
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &Provider{
		delegate: delegate,
		freshTTL: freshTTL,
		staleTTL: staleTTL,
		now:      now,
		entries:  map[lookupKey]entry{},
		flights:  map[lookupKey]*flight{},
	}
}

func (p *Provider) GetExecutionSnapshot(ctx context.Context, tenantID string, projectID string, applicationID string) (runtimeconfig.ExecutionSnapshot, error) {
	if p == nil || p.delegate == nil {
		return runtimeconfig.ExecutionSnapshot{}, runtimeconfig.ErrInactiveConfig
	}
	key := lookupKey{
		tenantID:      strings.TrimSpace(tenantID),
		projectID:     strings.TrimSpace(projectID),
		applicationID: strings.TrimSpace(applicationID),
	}
	if key.tenantID == "" || key.projectID == "" || key.applicationID == "" {
		return runtimeconfig.ExecutionSnapshot{}, runtimeconfig.ErrMissingScope
	}

	now := p.now().UTC()
	p.mu.Lock()
	if cached, ok := p.entries[key]; ok {
		if now.Before(cached.freshUntil) {
			snapshot := cached.snapshot
			p.mu.Unlock()
			return snapshot, nil
		}
		if p.isStaleUsable(cached, now) {
			if _, refreshing := p.flights[key]; !refreshing {
				f := &flight{done: make(chan struct{})}
				p.flights[key] = f
				go p.refresh(context.Background(), key, f)
			}
			snapshot := staleSnapshot(cached.snapshot)
			p.mu.Unlock()
			return snapshot, nil
		}
	}

	if f, ok := p.flights[key]; ok {
		p.mu.Unlock()
		return waitForFlight(ctx, f)
	}

	f := &flight{done: make(chan struct{})}
	p.flights[key] = f
	p.mu.Unlock()

	go p.refresh(context.Background(), key, f)
	return waitForFlight(ctx, f)
}

func (p *Provider) isStaleUsable(cached entry, now time.Time) bool {
	return p.staleTTL > 0 && now.Before(cached.staleUntil)
}

func (p *Provider) refresh(ctx context.Context, key lookupKey, f *flight) {
	snapshot, err := p.delegate.GetExecutionSnapshot(ctx, key.tenantID, key.projectID, key.applicationID)
	now := p.now().UTC()

	p.mu.Lock()
	if err == nil {
		p.entries[key] = entry{
			snapshot:   snapshot,
			freshUntil: now.Add(p.freshTTL),
			staleUntil: now.Add(p.freshTTL + p.staleTTL),
		}
		f.snapshot = snapshot
	} else {
		f.err = err
	}
	delete(p.flights, key)
	close(f.done)
	p.mu.Unlock()
}

func waitForFlight(ctx context.Context, f *flight) (runtimeconfig.ExecutionSnapshot, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-f.done:
		return f.snapshot, f.err
	case <-ctx.Done():
		return runtimeconfig.ExecutionSnapshot{}, ctx.Err()
	}
}

func staleSnapshot(snapshot runtimeconfig.ExecutionSnapshot) runtimeconfig.ExecutionSnapshot {
	snapshot.Snapshot.RuntimeState = runtimeconfig.RuntimeStateStaleSnapshotUsed
	return snapshot
}
