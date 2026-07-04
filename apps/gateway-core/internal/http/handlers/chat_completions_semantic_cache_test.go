package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	staticprovidercatalog "gatelm/apps/gateway-core/internal/adapters/providercatalog/static"
	"gatelm/apps/gateway-core/internal/domain/auth"
	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
	"gatelm/apps/gateway-core/internal/domain/request"
	routingdomain "gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/ports"
)

func TestChatCompletionsSemanticCacheDisabledKeepsExistingFlow(t *testing.T) {
	harness := newSemanticCacheHarness(t, false)

	rr := harness.exercise(t, "sc_disabled", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))

	if rr.Code != http.StatusOK {
		t.Fatalf("Semantic Cache disabled 요청은 기존 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.semantic.searchCalls != 0 || harness.semantic.upsertCalls != 0 {
		t.Fatalf("disabled 상태에서는 semantic lookup/store가 없어야 함: search=%d upsert=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls)
	}
	if harness.provider.calls != 1 {
		t.Fatalf("disabled 상태에서는 provider가 호출되어야 함: calls=%d", harness.provider.calls)
	}
}

func TestChatCompletionsSemanticCacheEnabledWithoutServiceNoOps(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)
	harness.handler.SemanticCacheService = nil
	harness.handler.SemanticCacheEnabled = true

	rr := harness.exercise(t, "sc_policy_missing_noop", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))

	if rr.Code != http.StatusOK {
		t.Fatalf("policy/service 없는 semantic cache는 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.semantic.searchCalls != 0 || harness.semantic.upsertCalls != 0 {
		t.Fatalf("service가 없으면 semantic lookup/store가 없어야 함: search=%d upsert=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls)
	}
	if harness.provider.calls != 1 {
		t.Fatalf("semantic no-op이면 provider가 호출되어야 함: calls=%d", harness.provider.calls)
	}
	logged := harness.latestLog(t)
	if logged.SemanticCacheEnabled {
		t.Fatalf("service가 없으면 semantic cache evidence도 disabled로 남아야 함: %+v", logged)
	}
}

func TestChatCompletionsSemanticCacheModeOffBypassesLookupStoreAndHit(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)
	harness.handler.SemanticCacheMode = cachekey.SemanticCacheModeOff

	rr := harness.exercise(t, "sc_mode_off", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))

	if rr.Code != http.StatusOK {
		t.Fatalf("mode=off 요청은 기존 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.semantic.searchCalls != 0 || harness.semantic.upsertCalls != 0 {
		t.Fatalf("mode=off에서는 semantic lookup/store가 없어야 함: search=%d upsert=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls)
	}
	if harness.classifier.calls != 0 {
		t.Fatalf("mode=off cheap deny에서는 classifier 호출도 없어야 함: calls=%d", harness.classifier.calls)
	}
	if harness.provider.calls != 1 {
		t.Fatalf("mode=off에서는 provider가 호출되어야 함: calls=%d", harness.provider.calls)
	}
	logged := harness.latestLog(t)
	if logged.SemanticCacheDecisionReason != cachekey.SemanticCacheReasonModeOff {
		t.Fatalf("mode=off reason 불일치: %q", logged.SemanticCacheDecisionReason)
	}
	if logged.Metadata["semanticCacheMode"] != cachekey.SemanticCacheModeOff || logged.Metadata["semanticReturnedFromCache"] != false {
		t.Fatalf("mode=off safe metadata 불일치: %+v", logged.Metadata)
	}
}

func TestChatCompletionsSemanticCacheDefaultModeEnforceKeepsHitPath(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)
	harness.handler.SemanticCacheMode = ""

	harness.exercise(t, "sc_default_enforce_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
	second := harness.exercise(t, "sc_default_enforce_second", routingAwareChatBody("auto", "패스워드 초기화는 어떻게 해?"))

	if second.Code != http.StatusOK {
		t.Fatalf("기본 mode=enforce hit 요청은 성공해야 함: status=%d body=%s", second.Code, second.Body.String())
	}
	if harness.provider.calls != 1 {
		t.Fatalf("기본 mode=enforce는 기존 semantic hit path를 유지해야 함: calls=%d", harness.provider.calls)
	}
	assertGateLMResponseDoesNotExposeSemanticCache(t, second)
	resp := decodeSemanticChatResponse(t, second)
	if resp.GateLM == nil || resp.GateLM.CacheType != invocationlog.CacheTypeSemantic || resp.GateLM.ProviderCalled {
		t.Fatalf("기본 enforce semantic hit response metadata 불일치: %+v", resp.GateLM)
	}
	logged := harness.latestLog(t)
	if !logged.SemanticCacheHit || !logged.SemanticReturnedFromCache || logged.SemanticCacheDecisionReason != cachekey.SemanticCacheReasonHit {
		t.Fatalf("기본 enforce semantic hit evidence log 불일치: %+v", logged)
	}
}

func TestChatCompletionsSemanticCacheShadowWouldHitDoesNotReturnCachedResponse(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)

	first := harness.exercise(t, "sc_shadow_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
	if first.Code != http.StatusOK {
		t.Fatalf("shadow 준비용 첫 요청은 성공해야 함: status=%d body=%s", first.Code, first.Body.String())
	}
	harness.semantic.resetCounts()
	harness.handler.SemanticCacheMode = cachekey.SemanticCacheModeShadow

	second := harness.exercise(t, "sc_shadow_second", routingAwareChatBody("auto", "패스워드 초기화는 어떻게 해?"))

	if second.Code != http.StatusOK {
		t.Fatalf("shadow would hit 요청은 provider flow로 성공해야 함: status=%d body=%s", second.Code, second.Body.String())
	}
	if harness.semantic.searchCalls != 1 || harness.semantic.upsertCalls != 0 {
		t.Fatalf("shadow wouldHit은 lookup만 하고 store/hit 반환은 없어야 함: search=%d upsert=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls)
	}
	if harness.provider.calls != 2 {
		t.Fatalf("shadow wouldHit이어도 provider가 호출되어야 함: calls=%d", harness.provider.calls)
	}
	assertGateLMResponseDoesNotExposeSemanticCache(t, second)
	resp := decodeSemanticChatResponse(t, second)
	if resp.GateLM == nil || !resp.GateLM.ProviderCalled {
		t.Fatalf("shadow response metadata 불일치: %+v", resp.GateLM)
	}
	logged := harness.latestLog(t)
	if logged.SemanticCacheHit ||
		!logged.SemanticCacheWouldHit ||
		logged.SemanticReturnedFromCache ||
		logged.SemanticCacheDecisionReason != cachekey.SemanticCacheReasonShadowWouldHit {
		t.Fatalf("shadow terminal log semantic flags 불일치: %+v", logged)
	}
	if logged.SemanticMatchedRequestID != "" {
		t.Fatalf("shadow mode에서는 candidate id 원문을 노출하지 않아야 함: %q", logged.SemanticMatchedRequestID)
	}
	if logged.Metadata["semanticCacheMode"] != cachekey.SemanticCacheModeShadow ||
		logged.Metadata["semanticCacheWouldHit"] != true ||
		logged.Metadata["semanticReturnedFromCache"] != false ||
		logged.Metadata["semanticCandidateHash"] == "" ||
		logged.Metadata["semanticCanonicalIntent"] == "" ||
		logged.Metadata["semanticRequiredSlotsHash"] == "" {
		t.Fatalf("shadow safe metadata 불일치: %+v", logged.Metadata)
	}
	logPayload, err := json.Marshal(logged)
	if err != nil {
		t.Fatalf("shadow terminal log marshal 실패: %v", err)
	}
	for _, forbidden := range []string{"비밀번호 재설정 방법 알려줘", "패스워드 초기화는 어떻게 해?", testAPIKey, testAppToken, "Authorization:", "provider raw error"} {
		if strings.Contains(string(logPayload), forbidden) {
			t.Fatalf("shadow log에 forbidden marker가 남으면 안 됨: marker=%q log=%s", forbidden, logPayload)
		}
	}
}

func TestChatCompletionsSemanticCacheFirstRequestMissThenStores(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)

	rr := harness.exercise(t, "sc_first_miss", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))

	if rr.Code != http.StatusOK {
		t.Fatalf("첫 요청은 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.semantic.searchCalls != 1 || harness.semantic.upsertCalls != 1 {
		t.Fatalf("첫 요청은 semantic miss 후 store되어야 함: search=%d upsert=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls)
	}
	if harness.provider.calls != 1 {
		t.Fatalf("첫 요청은 provider 호출이 필요함: calls=%d", harness.provider.calls)
	}
	logged := harness.latestLog(t)
	if logged.CacheType != invocationlog.CacheTypeSemantic || logged.CacheStatus != invocationlog.CacheStatusMiss {
		t.Fatalf("semantic miss가 request log에 남아야 함: cache=%s/%s", logged.CacheStatus, logged.CacheType)
	}
	if logged.SemanticCacheDecisionReason != cachekey.SemanticCacheReasonStored {
		t.Fatalf("provider 성공 후 semantic store reason이 남아야 함: %q", logged.SemanticCacheDecisionReason)
	}
}

func TestChatCompletionsSemanticCacheStoreRequestCarriesStaticCacheabilityClass(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)

	rr := harness.exercise(t, "sc_store_cacheability_static", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))

	if rr.Code != http.StatusOK {
		t.Fatalf("정적 안내 응답은 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.semantic.upsertCalls != 1 || len(harness.semantic.storeRequests) != 1 {
		t.Fatalf("정적 안내 응답은 semantic store 후보로 전달되어야 함: upsert=%d requests=%d", harness.semantic.upsertCalls, len(harness.semantic.storeRequests))
	}
	storeRequest := harness.semantic.storeRequests[0]
	if storeRequest.ResponseCacheabilityClass != cachekey.SemanticCacheResponseCacheabilityStaticGuidance {
		t.Fatalf("정적 안내 응답 cacheability class 불일치: %q", storeRequest.ResponseCacheabilityClass)
	}
	if storeRequest.ProviderOutcome != cachekey.SemanticCacheProviderOutcomeSuccess || storeRequest.FallbackUsed || storeRequest.Stream {
		t.Fatalf("store eligibility material 불일치: %+v", storeRequest)
	}
}

func TestChatCompletionsSemanticCacheDynamicUserStateResponseDoesNotStoreOrHit(t *testing.T) {
	semantic := newCountingSemanticCacheService(t, true)
	adapter := &routingAwareProviderAdapter{
		adapterType:     providercatalog.AdapterTypeMock,
		responseContent: "이번 달 사용량: 12345 tokens",
	}
	harness := newSemanticCacheHarnessWithService(t, semantic, adapter)
	harness.routes["sc_dynamic_usage_first"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategoryGeneral}
	harness.routes["sc_dynamic_usage_second"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategoryGeneral}

	first := harness.exercise(t, "sc_dynamic_usage_first", routingAwareChatBody("auto", "사용량은 어디서 확인해?"))
	if first.Code != http.StatusOK {
		t.Fatalf("동적 사용량 응답도 사용자에게는 성공으로 반환되어야 함: status=%d body=%s", first.Code, first.Body.String())
	}
	if len(semantic.storeRequests) != 1 {
		t.Fatalf("동적 응답도 store eligibility 평가 material은 전달되어야 함: requests=%d", len(semantic.storeRequests))
	}
	if semantic.storeRequests[0].ResponseCacheabilityClass != cachekey.SemanticCacheResponseCacheabilityDynamicUserState {
		t.Fatalf("동적 응답 cacheability class 불일치: %q", semantic.storeRequests[0].ResponseCacheabilityClass)
	}
	if logged := harness.latestLog(t); logged.SemanticCacheDecisionReason != cachekey.SemanticCacheReasonDynamicUserState {
		t.Fatalf("동적 응답은 semantic store에서 bypass되어야 함: reason=%q", logged.SemanticCacheDecisionReason)
	}

	second := harness.exercise(t, "sc_dynamic_usage_second", routingAwareChatBody("auto", "API 사용량 확인 화면은 어디야?"))
	if second.Code != http.StatusOK {
		t.Fatalf("유사한 두 번째 동적 요청도 provider flow로 성공해야 함: status=%d body=%s", second.Code, second.Body.String())
	}
	if adapter.calls != 2 {
		t.Fatalf("동적 응답이 저장되면 두 번째 요청이 semantic hit가 되므로 provider는 다시 호출되어야 함: calls=%d", adapter.calls)
	}
	if logged := harness.latestLog(t); logged.SemanticCacheHit || logged.SemanticReturnedFromCache {
		t.Fatalf("동적 응답은 이후 semantic hit로 재사용되면 안 됨: %+v", logged)
	}
}

func TestChatCompletionsSemanticCacheMissReusesLookupEmbeddingForStore(t *testing.T) {
	embeddingProvider := &countingSemanticEmbeddingProvider{delegate: cachekey.NewFakeEmbeddingProvider("fake-test")}
	semantic := newCountingSemanticCacheServiceWithEmbeddingProvider(t, true, embeddingProvider)
	harness := newSemanticCacheHarnessWithService(t, semantic, &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock})

	rr := harness.exercise(t, "sc_embedding_reuse", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))

	if rr.Code != http.StatusOK {
		t.Fatalf("Semantic Cache miss 후 store 요청은 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if semantic.searchCalls != 1 || semantic.upsertCalls != 1 {
		t.Fatalf("miss 후 lookup/store 호출 수 불일치: search=%d upsert=%d", semantic.searchCalls, semantic.upsertCalls)
	}
	if embeddingProvider.calls != 1 {
		t.Fatalf("lookup에서 만든 embedding vector를 store에 재사용해야 함: embeddingCalls=%d", embeddingProvider.calls)
	}
	if len(semantic.searchResults) != 1 || len(semantic.searchResults[0].QueryVector) == 0 {
		t.Fatalf("lookup miss 결과에는 store 재사용용 query vector가 있어야 함: %+v", semantic.searchResults)
	}
	if len(semantic.storeRequests) != 1 || len(semantic.storeRequests[0].EmbeddingVector) == 0 {
		t.Fatalf("store request에는 재사용 embedding vector가 전달되어야 함: %+v", semantic.storeRequests)
	}
}

func TestChatCompletionsSemanticCacheSimilarSecondRequestHits(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)

	first := harness.exercise(t, "sc_hit_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
	second := harness.exercise(t, "sc_hit_second", routingAwareChatBody("auto", "패스워드 초기화는 어떻게 해?"))

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("두 요청 모두 성공해야 함: first=%d second=%d body=%s", first.Code, second.Code, second.Body.String())
	}
	if harness.provider.calls != 1 {
		t.Fatalf("semantic hit 요청은 provider를 다시 호출하면 안 됨: calls=%d", harness.provider.calls)
	}
	assertGateLMResponseDoesNotExposeSemanticCache(t, second)
	resp := decodeSemanticChatResponse(t, second)
	if resp.GateLM == nil || resp.GateLM.CacheType != invocationlog.CacheTypeSemantic || resp.GateLM.ProviderCalled {
		t.Fatalf("semantic hit response metadata 불일치: %+v", resp.GateLM)
	}
	logged := harness.latestLog(t)
	if logged.CacheType != invocationlog.CacheTypeSemantic ||
		logged.CacheStatus != invocationlog.CacheStatusHit ||
		!logged.SemanticCacheHit ||
		logged.SemanticMatchedRequestID != "sc_hit_first" {
		t.Fatalf("semantic hit가 request log에 남아야 함: %+v", logged)
	}
}

func TestChatCompletionsSemanticCacheThresholdMissCallsProvider(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)

	harness.exercise(t, "sc_threshold_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
	rr := harness.exercise(t, "sc_threshold_second", routingAwareChatBody("auto", "사용량 메뉴 위치 알려줘"))

	if rr.Code != http.StatusOK {
		t.Fatalf("threshold miss 요청은 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.provider.calls != 2 {
		t.Fatalf("threshold 미만이면 provider 호출이 필요함: calls=%d", harness.provider.calls)
	}
	if logged := harness.latestLog(t); logged.SemanticCacheDecisionReason != cachekey.SemanticCacheReasonStored {
		t.Fatalf("miss 후 store reason 불일치: %q", logged.SemanticCacheDecisionReason)
	}
	if harness.semantic.searchResults[1].Reason != cachekey.SemanticCacheReasonThresholdMiss {
		t.Fatalf("lookup miss reason은 threshold_miss여야 함: %+v", harness.semantic.searchResults[1])
	}
}

func TestChatCompletionsSemanticCacheExactHitHasPriority(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)

	first := harness.exercise(t, "sc_exact_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
	harness.semantic.resetCounts()
	harness.classifier.calls = 0
	second := harness.exercise(t, "sc_exact_second", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("두 요청 모두 성공해야 함: first=%d second=%d body=%s", first.Code, second.Code, second.Body.String())
	}
	if harness.semantic.searchCalls != 0 || harness.semantic.upsertCalls != 0 {
		t.Fatalf("exact cache hit이면 semantic lookup/store 금지: search=%d upsert=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls)
	}
	if harness.classifier.calls != 0 {
		t.Fatalf("exact cache hit이면 classifier 호출도 금지: calls=%d", harness.classifier.calls)
	}
	resp := decodeSemanticChatResponse(t, second)
	if resp.GateLM == nil || resp.GateLM.CacheType != invocationlog.CacheTypeExact || resp.GateLM.ProviderCalled {
		t.Fatalf("exact cache hit metadata 불일치: %+v", resp.GateLM)
	}
}

func TestChatCompletionsSemanticCacheClassifierSkipPreventsLookupStoreAndEmbedding(t *testing.T) {
	embeddingProvider := &countingSemanticEmbeddingProvider{delegate: cachekey.NewFakeEmbeddingProvider("fake-test")}
	semantic := newCountingSemanticCacheServiceWithEmbeddingProvider(t, true, embeddingProvider)
	harness := newSemanticCacheHarnessWithService(t, semantic, &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock})
	harness.classifier.result = &cachekey.CacheabilityClassifierResult{
		Label:        cachekey.CacheabilityLabelDynamicUserState,
		Confidence:   0.99,
		ReasonCode:   cachekey.CacheabilityReasonDynamicStub,
		ModelVersion: cachekey.CacheabilityClassifierStubModelVersion,
	}

	rr := harness.exercise(t, "sc_classifier_dynamic_skip", routingAwareChatBody("auto", "내 이번 달 사용량 보여줘"))

	if rr.Code != http.StatusOK {
		t.Fatalf("classifier skip 요청도 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.classifier.calls != 1 {
		t.Fatalf("exact miss 이후 classifier는 1회 호출되어야 함: calls=%d", harness.classifier.calls)
	}
	if semantic.searchCalls != 0 || semantic.upsertCalls != 0 {
		t.Fatalf("dynamic classifier 결과는 semantic lookup/store 금지: search=%d upsert=%d", semantic.searchCalls, semantic.upsertCalls)
	}
	if embeddingProvider.calls != 0 {
		t.Fatalf("classifier skip이면 embedding provider 호출 금지: calls=%d", embeddingProvider.calls)
	}
	if harness.provider.calls != 1 {
		t.Fatalf("classifier skip은 provider execution을 막으면 안 됨: calls=%d", harness.provider.calls)
	}
	logged := harness.latestLog(t)
	if logged.SemanticCacheDecisionReason != cachekey.CacheabilityReasonClassifierNotCacheable || logged.SemanticReturnedFromCache {
		t.Fatalf("classifier skip reason/log 불일치: %+v", logged)
	}
}

func TestChatCompletionsSemanticCacheClassifierLowConfidenceSkipsEmbeddingAndStore(t *testing.T) {
	embeddingProvider := &countingSemanticEmbeddingProvider{delegate: cachekey.NewFakeEmbeddingProvider("fake-test")}
	semantic := newCountingSemanticCacheServiceWithEmbeddingProvider(t, true, embeddingProvider)
	harness := newSemanticCacheHarnessWithService(t, semantic, &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock})
	harness.classifier.result = &cachekey.CacheabilityClassifierResult{
		Label:        cachekey.CacheabilityLabelCacheableStatic,
		Confidence:   0.50,
		ReasonCode:   cachekey.CacheabilityReasonStaticStub,
		ModelVersion: cachekey.CacheabilityClassifierStubModelVersion,
	}

	rr := harness.exercise(t, "sc_classifier_low_confidence", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))

	if rr.Code != http.StatusOK {
		t.Fatalf("low confidence 요청도 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.classifier.calls != 1 {
		t.Fatalf("classifier 호출 수 불일치: %d", harness.classifier.calls)
	}
	if semantic.searchCalls != 0 || semantic.upsertCalls != 0 || embeddingProvider.calls != 0 {
		t.Fatalf("low confidence는 semantic/embedding 모두 skip되어야 함: search=%d upsert=%d embedding=%d", semantic.searchCalls, semantic.upsertCalls, embeddingProvider.calls)
	}
	logged := harness.latestLog(t)
	if logged.SemanticCacheDecisionReason != cachekey.CacheabilityReasonClassifierLowConfidence {
		t.Fatalf("low confidence reason 불일치: %q", logged.SemanticCacheDecisionReason)
	}
}

func TestChatCompletionsSemanticCacheClassifierNoopDisablesSemanticPathOnly(t *testing.T) {
	embeddingProvider := &countingSemanticEmbeddingProvider{delegate: cachekey.NewFakeEmbeddingProvider("fake-test")}
	semantic := newCountingSemanticCacheServiceWithEmbeddingProvider(t, true, embeddingProvider)
	harness := newSemanticCacheHarnessWithService(t, semantic, &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock})
	harness.handler.SemanticCacheClassifier = cachekey.NoopCacheabilityClassifier{}

	rr := harness.exercise(t, "sc_classifier_noop", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))

	if rr.Code != http.StatusOK {
		t.Fatalf("classifier no-op 요청도 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if semantic.searchCalls != 0 || semantic.upsertCalls != 0 || embeddingProvider.calls != 0 {
		t.Fatalf("classifier no-op은 semantic/embedding만 skip해야 함: search=%d upsert=%d embedding=%d", semantic.searchCalls, semantic.upsertCalls, embeddingProvider.calls)
	}
	if harness.provider.calls != 1 {
		t.Fatalf("classifier no-op은 provider execution을 막으면 안 됨: calls=%d", harness.provider.calls)
	}
	if logged := harness.latestLog(t); logged.SemanticCacheDecisionReason != cachekey.CacheabilityReasonClassifierDisabled {
		t.Fatalf("classifier no-op reason 불일치: %q", logged.SemanticCacheDecisionReason)
	}
}

func TestChatCompletionsSemanticCacheFastTextSidecarDemoPairGatesLookup(t *testing.T) {
	embeddingProvider := &countingSemanticEmbeddingProvider{delegate: cachekey.NewFakeEmbeddingProvider("fake-test")}
	semantic := newCountingSemanticCacheServiceWithEmbeddingProvider(t, true, embeddingProvider)
	harness := newSemanticCacheHarnessWithService(t, semantic, &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock})
	classifier, sidecar := newFastTextSidecarClassifierForHandlerTest(t, func(text string) (cachekey.CacheabilityLabel, float64) {
		if strings.Contains(text, "내 이번 달") || strings.Contains(text, "사용량 보여") {
			return cachekey.CacheabilityLabelDynamicUserState, 0.99
		}
		return cachekey.CacheabilityLabelCacheableStatic, 0.96
	})
	harness.handler.SemanticCacheClassifier = classifier

	static := harness.exercise(t, "sc_fasttext_demo_static", routingAwareChatBody("auto", "비밀번호 재설정 절차를 알려줘"))
	if static.Code != http.StatusOK {
		t.Fatalf("fasttext static demo 요청은 성공해야 함: status=%d body=%s", static.Code, static.Body.String())
	}
	if semantic.searchCalls != 1 || semantic.upsertCalls != 1 || embeddingProvider.calls != 1 {
		t.Fatalf("fasttext cacheable demo는 lookup/store와 embedding 1회를 수행해야 함: search=%d upsert=%d embedding=%d", semantic.searchCalls, semantic.upsertCalls, embeddingProvider.calls)
	}
	assertGateLMResponseDoesNotExposeSemanticCache(t, static)

	semantic.resetCounts()
	embeddingCallsAfterStatic := embeddingProvider.calls
	dynamic := harness.exercise(t, "sc_fasttext_demo_dynamic", routingAwareChatBody("auto", "내 이번 달 사용량 보여줘"))
	if dynamic.Code != http.StatusOK {
		t.Fatalf("fasttext dynamic demo 요청도 provider flow로 성공해야 함: status=%d body=%s", dynamic.Code, dynamic.Body.String())
	}
	if semantic.searchCalls != 0 || semantic.upsertCalls != 0 {
		t.Fatalf("fasttext dynamic demo는 semantic lookup/store를 skip해야 함: search=%d upsert=%d", semantic.searchCalls, semantic.upsertCalls)
	}
	if embeddingProvider.calls != embeddingCallsAfterStatic {
		t.Fatalf("fasttext dynamic demo는 embedding 호출 전에 skip되어야 함: before=%d after=%d", embeddingCallsAfterStatic, embeddingProvider.calls)
	}
	if harness.provider.calls != 2 {
		t.Fatalf("fasttext dynamic demo는 provider execution을 막으면 안 됨: calls=%d", harness.provider.calls)
	}
	if sidecar.requestCount() != 2 {
		t.Fatalf("fasttext sidecar는 exact miss 요청마다 1회씩 호출되어야 함: calls=%d", sidecar.requestCount())
	}
	assertGateLMResponseDoesNotExposeSemanticCache(t, dynamic)
	logged := harness.latestLog(t)
	if logged.SemanticCacheDecisionReason != cachekey.CacheabilityReasonClassifierNotCacheable || logged.SemanticReturnedFromCache {
		t.Fatalf("fasttext dynamic demo fail-closed log 불일치: %+v", logged)
	}
}

func TestChatCompletionsSemanticCacheFastTextSidecarInvalidResponseSkipsSemanticOnly(t *testing.T) {
	embeddingProvider := &countingSemanticEmbeddingProvider{delegate: cachekey.NewFakeEmbeddingProvider("fake-test")}
	semantic := newCountingSemanticCacheServiceWithEmbeddingProvider(t, true, embeddingProvider)
	harness := newSemanticCacheHarnessWithService(t, semantic, &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"label":`))
	}))
	defer server.Close()
	classifier, err := cachekey.NewFastTextSidecarCacheabilityClassifier(cachekey.FastTextSidecarCacheabilityClassifierConfig{
		Endpoint:   server.URL,
		HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatalf("fasttext sidecar classifier 생성 실패: %v", err)
	}
	harness.handler.SemanticCacheClassifier = classifier

	rr := harness.exercise(t, "sc_fasttext_invalid_response", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
	if rr.Code != http.StatusOK {
		t.Fatalf("invalid sidecar response 요청도 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if semantic.searchCalls != 0 || semantic.upsertCalls != 0 || embeddingProvider.calls != 0 {
		t.Fatalf("invalid sidecar response는 semantic/embedding만 skip해야 함: search=%d upsert=%d embedding=%d", semantic.searchCalls, semantic.upsertCalls, embeddingProvider.calls)
	}
	if harness.provider.calls != 1 {
		t.Fatalf("invalid sidecar response는 provider execution을 막으면 안 됨: calls=%d", harness.provider.calls)
	}
	if logged := harness.latestLog(t); logged.SemanticCacheDecisionReason != cachekey.CacheabilityReasonClassifierInvalid {
		t.Fatalf("invalid sidecar response reason 불일치: %q", logged.SemanticCacheDecisionReason)
	}
	assertGateLMResponseDoesNotExposeSemanticCache(t, rr)
}

func TestChatCompletionsSemanticCacheFastTextSidecarHonorsShadowAndEnforce(t *testing.T) {
	classifier, _ := newFastTextSidecarClassifierForHandlerTest(t, func(text string) (cachekey.CacheabilityLabel, float64) {
		return cachekey.CacheabilityLabelCacheableStatic, 0.96
	})

	t.Run("enforce can return existing semantic hit", func(t *testing.T) {
		harness := newSemanticCacheHarness(t, true)
		harness.handler.SemanticCacheClassifier = classifier

		first := harness.exercise(t, "sc_fasttext_enforce_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
		second := harness.exercise(t, "sc_fasttext_enforce_second", routingAwareChatBody("auto", "패스워드 초기화는 어떻게 해?"))

		if first.Code != http.StatusOK || second.Code != http.StatusOK {
			t.Fatalf("fasttext enforce demo 요청은 성공해야 함: first=%d second=%d body=%s", first.Code, second.Code, second.Body.String())
		}
		if harness.provider.calls != 1 {
			t.Fatalf("fasttext enforce hit는 provider를 다시 호출하지 않아야 함: calls=%d", harness.provider.calls)
		}
		resp := decodeSemanticChatResponse(t, second)
		if resp.GateLM == nil || resp.GateLM.CacheType != invocationlog.CacheTypeSemantic || resp.GateLM.ProviderCalled {
			t.Fatalf("fasttext enforce hit metadata 불일치: %+v", resp.GateLM)
		}
		assertGateLMResponseDoesNotExposeSemanticCache(t, second)
	})

	t.Run("shadow never returns candidate as cached response", func(t *testing.T) {
		harness := newSemanticCacheHarness(t, true)
		harness.handler.SemanticCacheClassifier = classifier

		first := harness.exercise(t, "sc_fasttext_shadow_seed", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
		if first.Code != http.StatusOK {
			t.Fatalf("fasttext shadow seed 요청은 성공해야 함: status=%d body=%s", first.Code, first.Body.String())
		}
		harness.semantic.resetCounts()
		harness.handler.SemanticCacheMode = cachekey.SemanticCacheModeShadow

		second := harness.exercise(t, "sc_fasttext_shadow_candidate", routingAwareChatBody("auto", "패스워드 초기화는 어떻게 해?"))
		if second.Code != http.StatusOK {
			t.Fatalf("fasttext shadow candidate 요청은 성공해야 함: status=%d body=%s", second.Code, second.Body.String())
		}
		if harness.semantic.searchCalls != 1 || harness.semantic.upsertCalls != 0 {
			t.Fatalf("fasttext shadow hit candidate는 lookup만 수행해야 함: search=%d upsert=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls)
		}
		if harness.provider.calls != 2 {
			t.Fatalf("fasttext shadow hit candidate도 provider를 호출해야 함: calls=%d", harness.provider.calls)
		}
		resp := decodeSemanticChatResponse(t, second)
		if resp.GateLM == nil || !resp.GateLM.ProviderCalled {
			t.Fatalf("fasttext shadow response metadata 불일치: %+v", resp.GateLM)
		}
		assertGateLMResponseDoesNotExposeSemanticCache(t, second)
		logged := harness.latestLog(t)
		if logged.SemanticCacheHit || !logged.SemanticCacheWouldHit || logged.SemanticReturnedFromCache || logged.SemanticCacheDecisionReason != cachekey.SemanticCacheReasonShadowWouldHit {
			t.Fatalf("fasttext shadow log 불일치: %+v", logged)
		}
	})
}

func TestChatCompletionsSemanticCacheClassifierFailureModesSkipSemanticOnly(t *testing.T) {
	cases := []struct {
		name       string
		result     *cachekey.CacheabilityClassifierResult
		err        error
		wantReason string
	}{
		{
			name:       "error",
			err:        errors.New("classifier unavailable"),
			wantReason: cachekey.CacheabilityReasonClassifierError,
		},
		{
			name:       "timeout",
			err:        context.DeadlineExceeded,
			wantReason: cachekey.CacheabilityReasonClassifierTimeout,
		},
		{
			name: "invalid result",
			result: &cachekey.CacheabilityClassifierResult{
				Label:        "invalid_label",
				Confidence:   0.95,
				ReasonCode:   "invalid",
				ModelVersion: "test",
			},
			wantReason: cachekey.CacheabilityReasonClassifierInvalid,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			embeddingProvider := &countingSemanticEmbeddingProvider{delegate: cachekey.NewFakeEmbeddingProvider("fake-test")}
			semantic := newCountingSemanticCacheServiceWithEmbeddingProvider(t, true, embeddingProvider)
			harness := newSemanticCacheHarnessWithService(t, semantic, &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock})
			harness.classifier.result = tc.result
			harness.classifier.err = tc.err

			rr := harness.exercise(t, "sc_classifier_failure_"+strings.ReplaceAll(tc.name, " ", "_"), routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))

			if rr.Code != http.StatusOK {
				t.Fatalf("classifier failure 요청도 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
			}
			if semantic.searchCalls != 0 || semantic.upsertCalls != 0 || embeddingProvider.calls != 0 {
				t.Fatalf("classifier failure는 semantic/embedding만 skip해야 함: search=%d upsert=%d embedding=%d", semantic.searchCalls, semantic.upsertCalls, embeddingProvider.calls)
			}
			if harness.provider.calls != 1 {
				t.Fatalf("classifier failure는 provider execution을 막으면 안 됨: calls=%d", harness.provider.calls)
			}
			if logged := harness.latestLog(t); logged.SemanticCacheDecisionReason != tc.wantReason {
				t.Fatalf("classifier failure reason 불일치: got=%q want=%q", logged.SemanticCacheDecisionReason, tc.wantReason)
			}
		})
	}
}

func TestChatCompletionsSemanticCacheClassifierResultAndLookupVectorStoredOnRequestContext(t *testing.T) {
	embeddingProvider := &countingSemanticEmbeddingProvider{delegate: cachekey.NewFakeEmbeddingProvider("fake-test")}
	semantic := newCountingSemanticCacheServiceWithEmbeddingProvider(t, true, embeddingProvider)
	harness := newSemanticCacheHarnessWithService(t, semantic, &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock})

	rr := harness.exercise(t, "sc_classifier_context_reuse", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))

	if rr.Code != http.StatusOK {
		t.Fatalf("classifier pass 요청은 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.classifier.calls != 1 || len(harness.classifier.requests) != 1 {
		t.Fatalf("classifier request 저장 불일치: calls=%d requests=%d", harness.classifier.calls, len(harness.classifier.requests))
	}
	if harness.classifier.requests[0].NormalizedText != "비밀번호 재설정 방법 알려줘" {
		t.Fatalf("classifier normalized text 불일치: %q", harness.classifier.requests[0].NormalizedText)
	}
	if semantic.searchCalls != 1 || semantic.upsertCalls != 1 {
		t.Fatalf("classifier pass 후 semantic lookup/store 호출 수 불일치: search=%d upsert=%d", semantic.searchCalls, semantic.upsertCalls)
	}
	if embeddingProvider.calls != 1 {
		t.Fatalf("lookup vector가 request context/store로 재사용되어야 함: embeddingCalls=%d", embeddingProvider.calls)
	}
	if len(semantic.storeRequests) != 1 || len(semantic.storeRequests[0].EmbeddingVector) == 0 {
		t.Fatalf("store request는 lookup vector를 받아야 함: %+v", semantic.storeRequests)
	}
	logged := harness.latestLog(t)
	if logged.SemanticCacheDecisionReason != cachekey.SemanticCacheReasonStored {
		t.Fatalf("store success reason 불일치: %q", logged.SemanticCacheDecisionReason)
	}
}

func TestChatCompletionsSemanticCacheCacheablePolicyRequiresVerifiedBoundary(t *testing.T) {
	t.Run("missing cache policy hash fails closed", func(t *testing.T) {
		embeddingProvider := &countingSemanticEmbeddingProvider{delegate: cachekey.NewFakeEmbeddingProvider("fake-test")}
		semantic := newCountingSemanticCacheServiceWithEmbeddingProvider(t, true, embeddingProvider)
		harness := newSemanticCacheHarnessWithService(t, semantic, &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock})
		harness.classifier.result = &cachekey.CacheabilityClassifierResult{
			Label:        cachekey.CacheabilityLabelCacheablePolicy,
			Confidence:   0.95,
			ReasonCode:   cachekey.CacheabilityReasonPolicyStub,
			ModelVersion: cachekey.CacheabilityClassifierStubModelVersion,
		}

		rr := harness.exercise(t, "sc_classifier_policy_boundary_missing", routingAwareChatBody("auto", "refund policy 설명해줘"))

		if rr.Code != http.StatusOK {
			t.Fatalf("policy boundary missing 요청도 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
		}
		if semantic.searchCalls != 0 || semantic.upsertCalls != 0 || embeddingProvider.calls != 0 {
			t.Fatalf("policy boundary missing은 semantic/embedding skip되어야 함: search=%d upsert=%d embedding=%d", semantic.searchCalls, semantic.upsertCalls, embeddingProvider.calls)
		}
		if logged := harness.latestLog(t); logged.SemanticCacheDecisionReason != cachekey.CacheabilityReasonClassifierPolicyBoundaryGap {
			t.Fatalf("policy boundary missing reason 불일치: %q", logged.SemanticCacheDecisionReason)
		}
	})

	t.Run("runtime cache policy hash allows policy candidate", func(t *testing.T) {
		embeddingProvider := &countingSemanticEmbeddingProvider{delegate: cachekey.NewFakeEmbeddingProvider("fake-test")}
		semantic := newCountingSemanticCacheServiceWithEmbeddingProvider(t, true, embeddingProvider)
		harness := newSemanticCacheHarnessWithService(t, semantic, &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock})
		harness.classifier.result = &cachekey.CacheabilityClassifierResult{
			Label:        cachekey.CacheabilityLabelCacheablePolicy,
			Confidence:   0.95,
			ReasonCode:   cachekey.CacheabilityReasonPolicyStub,
			ModelVersion: cachekey.CacheabilityClassifierStubModelVersion,
		}
		harness.handler.RuntimePolicyPipeline = runtimeCachePolicyHashPipeline{hash: "runtime_cache_policy_hash_v1"}

		rr := harness.exercise(t, "sc_classifier_policy_boundary_present", routingAwareChatBody("auto", "refund policy 설명해줘"))

		if rr.Code != http.StatusOK {
			t.Fatalf("verified policy boundary 요청은 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
		}
		if semantic.searchCalls != 1 || semantic.upsertCalls != 1 || embeddingProvider.calls != 1 {
			t.Fatalf("verified policy boundary는 semantic lookup/store 후보여야 함: search=%d upsert=%d embedding=%d", semantic.searchCalls, semantic.upsertCalls, embeddingProvider.calls)
		}
		if len(semantic.lookupRequests) != 1 || semantic.lookupRequests[0].Boundary.SemanticCachePolicyHash != "runtime_cache_policy_hash_v1" {
			t.Fatalf("runtime cache policy hash가 boundary에 포함되어야 함: %+v", semantic.lookupRequests)
		}
	})
}

func TestChatCompletionsSemanticCacheCategoryDenylistBypasses(t *testing.T) {
	cases := []struct {
		name     string
		category string
		prompt   string
	}{
		{name: "code", category: routingdomain.CategoryCode, prompt: "```ts\nconst value = 1\n```"},
		{name: "translation", category: routingdomain.CategoryTranslation, prompt: "이 문장을 영어로 번역해줘"},
		{name: "reasoning", category: cachekey.SemanticCacheCategoryReasoning, prompt: "단계별로 추론해줘"},
		{name: "sensitive", category: cachekey.SemanticCacheCategorySensitive, prompt: "민감한 요청은 semantic cache에서 제외되어야 해"},
		{name: "tool_call", category: cachekey.SemanticCacheCategoryToolCall, prompt: "외부 도구를 호출해줘"},
		{name: "unknown", category: routingdomain.CategoryUnknown, prompt: "분류 불가능한 요청"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			harness := newSemanticCacheHarness(t, true)
			requestID := "sc_category_" + tc.name
			harness.routes[requestID] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: tc.category}

			rr := harness.exercise(t, requestID, routingAwareChatBody("auto", tc.prompt))

			if rr.Code != http.StatusOK {
				t.Fatalf("deny category 요청도 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
			}
			if harness.semantic.searchCalls != 0 || harness.semantic.upsertCalls != 0 {
				t.Fatalf("deny category는 semantic lookup/store 금지: search=%d upsert=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls)
			}
			if harness.classifier.calls != 0 {
				t.Fatalf("deny category cheap deny에서는 classifier 호출도 금지: calls=%d", harness.classifier.calls)
			}
			if harness.provider.calls != 1 {
				t.Fatalf("deny category bypass 후 provider flow는 유지되어야 함: calls=%d", harness.provider.calls)
			}
			resp := decodeSemanticChatResponse(t, rr)
			if resp.GateLM == nil || !resp.GateLM.ProviderCalled {
				t.Fatalf("deny category bypass는 providerCalled=true여야 함: %+v", resp.GateLM)
			}
			logged := harness.latestLog(t)
			if logged.PromptCategory != tc.category || logged.SemanticCacheDecisionReason != "semantic_category_disabled" {
				t.Fatalf("category bypass reason 불일치: category=%q reason=%q", logged.PromptCategory, logged.SemanticCacheDecisionReason)
			}
			if logged.CacheType == invocationlog.CacheTypeSemantic {
				t.Fatalf("deny category는 semantic cache type으로 기록되면 안 됨: %+v", logged)
			}
		})
	}
}

func TestChatCompletionsSemanticCacheRolloutScopeBypasses(t *testing.T) {
	t.Run("tenant scope denied", func(t *testing.T) {
		semantic := newCountingSemanticCacheService(t, true)
		harness := newSemanticCacheHarnessWithIdentity(t, semantic, "tenant-a", "project-a", "app-a")
		harness.handler.SemanticCacheAllowedTenantIDs = []string{"tenant-b"}

		rr := harness.exercise(t, "sc_scope_tenant", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))

		if rr.Code != http.StatusOK {
			t.Fatalf("tenant scope 밖 요청도 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
		}
		if semantic.searchCalls != 0 || semantic.upsertCalls != 0 {
			t.Fatalf("tenant scope 밖에서는 semantic lookup/store 금지: search=%d upsert=%d", semantic.searchCalls, semantic.upsertCalls)
		}
		if harness.provider.calls != 1 {
			t.Fatalf("tenant scope 밖 provider 호출 불일치: calls=%d", harness.provider.calls)
		}
		logged := harness.latestLog(t)
		if logged.SemanticCacheDecisionReason != cachekey.SemanticCacheReasonTenantDenied {
			t.Fatalf("tenant scope denied reason 불일치: %q", logged.SemanticCacheDecisionReason)
		}
	})

	t.Run("application scope denied", func(t *testing.T) {
		semantic := newCountingSemanticCacheService(t, true)
		harness := newSemanticCacheHarnessWithIdentity(t, semantic, "tenant-a", "project-a", "app-a")
		harness.handler.SemanticCacheAllowedApplicationIDs = []string{"app-b"}

		rr := harness.exercise(t, "sc_scope_application", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))

		if rr.Code != http.StatusOK {
			t.Fatalf("application scope 밖 요청도 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
		}
		if semantic.searchCalls != 0 || semantic.upsertCalls != 0 {
			t.Fatalf("application scope 밖에서는 semantic lookup/store 금지: search=%d upsert=%d", semantic.searchCalls, semantic.upsertCalls)
		}
		if harness.provider.calls != 1 {
			t.Fatalf("application scope 밖 provider 호출 불일치: calls=%d", harness.provider.calls)
		}
		logged := harness.latestLog(t)
		if logged.SemanticCacheDecisionReason != cachekey.SemanticCacheReasonApplicationDenied {
			t.Fatalf("application scope denied reason 불일치: %q", logged.SemanticCacheDecisionReason)
		}
	})

	t.Run("category scope denied", func(t *testing.T) {
		harness := newSemanticCacheHarness(t, true)
		harness.handler.SemanticCacheAllowedCategories = []string{cachekey.SemanticCacheCategorySupportRefund}
		harness.routes["sc_scope_category"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategoryGeneral}

		rr := harness.exercise(t, "sc_scope_category", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))

		if rr.Code != http.StatusOK {
			t.Fatalf("category scope 밖 요청도 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
		}
		if harness.semantic.searchCalls != 0 || harness.semantic.upsertCalls != 0 {
			t.Fatalf("category scope 밖에서는 semantic lookup/store 금지: search=%d upsert=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls)
		}
		if harness.provider.calls != 1 {
			t.Fatalf("category scope 밖 provider 호출 불일치: calls=%d", harness.provider.calls)
		}
		logged := harness.latestLog(t)
		if logged.SemanticCacheDecisionReason != cachekey.SemanticCacheReasonCategoryDenied {
			t.Fatalf("category scope denied reason 불일치: %q", logged.SemanticCacheDecisionReason)
		}
		if logged.Metadata["semanticCacheMode"] != cachekey.SemanticCacheModeEnforce || logged.Metadata["semanticCacheEnabled"] != true {
			t.Fatalf("scope denied safe metadata 불일치: %+v", logged.Metadata)
		}
	})
}

func TestChatCompletionsSemanticCacheGeneralOnlyCanaryRuntimeReturnsOnlyEligibleGeneralHit(t *testing.T) {
	semantic := newCountingSemanticCacheService(t, true)
	harness := newSemanticCacheHarnessWithIdentity(t, semantic, "tenant_demo", "project_demo", "app_demo")
	configureGeneralOnlySemanticCanary(harness)
	harness.routes["sc_canary_general_first"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategoryGeneral}
	harness.routes["sc_canary_general_second"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategoryGeneral}

	first := harness.exercise(t, "sc_canary_general_first", routingAwareChatBody("auto", "사용량은 어디서 확인해?"))
	second := harness.exercise(t, "sc_canary_general_second", routingAwareChatBody("auto", "API 사용량 확인 화면은 어디야?"))

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("general-only canary 요청은 모두 성공해야 함: first=%d second=%d body=%s", first.Code, second.Code, second.Body.String())
	}
	if harness.provider.calls != 1 {
		t.Fatalf("eligible general canary hit는 provider 재호출이 없어야 함: calls=%d", harness.provider.calls)
	}
	assertGateLMResponseDoesNotExposeSemanticCache(t, second)
	resp := decodeSemanticChatResponse(t, second)
	if resp.GateLM == nil ||
		resp.GateLM.CacheType != invocationlog.CacheTypeSemantic ||
		resp.GateLM.ProviderCalled {
		t.Fatalf("general-only canary semantic hit response metadata 불일치: %+v", resp.GateLM)
	}
	logged := harness.latestLog(t)
	if logged.PromptCategory != routingdomain.CategoryGeneral ||
		logged.SemanticCacheDecisionReason != cachekey.SemanticCacheReasonHit ||
		!logged.SemanticCacheHit ||
		!logged.SemanticReturnedFromCache ||
		logged.Metadata["semanticReturnedFromCache"] != true ||
		logged.Metadata["semanticCacheMode"] != cachekey.SemanticCacheModeEnforce ||
		logged.Metadata["semanticCandidateFound"] != true ||
		logged.Metadata["semanticCandidateHash"] == "" ||
		logged.Metadata["semanticCanonicalIntent"] == "" ||
		logged.Metadata["semanticRequiredSlotsHash"] == "" {
		t.Fatalf("general-only canary safe metadata 불일치: %+v", logged)
	}
	assertSemanticCacheRuntimeOutputDoesNotLeakForbiddenMarkers(t, second, logged,
		"사용량은 어디서 확인해?",
		"API 사용량 확인 화면은 어디야?",
	)
}

func TestChatCompletionsSemanticCacheGeneralOnlyCanaryBlocksDynamicUsageRuntimeReturns(t *testing.T) {
	embeddingProvider := &countingSemanticEmbeddingProvider{delegate: cachekey.NewFakeEmbeddingProvider("fake-test")}
	semantic := newCountingSemanticCacheServiceWithEmbeddingProvider(t, true, embeddingProvider)
	harness := newSemanticCacheHarnessWithIdentity(t, semantic, "tenant_demo", "project_demo", "app_demo")
	configureGeneralOnlySemanticCanary(harness)
	harness.routes["sc_canary_usage_static_seed"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategoryGeneral}
	harness.routes["sc_canary_usage_dynamic"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategoryGeneral}

	harness.classifier.result = &cachekey.CacheabilityClassifierResult{
		Label:        cachekey.CacheabilityLabelCacheableStatic,
		Confidence:   0.95,
		ReasonCode:   cachekey.CacheabilityReasonStaticStub,
		ModelVersion: cachekey.CacheabilityClassifierStubModelVersion,
	}
	first := harness.exercise(t, "sc_canary_usage_static_seed", routingAwareChatBody("auto", "사용량은 어디서 확인해?"))
	if first.Code != http.StatusOK {
		t.Fatalf("static usage guidance seed 요청은 성공해야 함: status=%d body=%s", first.Code, first.Body.String())
	}
	embeddingCallsAfterSeed := embeddingProvider.calls
	semantic.resetCounts()
	harness.classifier.calls = 0
	harness.classifier.result = &cachekey.CacheabilityClassifierResult{
		Label:        cachekey.CacheabilityLabelDynamicUserState,
		Confidence:   0.99,
		ReasonCode:   cachekey.CacheabilityReasonDynamicStub,
		ModelVersion: cachekey.CacheabilityClassifierStubModelVersion,
	}

	second := harness.exercise(t, "sc_canary_usage_dynamic", routingAwareChatBody("auto", "내 이번 달 사용량 보여줘"))
	if second.Code != http.StatusOK {
		t.Fatalf("동적 사용량 조회 요청도 provider flow로 성공해야 함: status=%d body=%s", second.Code, second.Body.String())
	}
	if harness.provider.calls != 2 {
		t.Fatalf("동적 사용량 조회는 semantic cache hit 없이 provider를 호출해야 함: calls=%d", harness.provider.calls)
	}
	if embeddingProvider.calls != embeddingCallsAfterSeed {
		t.Fatalf("동적 사용량 조회는 classifier gate에서 embedding 호출 전에 제외되어야 함: before=%d after=%d", embeddingCallsAfterSeed, embeddingProvider.calls)
	}
	if semantic.searchCalls != 0 || semantic.upsertCalls != 0 {
		t.Fatalf("동적 사용량 조회는 classifier gate에서 semantic lookup/store가 제외되어야 함: search=%d upsert=%d", semantic.searchCalls, semantic.upsertCalls)
	}
	assertGateLMResponseDoesNotExposeSemanticCache(t, second)
	resp := decodeSemanticChatResponse(t, second)
	if resp.GateLM == nil ||
		!resp.GateLM.ProviderCalled {
		t.Fatalf("동적 사용량 조회 metadata 불일치: %+v", resp.GateLM)
	}
	logged := harness.latestLog(t)
	if logged.SemanticCacheDecisionReason != cachekey.CacheabilityReasonClassifierNotCacheable ||
		logged.SemanticReturnedFromCache ||
		logged.Metadata["semanticReturnedFromCache"] != false {
		t.Fatalf("동적 사용량 조회 log reason 불일치: %+v", logged)
	}
	assertSemanticCacheRuntimeOutputDoesNotLeakForbiddenMarkers(t, second, logged,
		"사용량은 어디서 확인해?",
		"내 이번 달 사용량 보여줘",
	)
}

func TestChatCompletionsSemanticCacheGeneralOnlyCanaryBlocksNonGeneralRuntimeReturns(t *testing.T) {
	tests := []struct {
		name          string
		category      string
		firstPrompt   string
		secondPrompt  string
		baseAllow     []string
		wantReason    string
		seedCandidate bool
	}{
		{
			name:          "account_access",
			category:      cachekey.SemanticCacheCategoryAccountAccess,
			firstPrompt:   "API Key 발급 방법 알려줘",
			secondPrompt:  "API Key 생성은 어디서 해?",
			baseAllow:     []string{cachekey.SemanticCacheCategoryGeneral, cachekey.SemanticCacheCategoryAccountAccess},
			wantReason:    cachekey.SemanticCacheReasonCategoryDenied,
			seedCandidate: true,
		},
		{
			name:          "support_refund",
			category:      routingdomain.CategorySupportRefund,
			firstPrompt:   "배송비도 환불되나요?",
			secondPrompt:  "반품하면 배송비도 돌려받나요?",
			baseAllow:     []string{cachekey.SemanticCacheCategoryGeneral, cachekey.SemanticCacheCategorySupportRefund},
			wantReason:    cachekey.SemanticCacheReasonCategoryDenied,
			seedCandidate: true,
		},
		{
			name:         "code",
			category:     routingdomain.CategoryCode,
			secondPrompt: "```ts\nconst value = 1\n``` 이 코드 설명해줘",
			wantReason:   "semantic_category_disabled",
		},
		{
			name:         "translation",
			category:     routingdomain.CategoryTranslation,
			secondPrompt: "이 문장을 영어로 번역해줘",
			wantReason:   "semantic_category_disabled",
		},
		{
			name:         "unknown",
			category:     routingdomain.CategoryUnknown,
			secondPrompt: "분류 불가능한 요청",
			wantReason:   "semantic_category_disabled",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			semantic := newCountingSemanticCacheService(t, true)
			harness := newSemanticCacheHarnessWithIdentity(t, semantic, "tenant_demo", "project_demo", "app_demo")
			if len(tc.baseAllow) > 0 {
				harness.handler.SemanticCacheAllowCategories = tc.baseAllow
			}
			if tc.seedCandidate {
				harness.routes["sc_canary_seed_"+tc.name] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: tc.category}
				seed := harness.exercise(t, "sc_canary_seed_"+tc.name, routingAwareChatBody("auto", tc.firstPrompt))
				if seed.Code != http.StatusOK {
					t.Fatalf("non-general candidate seed 요청은 성공해야 함: status=%d body=%s", seed.Code, seed.Body.String())
				}
				if semantic.upsertCalls != 1 {
					t.Fatalf("seed 요청은 candidate entry를 저장해야 함: upsert=%d", semantic.upsertCalls)
				}
				semantic.resetCounts()
			}
			configureGeneralOnlySemanticCanary(harness)
			harness.routes["sc_canary_block_"+tc.name] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: tc.category}
			providerCallsBefore := harness.provider.calls

			rr := harness.exercise(t, "sc_canary_block_"+tc.name, routingAwareChatBody("auto", tc.secondPrompt))

			if rr.Code != http.StatusOK {
				t.Fatalf("non-general canary 차단 후 provider flow는 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
			}
			if harness.provider.calls != providerCallsBefore+1 {
				t.Fatalf("non-general canary 차단 요청은 provider path를 사용해야 함: before=%d after=%d", providerCallsBefore, harness.provider.calls)
			}
			if semantic.searchCalls != 0 || semantic.upsertCalls != 0 {
				t.Fatalf("non-general canary 차단은 lookup/store 전에 일어나야 함: search=%d upsert=%d", semantic.searchCalls, semantic.upsertCalls)
			}
			assertGateLMResponseDoesNotExposeSemanticCache(t, rr)
			resp := decodeSemanticChatResponse(t, rr)
			if resp.GateLM == nil || !resp.GateLM.ProviderCalled {
				t.Fatalf("non-general canary 차단 metadata 불일치: %+v", resp.GateLM)
			}
			logged := harness.latestLog(t)
			if logged.PromptCategory != cachekey.CanonicalSemanticCacheCategory(tc.category) ||
				logged.SemanticCacheDecisionReason != tc.wantReason ||
				logged.SemanticReturnedFromCache ||
				logged.Metadata["semanticReturnedFromCache"] != false {
				t.Fatalf("non-general canary 차단 log 불일치: wantReason=%s log=%+v", tc.wantReason, logged)
			}
			assertSemanticCacheRuntimeOutputDoesNotLeakForbiddenMarkers(t, rr, logged, tc.firstPrompt, tc.secondPrompt)
		})
	}
}

func TestChatCompletionsSemanticCacheGeneralOnlyCanaryBlocksTenantAndApplicationOutsideScope(t *testing.T) {
	tests := []struct {
		name              string
		tenantID          string
		projectID         string
		applicationID     string
		allowedTenants    []string
		allowedApps       []string
		wantReason        string
		wantPromptContext []string
	}{
		{
			name:           "tenant outside canary",
			tenantID:       "tenant_other",
			projectID:      "project_demo",
			applicationID:  "app_demo",
			allowedTenants: []string{"tenant_demo"},
			allowedApps:    []string{"app_demo"},
			wantReason:     cachekey.SemanticCacheReasonTenantDenied,
		},
		{
			name:           "application outside canary",
			tenantID:       "tenant_demo",
			projectID:      "project_demo",
			applicationID:  "app_other",
			allowedTenants: []string{"tenant_demo"},
			allowedApps:    []string{"app_demo"},
			wantReason:     cachekey.SemanticCacheReasonApplicationDenied,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			semantic := newCountingSemanticCacheService(t, true)
			allowed := newSemanticCacheHarnessWithIdentity(t, semantic, "tenant_demo", "project_demo", "app_demo")
			configureGeneralOnlySemanticCanary(allowed)
			allowed.exercise(t, "sc_canary_scope_seed", routingAwareChatBody("auto", "사용량은 어디서 확인해?"))
			semantic.resetCounts()
			outside := newSemanticCacheHarnessWithIdentity(t, semantic, tc.tenantID, tc.projectID, tc.applicationID)
			configureGeneralOnlySemanticCanary(outside)
			outside.handler.SemanticCacheAllowedTenantIDs = tc.allowedTenants
			outside.handler.SemanticCacheAllowedApplicationIDs = tc.allowedApps
			outside.routes["sc_canary_scope_outside"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategoryGeneral}

			rr := outside.exercise(t, "sc_canary_scope_outside", routingAwareChatBody("auto", "API 사용량 확인 화면은 어디야?"))

			if rr.Code != http.StatusOK {
				t.Fatalf("scope 밖 general 요청도 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
			}
			if outside.provider.calls != 1 {
				t.Fatalf("scope 밖 general 요청은 provider path를 사용해야 함: calls=%d", outside.provider.calls)
			}
			if semantic.searchCalls != 0 || semantic.upsertCalls != 0 {
				t.Fatalf("scope 밖 요청은 semantic lookup/store 전에 차단되어야 함: search=%d upsert=%d", semantic.searchCalls, semantic.upsertCalls)
			}
			assertGateLMResponseDoesNotExposeSemanticCache(t, rr)
			resp := decodeSemanticChatResponse(t, rr)
			if resp.GateLM == nil || !resp.GateLM.ProviderCalled {
				t.Fatalf("scope 밖 response metadata 불일치: %+v", resp.GateLM)
			}
			logged := outside.latestLog(t)
			if logged.SemanticCacheDecisionReason != tc.wantReason ||
				logged.SemanticReturnedFromCache ||
				logged.Metadata["semanticReturnedFromCache"] != false ||
				logged.Metadata["semanticCacheMode"] != cachekey.SemanticCacheModeEnforce {
				t.Fatalf("scope 밖 safe metadata 불일치: %+v", logged)
			}
			assertSemanticCacheRuntimeOutputDoesNotLeakForbiddenMarkers(t, rr, logged,
				"사용량은 어디서 확인해?",
				"API 사용량 확인 화면은 어디야?",
			)
		})
	}
}

func TestChatCompletionsSemanticCacheKoreanRequests(t *testing.T) {
	t.Run("similar requests hit", func(t *testing.T) {
		harness := newSemanticCacheHarness(t, true)

		first := harness.exercise(t, "sc_ko_hit_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
		second := harness.exercise(t, "sc_ko_hit_second", routingAwareChatBody("auto", "패스워드 초기화는 어떻게 해?"))

		if first.Code != http.StatusOK || second.Code != http.StatusOK {
			t.Fatalf("한국어 유사 요청은 모두 성공해야 함: first=%d second=%d body=%s", first.Code, second.Code, second.Body.String())
		}
		if harness.provider.calls != 1 {
			t.Fatalf("한국어 유사 요청 semantic hit는 provider 재호출 금지: calls=%d", harness.provider.calls)
		}
		assertGateLMResponseDoesNotExposeSemanticCache(t, second)
		resp := decodeSemanticChatResponse(t, second)
		if resp.GateLM == nil || resp.GateLM.CacheType != invocationlog.CacheTypeSemantic || resp.GateLM.ProviderCalled {
			t.Fatalf("한국어 유사 요청 semantic hit metadata 불일치: %+v", resp.GateLM)
		}
		logged := harness.latestLog(t)
		if !logged.SemanticCacheHit || !logged.SemanticReturnedFromCache {
			t.Fatalf("한국어 유사 요청 semantic hit evidence log 불일치: %+v", logged)
		}
	})

	t.Run("unrelated request misses", func(t *testing.T) {
		harness := newSemanticCacheHarness(t, true)

		harness.exercise(t, "sc_ko_miss_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
		rr := harness.exercise(t, "sc_ko_miss_second", routingAwareChatBody("auto", "사용량 메뉴 위치 알려줘"))

		if rr.Code != http.StatusOK {
			t.Fatalf("한국어 비유사 요청도 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
		}
		if harness.provider.calls != 2 {
			t.Fatalf("한국어 비유사 요청은 semantic miss 후 provider 호출이어야 함: calls=%d", harness.provider.calls)
		}
		if len(harness.semantic.searchResults) < 2 || harness.semantic.searchResults[1].Reason != cachekey.SemanticCacheReasonThresholdMiss {
			t.Fatalf("한국어 비유사 요청 lookup reason은 threshold_miss여야 함: %+v", harness.semantic.searchResults)
		}
	})

	t.Run("code category bypasses", func(t *testing.T) {
		harness := newSemanticCacheHarness(t, true)
		harness.routes["sc_ko_code"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategoryCode}

		rr := harness.exercise(t, "sc_ko_code", routingAwareChatBody("auto", "이 코드 설명해줘"))

		if rr.Code != http.StatusOK {
			t.Fatalf("한국어 code 요청은 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
		}
		if harness.semantic.searchCalls != 0 || harness.semantic.upsertCalls != 0 {
			t.Fatalf("한국어 code category는 semantic lookup/store 금지: search=%d upsert=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls)
		}
		logged := harness.latestLog(t)
		if logged.PromptCategory != routingdomain.CategoryCode || logged.SemanticCacheDecisionReason != "semantic_category_disabled" {
			t.Fatalf("한국어 code bypass log 불일치: category=%q reason=%q", logged.PromptCategory, logged.SemanticCacheDecisionReason)
		}
	})

	t.Run("translation category bypasses", func(t *testing.T) {
		harness := newSemanticCacheHarness(t, true)
		harness.routes["sc_ko_translation"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategoryTranslation}

		rr := harness.exercise(t, "sc_ko_translation", routingAwareChatBody("auto", "이 문장을 영어로 번역해줘"))

		if rr.Code != http.StatusOK {
			t.Fatalf("한국어 translation 요청은 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
		}
		if harness.semantic.searchCalls != 0 || harness.semantic.upsertCalls != 0 {
			t.Fatalf("한국어 translation category는 semantic lookup/store 금지: search=%d upsert=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls)
		}
		logged := harness.latestLog(t)
		if logged.PromptCategory != routingdomain.CategoryTranslation || logged.SemanticCacheDecisionReason != "semantic_category_disabled" {
			t.Fatalf("한국어 translation bypass log 불일치: category=%q reason=%q", logged.PromptCategory, logged.SemanticCacheDecisionReason)
		}
	})

	t.Run("support refund category is allowed", func(t *testing.T) {
		harness := newSemanticCacheHarness(t, true)
		harness.routes["sc_ko_refund"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategorySupportRefund}

		rr := harness.exercise(t, "sc_ko_refund", routingAwareChatBody("auto", "배송비도 환불되나요?"))

		if rr.Code != http.StatusOK {
			t.Fatalf("한국어 support_refund 요청은 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
		}
		if harness.semantic.searchCalls != 1 || harness.semantic.upsertCalls != 1 {
			t.Fatalf("한국어 support_refund는 semantic 후보로 lookup/store되어야 함: search=%d upsert=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls)
		}
		logged := harness.latestLog(t)
		if logged.PromptCategory != routingdomain.CategorySupportRefund || logged.CacheType != invocationlog.CacheTypeSemantic {
			t.Fatalf("한국어 support_refund cache log 불일치: category=%q cacheType=%q", logged.PromptCategory, logged.CacheType)
		}
	})

	t.Run("support refund similar requests hit", func(t *testing.T) {
		semantic := newCountingSemanticCacheServiceWithEmbeddingProvider(t, true, supportRefundSemanticEmbeddingProvider{delegate: cachekey.NewFakeEmbeddingProvider("fake-test")})
		harness := newSemanticCacheHarnessWithService(t, semantic, &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock})
		harness.routes["sc_ko_refund_hit_first"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategorySupportRefund}
		harness.routes["sc_ko_refund_hit_second"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategorySupportRefund}

		first := harness.exercise(t, "sc_ko_refund_hit_first", routingAwareChatBody("auto", "배송비도 환불되나요?"))
		second := harness.exercise(t, "sc_ko_refund_hit_second", routingAwareChatBody("auto", "반품하면 배송비도 돌려받나요?"))

		if first.Code != http.StatusOK || second.Code != http.StatusOK {
			t.Fatalf("한국어 support_refund 유사 요청은 모두 성공해야 함: first=%d second=%d body=%s", first.Code, second.Code, second.Body.String())
		}
		if harness.provider.calls != 1 {
			t.Fatalf("한국어 support_refund 유사 요청 hit는 provider 재호출 금지: calls=%d", harness.provider.calls)
		}
		assertGateLMResponseDoesNotExposeSemanticCache(t, second)
		resp := decodeSemanticChatResponse(t, second)
		if resp.GateLM == nil || resp.GateLM.CacheType != invocationlog.CacheTypeSemantic || resp.GateLM.ProviderCalled {
			t.Fatalf("한국어 support_refund semantic hit metadata 불일치: %+v", resp.GateLM)
		}
		logged := harness.latestLog(t)
		if !logged.SemanticCacheHit || logged.SemanticMatchedRequestID != "sc_ko_refund_hit_first" {
			t.Fatalf("support_refund semantic hit evidence log 불일치: %+v", logged)
		}
	})

	t.Run("support refund hard negative misses", func(t *testing.T) {
		semantic := newCountingSemanticCacheServiceWithEmbeddingProvider(t, true, supportRefundSemanticEmbeddingProvider{delegate: cachekey.NewFakeEmbeddingProvider("fake-test")})
		harness := newSemanticCacheHarnessWithService(t, semantic, &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock})
		harness.routes["sc_ko_refund_negative_first"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategorySupportRefund}
		harness.routes["sc_ko_refund_negative_second"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategorySupportRefund}

		first := harness.exercise(t, "sc_ko_refund_negative_first", routingAwareChatBody("auto", "배송비도 환불되나요?"))
		second := harness.exercise(t, "sc_ko_refund_negative_second", routingAwareChatBody("auto", "주문 취소하고 싶어요"))

		if first.Code != http.StatusOK || second.Code != http.StatusOK {
			t.Fatalf("support_refund hard negative 요청은 모두 provider flow로 성공해야 함: first=%d second=%d body=%s", first.Code, second.Code, second.Body.String())
		}
		if harness.provider.calls != 2 {
			t.Fatalf("shipping fee refund와 order cancel은 similarity가 높아도 provider 재호출이어야 함: calls=%d", harness.provider.calls)
		}
		if len(harness.semantic.searchResults) < 2 || harness.semantic.searchResults[1].Reason != cachekey.SemanticCacheReasonHardNegative {
			t.Fatalf("support_refund hard negative lookup reason 불일치: %+v", harness.semantic.searchResults)
		}
		assertGateLMResponseDoesNotExposeSemanticCache(t, second)
		resp := decodeSemanticChatResponse(t, second)
		if resp.GateLM == nil || !resp.GateLM.ProviderCalled {
			t.Fatalf("support_refund hard negative metadata 불일치: %+v", resp.GateLM)
		}
	})
}

func TestChatCompletionsSemanticCacheEmbeddingInputNormalization(t *testing.T) {
	t.Run("uses last user message after masking", func(t *testing.T) {
		harness := newSemanticCacheHarness(t, true)

		rr := harness.exercise(t, "sc_embedding_input_last_user", routingAwareChatBodyWithMessages("auto", []provider.ChatMessage{
			{Role: "system", Content: json.RawMessage(jsonStringLiteral("system 지시는 embedding input에 섞이면 안 됨"))},
			{Role: "user", Content: json.RawMessage(jsonStringLiteral("사용량은 어디서 확인해?"))},
			{Role: "assistant", Content: json.RawMessage(jsonStringLiteral("assistant 응답도 제외되어야 함"))},
			{Role: "developer", Content: json.RawMessage(jsonStringLiteral("developer 지시도 제외되어야 함"))},
			{Role: "user", Content: json.RawMessage(jsonStringLiteral("패스워드 초기화는 어떻게 해?"))},
		}))

		if rr.Code != http.StatusOK {
			t.Fatalf("multi-turn 요청은 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
		}
		if harness.semantic.searchCalls != 1 || len(harness.semantic.lookupRequests) != 1 {
			t.Fatalf("semantic lookup이 1번 실행되어야 함: search=%d requests=%+v", harness.semantic.searchCalls, harness.semantic.lookupRequests)
		}
		embeddingText := harness.semantic.lookupRequests[0].NormalizedText
		if embeddingText != "패스워드 초기화는 어떻게 해?" {
			t.Fatalf("embedding input은 마지막 user message만 사용해야 함: %q", embeddingText)
		}
		for _, excluded := range []string{"system 지시", "사용량은 어디서 확인해?", "assistant 응답", "developer 지시"} {
			if strings.Contains(embeddingText, excluded) {
				t.Fatalf("embedding input에 제외 대상 message가 섞이면 안 됨: marker=%q input=%q", excluded, embeddingText)
			}
		}
	})

	t.Run("code block like input bypasses semantic lookup even when category is general", func(t *testing.T) {
		harness := newSemanticCacheHarness(t, true)
		harness.routes["sc_embedding_input_code_block"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategoryGeneral}

		rr := harness.exercise(t, "sc_embedding_input_code_block", routingAwareChatBody("auto", "다음 내용을 확인해줘\n```ts\nconst value = 1\n```"))

		if rr.Code != http.StatusOK {
			t.Fatalf("code block 포함 요청도 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
		}
		if harness.semantic.searchCalls != 0 || harness.semantic.upsertCalls != 0 {
			t.Fatalf("code block like input은 semantic lookup/store 전에 제외되어야 함: search=%d upsert=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls)
		}
		logged := harness.latestLog(t)
		if logged.SemanticCacheDecisionReason != cachekey.SemanticCacheReasonEmbeddingInputCodeLike {
			t.Fatalf("code block semantic bypass reason 불일치: %q", logged.SemanticCacheDecisionReason)
		}
	})
}

func TestChatCompletionsSemanticCacheTenantProjectApplicationIsolation(t *testing.T) {
	semantic := newCountingSemanticCacheService(t, true)
	first := newSemanticCacheHarnessWithIdentity(t, semantic, "tenant-a", "project-a", "app-a")
	second := newSemanticCacheHarnessWithIdentity(t, semantic, "tenant-b", "project-a", "app-a")

	first.exercise(t, "sc_isolation_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
	rr := second.exercise(t, "sc_isolation_second", routingAwareChatBody("auto", "패스워드 초기화는 어떻게 해?"))

	if rr.Code != http.StatusOK {
		t.Fatalf("tenant가 달라도 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if second.provider.calls != 1 {
		t.Fatalf("tenant가 다르면 semantic hit 금지: calls=%d", second.provider.calls)
	}
	for _, mutate := range []struct {
		name string
		make func(*countingSemanticCacheService) (*semanticCacheHarness, *semanticCacheHarness)
	}{
		{name: "project", make: func(s *countingSemanticCacheService) (*semanticCacheHarness, *semanticCacheHarness) {
			return newSemanticCacheHarnessWithIdentity(t, s, "tenant-c", "project-a", "app-a"), newSemanticCacheHarnessWithIdentity(t, s, "tenant-c", "project-b", "app-a")
		}},
		{name: "application", make: func(s *countingSemanticCacheService) (*semanticCacheHarness, *semanticCacheHarness) {
			return newSemanticCacheHarnessWithIdentity(t, s, "tenant-d", "project-d", "app-a"), newSemanticCacheHarnessWithIdentity(t, s, "tenant-d", "project-d", "app-b")
		}},
	} {
		t.Run(mutate.name, func(t *testing.T) {
			shared := newCountingSemanticCacheService(t, true)
			a, b := mutate.make(shared)
			a.exercise(t, "sc_"+mutate.name+"_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
			b.exercise(t, "sc_"+mutate.name+"_second", routingAwareChatBody("auto", "패스워드 초기화는 어떻게 해?"))
			if b.provider.calls != 1 {
				t.Fatalf("%s가 다르면 semantic hit 금지: calls=%d", mutate.name, b.provider.calls)
			}
		})
	}
}

func TestChatCompletionsSemanticCacheSelectedProviderIdIsolation(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)
	harness.routes["sc_provider_first"] = routingAwareRoute{providerName: "provider-a", modelID: "model_shared"}
	harness.routes["sc_provider_second"] = routingAwareRoute{providerName: "provider-b", modelID: "model_shared"}

	harness.exercise(t, "sc_provider_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
	harness.exercise(t, "sc_provider_second", routingAwareChatBody("auto", "패스워드 초기화는 어떻게 해?"))

	if harness.provider.calls != 2 {
		t.Fatalf("selectedProviderId가 다르면 semantic hit 금지: calls=%d", harness.provider.calls)
	}
}

func TestChatCompletionsSemanticCacheSelectedModelIdIsolation(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)
	harness.routes["sc_model_first"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low"}
	harness.routes["sc_model_second"] = routingAwareRoute{providerName: "provider-a", modelID: "model_balanced"}

	harness.exercise(t, "sc_model_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
	harness.exercise(t, "sc_model_second", routingAwareChatBody("auto", "패스워드 초기화는 어떻게 해?"))

	if harness.provider.calls != 2 {
		t.Fatalf("selectedModelId가 다르면 semantic hit 금지: calls=%d", harness.provider.calls)
	}
}

func TestChatCompletionsSemanticCacheRoutingPolicyHashIsolation(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)
	harness.routes["sc_policy_first"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", routingPolicyHash: "route-a"}
	harness.routes["sc_policy_second"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", routingPolicyHash: "route-b"}

	harness.exercise(t, "sc_policy_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
	harness.exercise(t, "sc_policy_second", routingAwareChatBody("auto", "패스워드 초기화는 어떻게 해?"))

	if harness.provider.calls != 2 {
		t.Fatalf("routingPolicyHash가 다르면 semantic hit 금지: calls=%d", harness.provider.calls)
	}
}

func TestChatCompletionsSemanticCacheRoutingDecisionKeyHashIsolation(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)
	harness.routes["sc_decision_first"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", decisionHash: "sha256:decision-a"}
	harness.routes["sc_decision_second"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", decisionHash: "sha256:decision-b"}

	harness.exercise(t, "sc_decision_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
	harness.exercise(t, "sc_decision_second", routingAwareChatBody("auto", "패스워드 초기화는 어떻게 해?"))

	if harness.provider.calls != 2 {
		t.Fatalf("routingDecisionKeyHash가 다르면 semantic hit 금지: calls=%d", harness.provider.calls)
	}
}

func TestChatCompletionsSemanticCachePromptCategoryIsolation(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)
	harness.routes["sc_category_boundary_first"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategoryGeneral}
	harness.routes["sc_category_boundary_second"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategorySupportRefund}

	harness.exercise(t, "sc_category_boundary_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
	harness.exercise(t, "sc_category_boundary_second", routingAwareChatBody("auto", "배송비도 환불되나요?"))

	if harness.provider.calls != 2 {
		t.Fatalf("promptCategory가 다르면 semantic hit 금지: calls=%d", harness.provider.calls)
	}
	if len(harness.semantic.searchResults) < 2 || harness.semantic.searchResults[1].Reason != cachekey.SemanticCacheReasonNoBoundaryMatch {
		t.Fatalf("promptCategory 차이는 boundary miss로 기록되어야 함: %+v", harness.semantic.searchResults)
	}
}

func TestChatCompletionsSemanticCacheStreamBypassesLookupAndStore(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)

	rr := harness.exercise(t, "sc_stream", routingAwareStreamBody("auto", "비밀번호 재설정 방법 알려줘"))

	if rr.Code != http.StatusOK {
		t.Fatalf("stream 요청은 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.semantic.searchCalls != 0 || harness.semantic.upsertCalls != 0 {
		t.Fatalf("stream=true는 semantic lookup/store 금지: search=%d upsert=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls)
	}
	if logged := harness.latestLog(t); logged.SemanticCacheDecisionReason != "streaming_request" {
		t.Fatalf("stream bypass reason 불일치: %q", logged.SemanticCacheDecisionReason)
	}
}

func TestChatCompletionsSemanticCacheFallbackResponseDoesNotStore(t *testing.T) {
	primary := &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock, err: provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, context.DeadlineExceeded)}
	fallback := &routingAwareProviderAdapter{adapterType: "mock-fallback-adapter"}
	harness := newSemanticCacheHarnessWithProvider(t, true, primary, fallback)
	harness.catalog.Providers[0].AdapterType = providercatalog.AdapterTypeMock
	harness.catalog.Providers[1].AdapterType = "mock-fallback-adapter"
	harness.handler.ProviderCatalogResolver = staticprovidercatalog.NewResolver(harness.catalog)

	first := harness.exercise(t, "sc_fallback_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
	second := harness.exercise(t, "sc_fallback_second", routingAwareChatBody("auto", "패스워드 초기화는 어떻게 해?"))

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("fallback success 요청은 성공해야 함: first=%d second=%d body=%s", first.Code, second.Code, second.Body.String())
	}
	if harness.semantic.upsertCalls != 0 {
		t.Fatalf("fallback 응답은 semantic cache store 금지: upsert=%d", harness.semantic.upsertCalls)
	}
	if fallback.calls != 2 {
		t.Fatalf("fallback 응답이 semantic hit로 반환되면 안 됨: fallback_calls=%d", fallback.calls)
	}
}

func TestChatCompletionsSemanticCacheProviderErrorDoesNotStore(t *testing.T) {
	primary := &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock, err: provider.NewError(provider.ErrorKindUnauthorized, provider.ErrorCodeProviderUnauthorized, errors.New("unauthorized"))}
	harness := newSemanticCacheHarnessWithProvider(t, true, primary)

	rr := harness.exercise(t, "sc_provider_error", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))

	if rr.Code != http.StatusBadGateway {
		t.Fatalf("provider error는 bad gateway여야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.semantic.upsertCalls != 0 {
		t.Fatalf("provider error 응답은 semantic cache store 금지: upsert=%d", harness.semantic.upsertCalls)
	}
}

func TestChatCompletionsSemanticCacheSafetyBlockBypassesLookupAndStore(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)

	rr := harness.exercise(t, "sc_safety_block", routingAwareChatBody("auto", "api_key=test_secret_token_redacted_for_demo_only_1234567890"))

	if rr.Code != http.StatusForbidden {
		t.Fatalf("secret-like prompt는 safety block되어야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.semantic.searchCalls != 0 || harness.semantic.upsertCalls != 0 || harness.provider.calls != 0 {
		t.Fatalf("safety block은 semantic/provider 호출 금지: search=%d upsert=%d provider=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls, harness.provider.calls)
	}
}

func TestChatCompletionsSemanticCacheAuthFailureBypassesLookupAndStore(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘")))
	req.Header.Set(middleware.RequestIDHeader, "sc_auth_failure")
	rr := httptest.NewRecorder()
	harness.handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("auth failure는 unauthorized여야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.semantic.searchCalls != 0 || harness.semantic.upsertCalls != 0 || harness.provider.calls != 0 {
		t.Fatalf("auth failure는 semantic/provider 호출 금지: search=%d upsert=%d provider=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls, harness.provider.calls)
	}
}

func TestChatCompletionsSemanticCacheDoesNotPersistRawPromptOrSecrets(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)
	rawPrompt := "plain safe semantic prompt must not appear in semantic key value log"

	rr := harness.exercise(t, "sc_privacy", routingAwareChatBody("auto", rawPrompt))

	if rr.Code != http.StatusOK {
		t.Fatalf("safe prompt 요청은 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.semantic.upsertCalls != 1 {
		t.Fatalf("safe prompt는 semantic store 후보여야 함: upsert=%d", harness.semantic.upsertCalls)
	}
	boundaryPayload, err := json.Marshal(harness.semantic.storeRequests[0].Boundary)
	if err != nil {
		t.Fatalf("semantic boundary marshal 실패: %v", err)
	}
	logPayload, err := json.Marshal(harness.latestLog(t))
	if err != nil {
		t.Fatalf("terminal log marshal 실패: %v", err)
	}
	forbidden := []string{
		rawPrompt,
		testAPIKey,
		testAppToken,
		"api_key=",
		"provider_key=",
		"Authorization:",
		"provider raw body",
		"provider raw error",
	}
	for _, marker := range forbidden {
		if strings.Contains(string(boundaryPayload), marker) ||
			strings.Contains(string(harness.semantic.storeRequests[0].CachedResponse), marker) ||
			strings.Contains(string(logPayload), marker) {
			t.Fatalf("semantic cache key/value/log에 forbidden marker가 남으면 안 됨: marker=%q boundary=%s log=%s", marker, boundaryPayload, logPayload)
		}
	}
}

func TestChatCompletionsSemanticCacheOpenAIEmbeddingFailureContinuesProviderFlow(t *testing.T) {
	semantic := newCountingSemanticCacheServiceWithEmbeddingProvider(t, true, failingOpenAIEmbeddingProvider{})
	harness := newSemanticCacheHarnessWithService(t, semantic, &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock})

	rr := harness.exercise(t, "sc_openai_embedding_failure", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))

	if rr.Code != http.StatusOK {
		t.Fatalf("OpenAI embedding 실패는 Gateway 요청 실패로 승격되면 안 됨: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.semantic.searchCalls != 1 {
		t.Fatalf("semantic lookup은 1번 시도되어야 함: search=%d", harness.semantic.searchCalls)
	}
	if harness.semantic.upsertCalls != 0 {
		t.Fatalf("embedding 실패 후 provider 성공 응답은 semantic store를 시도하면 안 됨: upsert=%d", harness.semantic.upsertCalls)
	}
	if harness.provider.calls != 1 {
		t.Fatalf("embedding 실패 후에도 provider flow는 계속되어야 함: calls=%d", harness.provider.calls)
	}
	assertGateLMResponseDoesNotExposeSemanticCache(t, rr)
	resp := decodeSemanticChatResponse(t, rr)
	if resp.GateLM == nil || !resp.GateLM.ProviderCalled {
		t.Fatalf("embedding 실패 응답 metadata 불일치: %+v", resp.GateLM)
	}
	logged := harness.latestLog(t)
	if logged.SemanticCacheDecisionReason != cachekey.SemanticCacheReasonEmbeddingFailure {
		t.Fatalf("embedding 실패 reason은 안전한 decision 값이어야 함: %q", logged.SemanticCacheDecisionReason)
	}
	if logged.EmbeddingProvider != cachekey.SemanticCacheEmbeddingProviderOpenAI {
		t.Fatalf("embedding provider log 불일치: %q", logged.EmbeddingProvider)
	}
	logPayload, err := json.Marshal(logged)
	if err != nil {
		t.Fatalf("terminal log marshal 실패: %v", err)
	}
	for _, forbidden := range []string{"Authorization", "OPENAI_API_KEY", "openai raw error body", "test_openai_api_key_redacted"} {
		if strings.Contains(string(logPayload), forbidden) {
			t.Fatalf("embedding 실패 log에 forbidden marker가 남으면 안 됨: marker=%q log=%s", forbidden, logPayload)
		}
	}
}

type semanticCacheHarness struct {
	handler    *ChatCompletionsHandler
	catalog    providercatalog.Catalog
	provider   *routingAwareProviderAdapter
	semantic   *countingSemanticCacheService
	classifier *countingCacheabilityClassifier
	logWriter  *recordingTerminalLogWriter
	cacheStore *routingAwareMemoryStore
	keyBuilder *routingAwareRecordingExactKeyBuilder
	routes     map[string]routingAwareRoute
}

func newSemanticCacheHarness(t *testing.T, enabled bool) *semanticCacheHarness {
	t.Helper()
	return newSemanticCacheHarnessWithProvider(t, enabled, &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock})
}

func newSemanticCacheHarnessWithIdentity(t *testing.T, semantic *countingSemanticCacheService, tenantID string, projectID string, applicationID string) *semanticCacheHarness {
	t.Helper()
	harness := newSemanticCacheHarnessWithService(t, semantic, &routingAwareProviderAdapter{adapterType: providercatalog.AdapterTypeMock})
	withSemanticTestAuth(harness.handler, tenantID, projectID, applicationID)
	return harness
}

func newSemanticCacheHarnessWithProvider(t *testing.T, enabled bool, adapters ...*routingAwareProviderAdapter) *semanticCacheHarness {
	t.Helper()
	return newSemanticCacheHarnessWithService(t, newCountingSemanticCacheService(t, enabled), adapters...)
}

func newSemanticCacheHarnessWithService(t *testing.T, semantic *countingSemanticCacheService, adapters ...*routingAwareProviderAdapter) *semanticCacheHarness {
	t.Helper()
	catalog := routingAwareCatalog("sha256:semantic-cache-catalog")
	if len(adapters) == 0 {
		adapters = []*routingAwareProviderAdapter{{adapterType: providercatalog.AdapterTypeMock}}
	}
	registryAdapters := make([]provider.Adapter, 0, len(adapters))
	for _, adapter := range adapters {
		registryAdapters = append(registryAdapters, adapter)
	}
	cacheStore := &routingAwareMemoryStore{entries: map[string]ports.CacheEntry{}}
	keyBuilder := &routingAwareRecordingExactKeyBuilder{delegate: cachekey.NewExactKeyBuilder([]byte("semantic-cache-exact-secret"))}
	logWriter := &recordingTerminalLogWriter{}
	classifier := &countingCacheabilityClassifier{
		result: &cachekey.CacheabilityClassifierResult{
			Label:        cachekey.CacheabilityLabelCacheableStatic,
			Confidence:   0.95,
			ReasonCode:   cachekey.CacheabilityReasonStaticStub,
			ModelVersion: cachekey.CacheabilityClassifierStubModelVersion,
		},
	}
	harness := &semanticCacheHarness{
		catalog:    catalog,
		provider:   adapters[0],
		semantic:   semantic,
		classifier: classifier,
		logWriter:  logWriter,
		cacheStore: cacheStore,
		keyBuilder: keyBuilder,
		routes:     map[string]routingAwareRoute{},
	}
	handler := &ChatCompletionsHandler{
		Providers:                    provider.NewRegistry(providercatalog.AdapterTypeMock, registryAdapters...),
		ProviderCatalogResolver:      staticprovidercatalog.NewResolver(catalog),
		DefaultProvider:              "provider-a",
		DefaultModel:                 "model_low",
		PreProviderPipeline:          routingAwarePipeline{catalog: catalog, routes: harness.routes},
		ExactCacheStore:              cacheStore,
		ExactCacheKeyBuilder:         keyBuilder,
		CachePolicyHash:              "cache_policy_semantic_test",
		TerminalLogWriter:            logWriter,
		SemanticCacheService:         semantic,
		SemanticCacheEnabled:         semantic.Enabled(),
		SemanticCacheMode:            cachekey.SemanticCacheModeEnforce,
		SemanticCacheAllowCategories: []string{cachekey.SemanticCacheCategoryGeneral, cachekey.SemanticCacheCategorySupportRefund},
		SemanticCacheDenyCategories: []string{
			cachekey.SemanticCacheCategoryCode,
			cachekey.SemanticCacheCategoryTranslation,
			cachekey.SemanticCacheCategoryReasoning,
			cachekey.SemanticCacheCategorySensitive,
			cachekey.SemanticCacheCategoryToolCall,
			cachekey.SemanticCacheCategoryUnknown,
		},
		SemanticCachePolicyVersion:           "v1",
		SemanticCacheKeyVersion:              "v1",
		SemanticCacheClassifier:              classifier,
		SemanticCacheClassifierMinConfidence: 0.90,
		SemanticCacheClassifierTimeout:       30 * time.Millisecond,
	}
	withTestAuth(handler)
	harness.handler = handler
	return harness
}

func (h *semanticCacheHarness) exercise(t *testing.T, requestID string, body string) *httptest.ResponseRecorder {
	t.Helper()
	h.handler.PreProviderPipeline = routingAwarePipeline{catalog: h.catalog, routes: h.routes}
	return routingAwareExercise(t, h.handler, requestID, body)
}

func (h *semanticCacheHarness) latestLog(t *testing.T) invocationlog.TerminalLog {
	t.Helper()
	if len(h.logWriter.logs) == 0 {
		t.Fatalf("terminal log가 남아야 함")
	}
	return h.logWriter.logs[len(h.logWriter.logs)-1]
}

func routingAwareChatBodyWithMessages(model string, messages []provider.ChatMessage) string {
	body, _ := json.Marshal(provider.ChatCompletionRequest{
		Model:    model,
		Messages: messages,
	})
	return string(body)
}

func configureGeneralOnlySemanticCanary(h *semanticCacheHarness) {
	h.handler.SemanticCacheEnabled = true
	h.handler.SemanticCacheMode = cachekey.SemanticCacheModeEnforce
	h.handler.SemanticCacheAllowedTenantIDs = []string{"tenant_demo"}
	h.handler.SemanticCacheAllowedApplicationIDs = []string{"app_demo"}
	h.handler.SemanticCacheAllowedCategories = []string{cachekey.SemanticCacheCategoryGeneral}
}

func assertSemanticCacheRuntimeOutputDoesNotLeakForbiddenMarkers(t *testing.T, rr *httptest.ResponseRecorder, logged invocationlog.TerminalLog, prompts ...string) {
	t.Helper()
	logPayload, err := json.Marshal(logged)
	if err != nil {
		t.Fatalf("terminal log marshal 실패: %v", err)
	}
	payloads := []string{rr.Body.String(), string(logPayload)}
	for _, marker := range append([]string{
		testAPIKey,
		testAppToken,
		"api_key=",
		"app_token=",
		"provider_key=",
		"Authorization:",
		"provider raw error",
		"actual secret",
	}, prompts...) {
		if strings.TrimSpace(marker) == "" {
			continue
		}
		for _, payload := range payloads {
			if strings.Contains(payload, marker) {
				t.Fatalf("semantic cache runtime output에 forbidden marker가 남으면 안 됨: marker=%q payload=%s", marker, payload)
			}
		}
	}
}

func assertGateLMResponseDoesNotExposeSemanticCache(t *testing.T, rr *httptest.ResponseRecorder) {
	t.Helper()
	body := rr.Body.String()
	for _, key := range []string{
		"semanticCacheHit",
		"semanticCacheMode",
		"semanticCacheWouldHit",
		"semanticCacheWouldMiss",
		"semanticCandidateFound",
		"semanticReturnedFromCache",
		"semanticSimilarity",
		"semanticMatchedRequestId",
		"semanticCacheThreshold",
		"semanticCachePolicyVersion",
		"semanticCacheDecisionReason",
	} {
		if strings.Contains(body, `"`+key+`"`) {
			t.Fatalf("gate_lm response must not expose semantic cache evidence key %q: body=%s", key, body)
		}
	}
}

type countingSemanticCacheService struct {
	service        cachekey.SemanticCacheService
	searchCalls    int
	upsertCalls    int
	lookupRequests []cachekey.SemanticCacheLookupRequest
	storeRequests  []cachekey.SemanticCacheStoreRequest
	searchResults  []cachekey.SemanticCacheSearchResult
}

func newCountingSemanticCacheService(t *testing.T, enabled bool) *countingSemanticCacheService {
	t.Helper()
	return newCountingSemanticCacheServiceWithEmbeddingProvider(t, enabled, cachekey.NewFakeEmbeddingProvider("fake-test"))
}

func newCountingSemanticCacheServiceWithEmbeddingProvider(t *testing.T, enabled bool, embeddingProvider cachekey.EmbeddingProvider) *countingSemanticCacheService {
	t.Helper()
	store := cachekey.NewInMemorySemanticCacheStore(100)
	storePolicy := cachekey.DefaultSemanticCacheStorePolicy()
	service := cachekey.NewSemanticCacheService(store, embeddingProvider, cachekey.SemanticCacheServiceConfig{
		Enabled:       enabled,
		Threshold:     0.92,
		TopK:          3,
		TTL:           time.Hour,
		PolicyVersion: "v1",
		HitPolicy:     testHandlerSemanticHitPolicy(t),
		StorePolicy:   &storePolicy,
	})
	return &countingSemanticCacheService{service: service}
}

func testHandlerSemanticHitPolicy(t *testing.T) *cachekey.SemanticCacheHitPolicy {
	t.Helper()
	policy, err := cachekey.LoadSemanticCacheHitPolicyFile(filepath.Join("..", "..", "domain", "cache", "testdata", "semantic_cache_policy_ko_v1.json"))
	if err != nil {
		t.Fatalf("semantic cache test policy 로드 실패: %v", err)
	}
	return &policy
}

type countingSemanticEmbeddingProvider struct {
	delegate cachekey.FakeEmbeddingProvider
	calls    int
}

type countingCacheabilityClassifier struct {
	delegate cachekey.CacheabilityClassifier
	result   *cachekey.CacheabilityClassifierResult
	err      error
	calls    int
	requests []cachekey.CacheabilityClassificationRequest
}

type fastTextSidecarHandlerTestServer struct {
	mu       sync.Mutex
	requests []string
}

func newFastTextSidecarClassifierForHandlerTest(t *testing.T, classify func(text string) (cachekey.CacheabilityLabel, float64)) (cachekey.CacheabilityClassifier, *fastTextSidecarHandlerTestServer) {
	t.Helper()
	sidecar := &fastTextSidecarHandlerTestServer{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("fasttext sidecar method 불일치: %s", r.Method)
		}
		var payload struct {
			Text           string `json:"text"`
			PromptCategory string `json:"promptCategory"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("fasttext sidecar request decode 실패: %v", err)
		}
		text := strings.TrimSpace(payload.Text)
		sidecar.mu.Lock()
		sidecar.requests = append(sidecar.requests, text)
		sidecar.mu.Unlock()
		label, confidence := classify(text)
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{
			"label":        string(label),
			"confidence":   confidence,
			"reasonCode":   cachekey.CacheabilityReasonFastTextSidecar,
			"modelVersion": "cacheability-fasttext-synthetic-v1",
		}); err != nil {
			t.Fatalf("fasttext sidecar response encode 실패: %v", err)
		}
	}))
	t.Cleanup(server.Close)

	classifier, err := cachekey.NewFastTextSidecarCacheabilityClassifier(cachekey.FastTextSidecarCacheabilityClassifierConfig{
		Endpoint:   server.URL,
		HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatalf("fasttext sidecar classifier 생성 실패: %v", err)
	}
	return classifier, sidecar
}

func (s *fastTextSidecarHandlerTestServer) requestCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.requests)
}

func (c *countingCacheabilityClassifier) Classify(ctx context.Context, request cachekey.CacheabilityClassificationRequest) (cachekey.CacheabilityClassifierResult, error) {
	c.calls++
	c.requests = append(c.requests, request)
	if c.err != nil {
		return cachekey.CacheabilityClassifierResult{}, c.err
	}
	if c.result != nil {
		return *c.result, nil
	}
	if c.delegate != nil {
		return c.delegate.Classify(ctx, request)
	}
	return cachekey.NoopCacheabilityClassifier{}.Classify(ctx, request)
}

type runtimeCachePolicyHashPipeline struct {
	hash string
}

func (p runtimeCachePolicyHashPipeline) Execute(_ context.Context, gatewayCtx *request.GatewayContext) error {
	gatewayCtx.Runtime.CachePolicy = runtimeconfig.CachePolicy{
		Enabled:         true,
		Type:            runtimeconfig.CacheTypeExact,
		TTLSeconds:      600,
		CachePolicyHash: p.hash,
	}
	gatewayCtx.Runtime.HasCachePolicy = true
	return nil
}

func (p *countingSemanticEmbeddingProvider) Embed(ctx context.Context, input cachekey.EmbeddingInput) (cachekey.EmbeddingResult, error) {
	p.calls++
	return p.delegate.Embed(ctx, input)
}

func (p *countingSemanticEmbeddingProvider) ProviderName() string {
	return p.delegate.ProviderName()
}

func (p *countingSemanticEmbeddingProvider) ModelName() string {
	return p.delegate.ModelName()
}

type supportRefundSemanticEmbeddingProvider struct {
	delegate cachekey.FakeEmbeddingProvider
}

func (p supportRefundSemanticEmbeddingProvider) Embed(ctx context.Context, input cachekey.EmbeddingInput) (cachekey.EmbeddingResult, error) {
	if err := ctx.Err(); err != nil {
		return cachekey.EmbeddingResult{}, err
	}
	normalized := strings.ToLower(input.NormalizedText)
	if strings.Contains(normalized, "배송비") ||
		strings.Contains(normalized, "반품") ||
		strings.Contains(normalized, "주문 취소") {
		return cachekey.EmbeddingResult{Vector: []float64{0, 0, 1, 0, 0, 0}, Model: p.ModelName()}, nil
	}
	return p.delegate.Embed(ctx, input)
}

func (p supportRefundSemanticEmbeddingProvider) ProviderName() string {
	return p.delegate.ProviderName()
}

func (p supportRefundSemanticEmbeddingProvider) ModelName() string {
	return p.delegate.ModelName()
}

type failingOpenAIEmbeddingProvider struct{}

func (failingOpenAIEmbeddingProvider) Embed(ctx context.Context, input cachekey.EmbeddingInput) (cachekey.EmbeddingResult, error) {
	return cachekey.EmbeddingResult{}, cachekey.ErrOpenAIEmbeddingRequestFailed
}

func (failingOpenAIEmbeddingProvider) ProviderName() string {
	return cachekey.SemanticCacheEmbeddingProviderOpenAI
}

func (failingOpenAIEmbeddingProvider) ModelName() string {
	return "text-embedding-3-small"
}

func (s *countingSemanticCacheService) Enabled() bool {
	return s.service.Enabled()
}

func (s *countingSemanticCacheService) Threshold() float64 {
	return s.service.Threshold()
}

func (s *countingSemanticCacheService) PolicyVersion() string {
	return s.service.PolicyVersion()
}

func (s *countingSemanticCacheService) EmbeddingProviderName() string {
	return s.service.EmbeddingProviderName()
}

func (s *countingSemanticCacheService) Search(ctx context.Context, request cachekey.SemanticCacheLookupRequest) (cachekey.SemanticCacheSearchResult, cachekey.SemanticCacheDecision, error) {
	s.searchCalls++
	s.lookupRequests = append(s.lookupRequests, request)
	result, decision, err := s.service.Search(ctx, request)
	s.searchResults = append(s.searchResults, result)
	return result, decision, err
}

func (s *countingSemanticCacheService) Upsert(ctx context.Context, request cachekey.SemanticCacheStoreRequest) (cachekey.SemanticCacheDecision, error) {
	s.upsertCalls++
	request.CachedResponse = append([]byte(nil), request.CachedResponse...)
	s.storeRequests = append(s.storeRequests, request)
	return s.service.Upsert(ctx, request)
}

func (s *countingSemanticCacheService) resetCounts() {
	s.searchCalls = 0
	s.upsertCalls = 0
	s.lookupRequests = nil
	s.storeRequests = nil
	s.searchResults = nil
}

func decodeSemanticChatResponse(t *testing.T, rr *httptest.ResponseRecorder) provider.ChatCompletionResponse {
	t.Helper()
	var resp provider.ChatCompletionResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("chat completion response decode 실패: %v body=%s", err, rr.Body.String())
	}
	return resp
}

func withSemanticTestAuth(handler *ChatCompletionsHandler, tenantID string, projectID string, applicationID string) {
	store := auth.NewStaticCredentialStore(auth.StaticCredentialConfig{
		APIKey:   testAPIKey,
		AppToken: testAppToken,
		APIKeyIdentity: auth.APIKeyIdentity{
			APIKeyID:      testAPIKeyID,
			TenantID:      tenantID,
			ProjectID:     projectID,
			ApplicationID: applicationID,
		},
		AppTokenIdentity: auth.AppTokenIdentity{
			AppTokenID:    testAppTokenID,
			TenantID:      tenantID,
			ProjectID:     projectID,
			ApplicationID: applicationID,
		},
	})
	handler.APIKeyAuthenticator = store
	handler.AppTokenValidator = store
	handler.ExpectedTenantID = tenantID
	handler.ExpectedProjectID = projectID
	handler.ExpectedAppID = applicationID
}
