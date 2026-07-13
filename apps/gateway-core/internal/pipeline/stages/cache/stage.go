package cache

import (
	"context"
	"errors"
	"strings"
)

const (
	StageName = "exact_cache_lookup"

	CacheStatusHit          = "hit"
	CacheStatusMiss         = "miss"
	CacheStatusBypass       = "bypass"
	CacheStatusError        = "error"
	CacheStatusStoreSkipped = "store_skipped"

	CacheTypeNone     = "none"
	CacheTypeExact    = "exact"
	CacheTypeSemantic = "semantic"

	MaskingActionBlocked = "blocked"
)

type Request struct {
	TenantID                 string
	ProjectID                string
	ApplicationID            string
	Provider                 string
	Model                    string
	SecurityPolicyVersionID  string
	RoutingPolicyVersionID   string
	CachePolicyHash          string
	NormalizedRedactedPrompt string
	RequestParamsHash        string
	MaskingAction            string
}

type Result struct {
	Hit               bool
	CacheStatus       string
	CacheType         string
	CacheKeyHash      string
	CacheHitRequestID string
	SavedCostMicroUSD int64
	Payload           []byte
}

type KeyBuilder interface {
	BuildExactCacheKey(ctx context.Context, req Request) (string, error)
}

type Store interface {
	GetExact(ctx context.Context, keyHash string) (LookupResult, error)
}

// LookupResult is an alias so future ports.CacheStore adapters can share this
// method signature without introducing a distinct named return type.
type LookupResult = struct {
	Hit               bool
	CacheHitRequestID string
	SavedCostMicroUSD int64
	Payload           []byte
}

type Stage struct {
	keyBuilder KeyBuilder
	store      Store
}

func NewStage(keyBuilder KeyBuilder, store Store) *Stage {
	return &Stage{
		keyBuilder: keyBuilder,
		store:      store,
	}
}

func (s *Stage) Name() string {
	return StageName
}

func (s *Stage) Execute(ctx context.Context, req Request) (Result, error) {
	if req.MaskingAction == MaskingActionBlocked {
		return Result{
			CacheStatus: CacheStatusBypass,
			CacheType:   CacheTypeNone,
		}, nil
	}
	if strings.TrimSpace(req.CachePolicyHash) == "" {
		return Result{
			CacheStatus: CacheStatusBypass,
			CacheType:   CacheTypeNone,
		}, nil
	}

	if s == nil || s.keyBuilder == nil {
		return Result{}, errors.New("cache stage requires a key builder")
	}
	if s.store == nil {
		return Result{}, errors.New("cache stage requires a store")
	}

	keyHash, err := s.keyBuilder.BuildExactCacheKey(ctx, req)
	if err != nil {
		return Result{
			CacheStatus: CacheStatusError,
			CacheType:   CacheTypeExact,
		}, err
	}

	lookup, err := s.store.GetExact(ctx, keyHash)
	if err != nil {
		return Result{
			CacheStatus:  CacheStatusError,
			CacheType:    CacheTypeExact,
			CacheKeyHash: keyHash,
		}, err
	}

	if lookup.Hit {
		return Result{
			Hit:               true,
			CacheStatus:       CacheStatusHit,
			CacheType:         CacheTypeExact,
			CacheKeyHash:      keyHash,
			CacheHitRequestID: lookup.CacheHitRequestID,
			SavedCostMicroUSD: lookup.SavedCostMicroUSD,
			Payload:           lookup.Payload,
		}, nil
	}

	return Result{
		CacheStatus:  CacheStatusMiss,
		CacheType:    CacheTypeExact,
		CacheKeyHash: keyHash,
	}, nil
}
