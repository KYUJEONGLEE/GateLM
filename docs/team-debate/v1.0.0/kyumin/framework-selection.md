# GateLM v1.0.0 프레임워크 선택 의견

## 내 입장

확장성을 중요하게 본다면 기술스택은 "지금 빨리 만들 수 있는가"만으로 고르면 안 된다.

GateLM은 앞으로 Provider, Model, Policy, Cache, Routing, Logging, Analytics, AI Service가 계속 늘어날 제품이다. 그래서 v1.0.0은 작게 만들더라도, 나중에 구조를 갈아엎지 않아도 되는 방향이어야 한다.

내 결론은 다음이다.

```text
v1.0.0 핵심 스택:
  Gateway Core        Go 1.24 + 표준 net/http + 명시적인 pipeline/stage 구조
  Control Plane API   NestJS + TypeScript, 먼저 modular monolith로 시작
  Web Console         Next.js App Router + TypeScript
  Database            PostgreSQL 16
  Cache               Redis 7

확장 준비는 하되 핵심 경로에는 넣지 않을 스택:
  AI Service          FastAPI
  Event Bus           Redpanda
  Analytics Store     ClickHouse
```

추천 스택 자체는 기존 의견과 크게 다르지 않다. 다만 이유는 "가볍게 만들 수 있어서"가 아니라, "확장 지점을 명확히 분리하면서도 v1.0.0의 핵심 흐름을 안정적으로 닫을 수 있어서"다.

## 내가 생각하는 v1.0.0 기준

내가 말하는 v1.0.0은 상용 완성판이 아니다. GateLM이 LLM Gateway 제품으로 보이는 첫 기준선이다.

아래 흐름이 로컬 Docker Compose 환경에서 재현 가능하고, Request Log / Detail / Dashboard에서 확인 가능해야 한다.

```text
Admin onboarding
-> Project / Application / Provider / API Key / App Token
-> Gateway request
-> API Key / App Token authentication
-> Tenant / Project / Application context
-> Sensitive data redaction or block
-> Exact Cache
-> Simple Routing
-> Provider call
-> Usage Log
-> Request Log / Detail
-> Dashboard Overview
```

확장성을 이유로 이 흐름이 흐려지면 안 된다. 특히 다음은 v1.0.0에서도 반드시 지켜야 한다.

- Provider 호출은 Gateway Core의 Provider Adapter에서만 수행한다.
- Gateway handler에 Provider/Model별 조건문을 흩뿌리지 않는다.
- 민감정보 마스킹과 차단은 cache lookup과 Provider call보다 앞에 둔다.
- raw prompt, raw response, secret 원문은 저장하지 않는다.
- v1.0.0에서 사용하지 않는 대형 인프라는 interface와 outbox-ready 구조만 남긴다.

## 추천 기술스택

| 영역 | 결정 | 확장성 관점의 이유 |
|---|---|---|
| Gateway Core | Go 1.24 + 표준 `net/http` | Data plane의 핵심 경로를 작게 유지하면서 `Pipeline -> Stage`, `ProviderRegistry -> ProviderAdapter`, `CacheStore`, `RoutingStrategy`, `SecretResolver` 같은 확장 지점을 명시적으로 둘 수 있다. |
| Control Plane API | NestJS + TypeScript | Tenant, Project, Application, API Key, App Token, Provider Connection, Policy를 module 단위로 나누기 좋다. v1.0.0은 modular monolith로 시작하고, 필요하면 module 경계를 기준으로 서비스 분리가 가능하다. |
| Web Console | Next.js App Router + TypeScript | Dashboard, Request Log, Detail Drawer, onboarding flow를 한 앱에서 빠르게 만들 수 있다. Server Component, Route Handler, BFF 후보를 남길 수 있어 UI와 API 조합 변화에 대응하기 쉽다. |
| 계약 관리 | `packages/contracts` + versioned DTO/Event schema | TypeScript, Go, Python 서비스가 늘어날수록 API/Event 계약이 중요해진다. 문서와 contract package를 기준으로 확장해야 한다. |
| Database | PostgreSQL 16 | v1.0.0의 기준 저장소로 충분하고, tenant/project/application/log 데이터를 정합성 있게 관리할 수 있다. JSONB, index, transaction을 활용해 P1 확장 전까지 버틸 수 있다. |
| Cache | Redis 7, 단 Gateway에서는 `CacheStore` 뒤에 둠 | v1.0.0 Exact Cache에 사용하고, P1에서 rate limit, quota, active config cache로 확장할 수 있다. Gateway 코드는 Redis 구현에 직접 묶이지 않아야 한다. |
| AI Service | FastAPI, P1/P2 확장 서비스 | embedding, semantic cache, routing score, report summary처럼 Python 생태계가 유리한 기능이 생길 때 독립 서비스로 붙인다. Gateway 핵심 경로의 기본 의존성으로 두지 않는다. |
| Event Bus | Redpanda, P1 확장 | v1.0.0에서는 PostgreSQL direct writer를 기준 저장소로 둔다. 다만 event payload와 outbox 경계를 잡아두면 P1에서 Redpanda로 옮기기 쉽다. |
| Analytics Store | ClickHouse, P1 확장 | v1.0.0 Dashboard는 PostgreSQL 기준으로 숫자를 맞춘다. 트래픽과 분석 요구가 커지면 Worker를 통해 ClickHouse mirror/aggregate를 붙인다. |

## 이 조합이 확장성에 유리한 이유

### 1. Gateway는 웹 프레임워크보다 pipeline 구조가 중요하다

GateLM의 Gateway 확장 포인트는 HTTP router가 아니다. 핵심은 요청 처리 단계를 교체 가능한 stage로 유지하는 것이다.

```text
authenticate_api_key
-> validate_app_token
-> identify_context
-> load_active_config
-> detect_sensitive_data
-> mask_or_block
-> decide_model_route
-> build_cache_key
-> exact_cache_lookup
-> resolve_provider_credential
-> call_provider_adapter
-> write_log_or_event
```

이 구조에서는 Gin, Echo, Fiber 같은 웹 프레임워크보다 domain service와 port/interface 경계가 더 중요하다. Go 표준 `net/http`는 외부 의존을 줄이고, GateLM 전용 pipeline을 우리가 직접 통제하기 좋다.

### 2. Provider와 Model 확장은 registry/adapter로 해결한다

Provider와 Model은 enum으로 고정하지 않는다.

권장 구조는 다음이다.

```text
ProviderRegistry
  -> ProviderAdapter
       -> request 변환
       -> provider 호출
       -> response 변환
```

이렇게 두면 OpenAI, Anthropic, Gemini, local model을 추가할 때 Gateway handler, cache, masking, logging 코드를 수정하지 않아도 된다.

### 3. Policy 확장은 Control Plane과 Gateway 사이의 계약으로 해결한다

정책을 코드 if문으로 흩뿌리면 확장성이 죽는다.

v1.0.0에서는 JSON config 수준으로 단순화하되, 다음 구조를 유지해야 한다.

```text
Control Plane
  -> policy/config 검증과 저장
  -> active config 배포

Gateway
  -> active config 로드
  -> stage/service를 통해 policy 적용
```

NestJS는 policy, provider connection, api key, app token, project module을 분리하기 좋고, 나중에 특정 module을 별도 서비스로 떼어낼 수 있다.

### 4. Analytics 확장은 outbox/event 경계로 해결한다

v1.0.0부터 Redpanda/ClickHouse를 핵심 경로에 넣으면 데모 안정성이 떨어진다. 하지만 direct writer만 박아두면 P1에서 갈아엎어야 한다.

그래서 v1.0.0의 좋은 타협은 다음이다.

```text
Gateway
  -> PostgreSQL p0_llm_invocation_logs에 기준 로그 저장
  -> InvocationFinishedPayload 형태를 유지
  -> event writer interface / outbox-ready 경계 유지

P1
  -> Gateway 또는 Worker가 Redpanda event 발행
  -> Worker가 ClickHouse analytics 저장
  -> PostgreSQL은 control/ledger 기준 저장소로 유지
```

이렇게 하면 v1.0.0 Dashboard 숫자는 안정적으로 맞추고, P1 analytics pipeline으로 넘어갈 수 있다.

### 5. AI 기능은 Gateway 안에 넣지 않는다

Semantic Cache, routing score, embedding은 Gateway에 직접 넣으면 언어, runtime, 모델 의존성이 핵심 경로에 섞인다.

FastAPI AI Service는 별도 확장 영역으로 두는 것이 맞다.

```text
Gateway Core
  -> optional semantic/routing support가 필요할 때만 AI Service 호출
  -> AI Service가 없어도 exact cache/simple routing으로 동작
```

이 기준이면 AI Service 장애가 v1.0.0 Gateway 기본 흐름을 깨지 않는다.

## 다른 선택지를 기본값으로 두지 않는 이유

### Node.js로 Gateway까지 통일하지 않는다

언어 수를 줄이는 장점은 있다. 하지만 Gateway와 Control Plane은 변경 이유가 다르다.

- Gateway는 low-latency data plane이다.
- Control Plane은 admin workflow와 CRUD 중심이다.
- Web Console은 UX와 dashboard 중심이다.

이 셋을 모두 Node.js로 묶으면 처음에는 편하지만, Gateway 핵심 경로의 timeout/cancellation, provider adapter, masking, cache, logging 경계가 Control Plane 패턴에 끌려갈 위험이 있다.

### Gin, Echo, Fiber를 기본값으로 쓰지 않는다

Gateway의 확장성은 HTTP middleware chain보다 GateLM pipeline stage에서 나온다.

Gin, Echo, Fiber가 나쁜 선택은 아니다. 다만 v1.0.0의 Gateway endpoint 수와 요구사항을 보면 Go 표준 `net/http`로 충분하다. 외부 프레임워크를 넣는 순간 handler/context/middleware 방식이 프레임워크에 묶이는데, 지금 얻는 이익은 크지 않다.

추후 endpoint 수가 크게 늘거나 route group/middleware 요구가 복잡해지면 다시 검토할 수 있다.

### FastAPI를 Gateway로 쓰지 않는다

FastAPI는 AI Service에는 적합하다. 하지만 Gateway는 Python 생태계를 써야 하는 문제가 아니다.

Gateway는 다음이 중요하다.

- Provider call timeout/cancellation
- 보안에 민감한 redaction/block
- exact cache correctness
- request log consistency
- raw secret logging 금지

이 경로는 Go로 두고, Python은 AI/ML 성격의 확장 서비스로 두는 편이 더 확장 가능하다.

### Django를 쓰지 않는다

Django는 full-stack admin/product CRUD를 빠르게 만들 수 있다. 하지만 GateLM의 장기 구조는 Control Plane / Data Plane / Web Console 분리다.

Django를 도입하면 Django admin과 ORM 중심 구조가 강해지고, Next.js Web Console이나 Go Gateway와의 contract-first 경계가 약해질 수 있다.

### Vite SPA만으로 Web Console을 만들지 않는다

Vite는 frontend build tool로 좋다. 하지만 GateLM Console은 Dashboard, Logs, Detail Drawer, onboarding, auth, server-side API composition이 함께 필요하다.

Next.js는 UI와 server-side composition을 같이 가져갈 수 있어 P1 이후 BFF/route handler 확장에 유리하다.

### Redpanda/ClickHouse를 v1.0.0 필수로 넣지 않는다

확장성을 이유로 모든 확장 인프라를 첫 버전에 넣으면 오히려 실패 확률이 올라간다.

v1.0.0에서는 PostgreSQL이 기준 저장소여야 한다. 다만 event payload, writer interface, outbox boundary를 남겨 P1에서 Redpanda/ClickHouse로 확장한다.

## v1.0.0부터 지켜야 할 구조 원칙

확장성을 위해 v1.0.0부터 지켜야 할 원칙은 다음이다.

1. Provider와 Model은 string/config/registry 기반으로 다룬다.
2. Gateway handler에는 Provider별 조건문을 넣지 않는다.
3. Cache, Routing, Secret, Provider call, Log writer는 interface 뒤에 둔다.
4. Sensitive Data Detector는 registry 구조로 둔다.
5. 정책 판단은 hard-coded if문이 아니라 active config/policy object를 통해 수행한다.
6. Event field는 문서에 정의된 contract만 사용한다.
7. raw prompt, raw response, provider key, api key, app token 원문은 저장하지 않는다.
8. P1 인프라를 넣더라도 v1.0.0 기본 Gateway 흐름이 해당 인프라 장애에 의존하지 않게 한다.

## 검증 계획

확장성은 말로만 판단하지 않고 최소한 아래 실험으로 확인해야 한다.

| 검증 항목 | 대상 | 통과 기준 |
|---|---|---|
| mock provider variant 추가 | Provider adapter | Gateway handler 수정 없이 adapter/registry 추가로 동작한다. |
| detector 추가 | Sensitive detector registry | masking engine 전체를 고치지 않고 detector 추가가 가능하다. |
| cache backend 교체 | CacheStore interface | memory/redis store를 handler 수정 없이 교체한다. |
| routing policy 변경 | RoutingStrategy/config | `model=auto` 기준 변경이 handler 수정 없이 가능하다. |
| event writer 교체 | Log/Event writer interface | PostgreSQL direct writer에서 outbox/event writer로 이동 가능한 경계가 있다. |
| Dashboard 일관성 | PostgreSQL source | total/success/blocked/cache count가 Request Log와 일치한다. |
| AI Service disabled | Gateway fallback | AI Service 없이 exact cache/simple routing으로 Gateway가 동작한다. |
| 기본 local load | Gateway Core | log loss 없이 request status, cache status, routing status가 보존된다. |

## 최종 제안

확장성을 반영한 내 최종 제안은 다음이다.

```text
v1.0.0:
  Go Gateway Core
    - standard net/http
    - explicit pipeline/stage architecture
    - provider adapter registry
    - detector registry
    - cache/routing/secret/log interfaces

  NestJS Control Plane API
    - modular monolith
    - project/application/provider/key/token modules
    - active config publishing boundary

  Next.js Web Console
    - onboarding
    - dashboard overview
    - request log
    - request detail drawer

  PostgreSQL
    - canonical request logs
    - control plane metadata

  Redis
    - exact cache
    - future active config/rate limit/quota counters

P1:
  Rate Limit
  Budget hard block
  actual provider adapter
  Redpanda event bus
  ClickHouse analytics
  FastAPI AI Service for semantic cache/routing support
```

이 방향이면 v1.0.0에서 작은 Gateway 제품을 끝까지 닫으면서도, P1/P2에서 Provider, 정책, 캐시, 분석, AI 기능이 늘어날 때 기존 구조를 버리지 않아도 된다.
