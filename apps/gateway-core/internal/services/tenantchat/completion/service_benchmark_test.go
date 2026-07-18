package completion

import (
	"context"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

func BenchmarkServiceDeterministicPrivateExecution(b *testing.B) {
	b.Run("mock_primary", func(b *testing.B) {
		b.ReportAllocs()
		b.RunParallel(func(parallel *testing.PB) {
			for parallel.Next() {
				usage := &fakeUsageAccounting{
					reservation: benchmarkReservation(),
					settlement: tenantchat.UsageSettlement{
						RequestID: "request_completion_001", ReservationID: benchmarkReservation().ReservationID,
						State: "settled", ConfirmedInputTokens: 12, ConfirmedOutputTokens: 5,
						QuotaState: "normal", BudgetState: "normal", LedgerVersion: 2,
					},
				}
				providers := &fakeProviderExecutor{stream: &fakeStream{events: []provider.ChatCompletionStreamEvent{{
					Usage: &provider.Usage{PromptTokens: 12, CompletionTokens: 5, TotalTokens: 17},
				}}}}
				service := New(&fakeSnapshotResolver{snapshot: completionSnapshot()}, usage, providers)
				execution, err := service.Prepare(context.Background(), completionRequest())
				if err == nil {
					err = execution.Relay(context.Background(), func(tenantchat.CompletionEvent) error { return nil })
				}
				if err != nil {
					b.Errorf("mock primary execution: %v", err)
					return
				}
			}
		})
	})

	b.Run("exact_cache_hit", func(b *testing.B) {
		snapshot := completionSnapshot()
		snapshot.Policies.Cache = tenantruntime.CachePolicy{
			Strategy: "exact", Enabled: true, TTLSeconds: 300, MaxEntriesPerUser: 100, KeySetID: "keys_001",
		}
		cache := &fakeExactCache{entry: tenantchat.ExactCacheEntry{
			ResponseText: "synthetic cached response", EffectiveProviderID: "provider-cached",
			EffectiveModelKey: "model-cached", EffectiveRouteTier: "standard", SourceCostMicroUSD: 100,
		}, hit: true}
		b.ReportAllocs()
		b.RunParallel(func(parallel *testing.PB) {
			for parallel.Next() {
				usage := &fakeUsageAccounting{}
				service := New(
					&fakeSnapshotResolver{snapshot: snapshot}, usage, &fakeProviderExecutor{},
					WithExactCache(cache),
				)
				request := completionRequest()
				request.Context.UsageIntent.CacheStrategy = "exact"
				execution, err := service.Prepare(context.Background(), request)
				if err == nil {
					err = execution.Relay(context.Background(), func(tenantchat.CompletionEvent) error { return nil })
				}
				if err != nil {
					b.Errorf("exact cache execution: %v", err)
					return
				}
			}
		})
	})
}

func benchmarkReservation() tenantchat.UsageReservation {
	return tenantchat.UsageReservation{
		ReservationID: "7f88ef2f-975e-4557-bdd5-f7050cd54c15",
		RequestID:     "request_completion_001",
		State:         "reserved",
		QuotaState:    "normal",
		BudgetState:   "normal",
		Route: tenantchat.SelectedRoute{
			RouteID: "route_standard", Tier: "standard", ProviderID: "provider", ModelKey: "model-standard",
		},
	}
}
