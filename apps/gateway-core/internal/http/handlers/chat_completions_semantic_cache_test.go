package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	staticprovidercatalog "gatelm/apps/gateway-core/internal/adapters/providercatalog/static"
	"gatelm/apps/gateway-core/internal/domain/auth"
	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
	routingdomain "gatelm/apps/gateway-core/internal/domain/routing"
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
	resp := decodeSemanticChatResponse(t, second)
	if resp.GateLM == nil || resp.GateLM.CacheType != invocationlog.CacheTypeSemantic || !resp.GateLM.SemanticCacheHit || resp.GateLM.ProviderCalled {
		t.Fatalf("semantic hit metadata 불일치: %+v", resp.GateLM)
	}
	if resp.GateLM.SemanticMatchedRequestID != "sc_hit_first" {
		t.Fatalf("semanticMatchedRequestId는 첫 요청이어야 함: %q", resp.GateLM.SemanticMatchedRequestID)
	}
	logged := harness.latestLog(t)
	if logged.CacheType != invocationlog.CacheTypeSemantic || logged.CacheStatus != invocationlog.CacheStatusHit || !logged.SemanticCacheHit {
		t.Fatalf("semantic hit가 request log에 남아야 함: %+v", logged)
	}
}

func TestChatCompletionsSemanticCacheThresholdMissCallsProvider(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)

	harness.exercise(t, "sc_threshold_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
	rr := harness.exercise(t, "sc_threshold_second", routingAwareChatBody("auto", "이번 달 사용량 통계를 보여줘"))

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
	second := harness.exercise(t, "sc_exact_second", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("두 요청 모두 성공해야 함: first=%d second=%d body=%s", first.Code, second.Code, second.Body.String())
	}
	if harness.semantic.searchCalls != 0 || harness.semantic.upsertCalls != 0 {
		t.Fatalf("exact cache hit이면 semantic lookup/store 금지: search=%d upsert=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls)
	}
	resp := decodeSemanticChatResponse(t, second)
	if resp.GateLM == nil || resp.GateLM.CacheType != invocationlog.CacheTypeExact || resp.GateLM.ProviderCalled {
		t.Fatalf("exact cache hit metadata 불일치: %+v", resp.GateLM)
	}
}

func TestChatCompletionsSemanticCacheCategoryDenylistBypasses(t *testing.T) {
	harness := newSemanticCacheHarness(t, true)
	harness.routes["sc_category_code"] = routingAwareRoute{providerName: "provider-a", modelID: "model_low", category: routingdomain.CategoryCode}

	rr := harness.exercise(t, "sc_category_code", routingAwareChatBody("auto", "```ts\nconst value = 1\n```"))

	if rr.Code != http.StatusOK {
		t.Fatalf("deny category 요청도 provider flow로 성공해야 함: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if harness.semantic.searchCalls != 0 || harness.semantic.upsertCalls != 0 {
		t.Fatalf("deny category는 semantic lookup/store 금지: search=%d upsert=%d", harness.semantic.searchCalls, harness.semantic.upsertCalls)
	}
	logged := harness.latestLog(t)
	if logged.PromptCategory != routingdomain.CategoryCode || logged.SemanticCacheDecisionReason != "semantic_category_disabled" {
		t.Fatalf("category bypass reason 불일치: category=%q reason=%q", logged.PromptCategory, logged.SemanticCacheDecisionReason)
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
		resp := decodeSemanticChatResponse(t, second)
		if resp.GateLM == nil || !resp.GateLM.SemanticCacheHit || resp.GateLM.CacheType != invocationlog.CacheTypeSemantic {
			t.Fatalf("한국어 유사 요청 semantic hit metadata 불일치: %+v", resp.GateLM)
		}
	})

	t.Run("unrelated request misses", func(t *testing.T) {
		harness := newSemanticCacheHarness(t, true)

		harness.exercise(t, "sc_ko_miss_first", routingAwareChatBody("auto", "비밀번호 재설정 방법 알려줘"))
		rr := harness.exercise(t, "sc_ko_miss_second", routingAwareChatBody("auto", "이번 달 사용량 통계를 보여줘"))

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
}

func TestChatCompletionsSemanticCacheTenantProjectApplicationIsolation(t *testing.T) {
	semantic := newCountingSemanticCacheService(true)
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
			shared := newCountingSemanticCacheService(true)
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

type semanticCacheHarness struct {
	handler    *ChatCompletionsHandler
	catalog    providercatalog.Catalog
	provider   *routingAwareProviderAdapter
	semantic   *countingSemanticCacheService
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
	return newSemanticCacheHarnessWithService(t, newCountingSemanticCacheService(enabled), adapters...)
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
	harness := &semanticCacheHarness{
		catalog:    catalog,
		provider:   adapters[0],
		semantic:   semantic,
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
		SemanticCacheAllowCategories: []string{cachekey.SemanticCacheCategoryGeneral, cachekey.SemanticCacheCategorySupportRefund},
		SemanticCacheDenyCategories: []string{
			cachekey.SemanticCacheCategoryCode,
			cachekey.SemanticCacheCategoryTranslation,
			cachekey.SemanticCacheCategoryReasoning,
			cachekey.SemanticCacheCategorySensitive,
			cachekey.SemanticCacheCategoryToolCall,
			cachekey.SemanticCacheCategoryUnknown,
		},
		SemanticCachePolicyVersion: "v1",
		SemanticCacheKeyVersion:    "v1",
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

type countingSemanticCacheService struct {
	service        cachekey.SemanticCacheService
	searchCalls    int
	upsertCalls    int
	lookupRequests []cachekey.SemanticCacheLookupRequest
	storeRequests  []cachekey.SemanticCacheStoreRequest
	searchResults  []cachekey.SemanticCacheSearchResult
}

func newCountingSemanticCacheService(enabled bool) *countingSemanticCacheService {
	store := cachekey.NewInMemorySemanticCacheStore(100)
	embeddingProvider := cachekey.NewFakeEmbeddingProvider("fake-test")
	service := cachekey.NewSemanticCacheService(store, embeddingProvider, cachekey.SemanticCacheServiceConfig{
		Enabled:       enabled,
		Threshold:     0.92,
		TopK:          3,
		TTL:           time.Hour,
		PolicyVersion: "v1",
	})
	return &countingSemanticCacheService{service: service}
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
