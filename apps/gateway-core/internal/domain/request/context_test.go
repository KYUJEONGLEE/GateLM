package request

import "testing"

func TestGatewayContextBypassCacheClearsCacheMetadata(t *testing.T) {
	// Given 이전 stage가 cache metadata를 일부 채워두었다
	gatewayCtx := &GatewayContext{
		Cache: CacheContext{
			CacheStatus:       "hit",
			CacheType:         "exact",
			CacheKeyHash:      "cache_key_hash_demo",
			CacheHitRequestID: "request_previous",
			SavedCostMicroUSD: 1200,
			Payload:           []byte(`{"cached":true}`),
		},
	}

	// When pre-cache terminal outcome이 cache를 우회하도록 표시한다
	gatewayCtx.BypassCache()

	// Then Invocation Log와 response header가 같은 bypass 의미를 볼 수 있다
	if gatewayCtx.Cache.CacheStatus != "bypass" ||
		gatewayCtx.Cache.CacheType != "none" ||
		gatewayCtx.Cache.CacheKeyHash != "" ||
		gatewayCtx.Cache.CacheHitRequestID != "" ||
		gatewayCtx.Cache.SavedCostMicroUSD != 0 ||
		gatewayCtx.Cache.Payload != nil {
		t.Fatalf("unexpected cache bypass metadata: %#v", gatewayCtx.Cache)
	}
}
