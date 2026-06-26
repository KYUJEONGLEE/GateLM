# GateLM v1.0.0 Baseline Proposal

## 1. 왜 계획을 다시 잡는가

지금까지의 P0는 Gateway 요청이 인증, 식별, 마스킹/차단, 라우팅, 캐시, Provider 호출, 로그, 대시보드까지 한 번 이어지는 것을 검증했다는 점에서 의미가 있다.

하지만 이 결과는 아직 "제품처럼 보이는 v1.0.0 baseline"이라고 보기 어렵다. 역할이 A/B/C/D/E의 기술 레이어 단위로 쪼개지면서 한 요청 경로의 같은 handler, context, log metadata를 여러 사람이 동시에 만졌고, 그 결과 merge conflict와 의존성이 커졌다. 특히 Observability 역할은 upstream stage가 남기는 metadata에 강하게 의존했기 때문에 독립적인 산출물을 만들기 어려웠다.

다음 계획은 단순히 기능을 더 많이 넣는 방향이 아니라, GateLM이 어떤 B2B 문제를 해결하는 제품인지 명확히 보여주는 방향이어야 한다.

## 2. GateLM 제품 정의

GateLM은 기업의 LLM 사용을 중앙 통제 지점으로 수렴시켜, 승인된 애플리케이션만 안전하게 Provider를 호출하고, 보안·비용·정책·로그를 일관되게 관리하게 해주는 B2B LLM Gateway다.

GateLM의 핵심 가치는 개발자 편의용 proxy가 아니라 기업 운영 관점의 통제와 관측이다.

- 승인된 Application만 LLM Provider를 사용할 수 있다.
- Provider 호출 전에 보안 정책과 접근 정책이 적용된다.
- 팀/프로젝트/Application 단위 사용량, 비용, latency, 차단 사유를 추적할 수 있다.
- 반복 요청, 모델 선택, 정책 차단의 결과를 운영자가 설명 가능하게 확인할 수 있다.
- 향후 대규모 트래픽에서 병목을 측정하고 개선할 수 있는 관측 기반을 가진다.

OpenAI-compatible request shape은 제품 가치가 아니라 adoption friction을 낮추기 위한 Gateway ingress contract로만 다룬다. 발표와 데모의 전면 메시지는 "개발자가 쉽게 붙인다"가 아니라 "기업이 LLM 사용 경로를 중앙에서 통제한다"여야 한다.

## 3. 기존 P0 진행의 문제

기존 P0의 문제는 구현량이 너무 적었다기보다, 산출물이 제품 가치 단위로 묶이지 않았다는 점이다.

- A는 DB와 seed, 문서 중심으로 움직였고 실제 Control Plane 설정 흐름이 약했다.
- B/C/D/E는 서로 다른 책임을 가졌지만 실제로는 같은 Gateway 요청 경로를 함께 수정했다.
- E는 Request Log와 Dashboard를 맡았지만, B/C/D의 metadata 계약이 안정되기 전까지는 downstream 의존성이 컸다.
- 계약은 문서로 존재했지만, OpenAPI, schema, fixture, smoke처럼 깨지면 바로 드러나는 실행 가능한 계약이 부족했다.
- 데모는 내부 smoke script 중심이었고, B2B 운영자가 보는 가치가 충분히 드러나지 않았다.

따라서 새 P0는 "작은 기능 묶음"이 아니라 "B2B Gateway 제품 baseline이 성립하는 최소 흐름"으로 재정의한다.

## 4. 새 P0 정의

새 P0는 다음 흐름이 데모와 테스트로 재현되는 상태를 의미한다.

```text
관리자가 조직/프로젝트/애플리케이션/Provider/정책을 설정한다
-> 여러 내부 사용자가 고객사 업무 앱을 통해 LLM 요청을 보낸다
-> GateLM이 인증, rate limit, masking/block, routing, cache를 적용한다
-> Provider 호출 여부와 결과가 안전하게 기록된다
-> 관리자는 requestId, 상세 화면, 대시보드, metrics로 사용량/비용/보안/성능을 확인한다
```

이 기준에서 P0는 "요청이 한 번 돈다"가 아니라 "제품처럼 보이는 v1.0.0 baseline demo가 가능하다"를 뜻한다.

## 5. v1.0.0 Baseline 범위

v1 baseline에는 다음 기능을 포함한다.

| 영역 | 포함 범위 |
| --- | --- |
| Control Plane | Tenant, Project, Application, Provider, Model, API Key, App Token의 최소 생성/조회/폐기 흐름 |
| Runtime Config | Gateway가 DB의 active config를 읽어 인증, routing, cache, logging에 사용 |
| Gateway Runtime | OpenAI-compatible text-only ingress, Provider Adapter, timeout/error response, requestId propagation |
| Governance | API Key 인증, App Token 검증, tenant/project/application context, PostgreSQL-backed Rate Limit |
| Safety | 이메일/전화번호 redaction, API Key/JWT/RRN/private key 계열 block |
| Cost Control | Exact Cache, Simple Routing, cache hit provider bypass |
| Observability | Request Log, Request Detail, Dashboard 요약, JSON structured log, Prometheus metrics |
| Performance Evidence | k6 baseline, latency/RPS/cache hit/rate limit 병목 측정 |
| Demo | 관리자가 실시간으로 사용자를 통제하고 관측하는 B2B 운영 시나리오 |

Rate Limit은 v1 baseline에서 PostgreSQL-backed 방식으로 구현한다. Redis를 먼저 쓰지 않는 이유는 단순화가 아니라, DB 기반 atomic check-and-increment의 정확성을 먼저 확보하고 부하 테스트로 병목을 측정해 Redis 도입 근거를 만들기 위해서다.

## 6. 제외 범위

다음은 v1 baseline 필수가 아니다.

- RAG/FAQ chatbot
- Semantic Cache
- Redis-backed Rate Limit
- ClickHouse / Redpanda log pipeline
- Runtime Policy Editor
- Custom Regex Rule UI
- SSE Streaming
- Self-hosted installer
- 복잡한 권한/초대 관리

RAG는 좋은 데모 확장 후보지만 GateLM의 핵심 기능이 아니다. P1에서는 고객사 앱이 RAG를 수행하고, 그 LLM 호출을 GateLM이 통제하는 구조로 확장할 수 있다.

## 7. 역할별 Vertical Slice

다음 작업부터는 레이어가 아니라 제품 가치 단위로 역할을 나눈다.

| 담당 | Vertical Slice | 책임 |
| --- | --- | --- |
| A | Control Plane & Runtime Config | 관리자가 설정을 만들고 Gateway가 그 설정을 읽는 흐름까지 책임진다. |
| B | Gateway Runtime & Provider | 요청 처리, Provider Adapter, timeout/error, response contract, 실제 Provider 확장 지점을 책임진다. |
| C | Governance | API Key/App Token, tenant context, PostgreSQL-backed Rate Limit, budget block 후보, policy enforcement를 책임진다. |
| D | Safety & Cost | masking/block, exact cache, cache safety, simple routing, cost-saving evidence를 책임진다. |
| E | Observability & Demo | request log/detail/dashboard, metrics, k6, demo page/flow, 발표용 evidence를 책임진다. |

각 역할은 자기 slice의 end-to-end 결과를 만들기 위해 API, DB, Gateway, UI, 테스트를 필요한 만큼 수정할 수 있다. 대신 공통 계약은 먼저 고정하고, 계약 없는 필드나 endpoint를 임의로 추가하지 않는다.

## 8. 공통 계약 문서/스키마

다음 계약은 구현 전에 문서와 테스트로 고정한다.

- Runtime Config Contract: Gateway가 읽는 tenant, project, application, provider, model, key, token, policy 정보
- Gateway Context Contract: request, identity, routing, safety, cache, provider, usage, status metadata
- Request/Response/Error Contract: Gateway API와 공통 error shape
- Rate Limit Decision Contract: scope, window, decision, remaining, retryAfter, block reason
- Safety Contract: detector type, action, placeholder, raw value 저장 금지 기준
- Cache/Routing Contract: cache key material, selected model/provider, routing reason
- Invocation Log/Event Contract: request log 저장 필드와 terminal status
- Dashboard Query Contract: overview와 time-series 계산 기준
- Demo Fixture Contract: 안전한 seed, credential, mock provider, test prompt
- Smoke/Load Test Contract: acceptance smoke와 k6 baseline 기준

계약은 문서만으로 끝내지 않는다. fixture, schema validation, smoke script, 테스트 중 하나로 깨지는 지점이 드러나야 한다.

## 9. 성능·관측성 계획

v1 baseline부터 성능 수치를 남긴다. 목표는 대규모 시스템을 완성하는 것이 아니라, 병목을 측정하고 개선할 수 있는 기반을 만드는 것이다.

필수 관측 항목:

- request count, success/error/blocked/cache_hit count
- request latency histogram
- provider latency histogram
- auth/rate_limit/masking/cache/routing stage counter
- cache hit ratio
- redacted/blocked count
- rate limit allowed/blocked count
- DB-backed rate limit query latency

기술 선택:

- application log는 `slog` JSON 형태를 목표로 한다.
- metrics는 Prometheus scrape가 가능한 endpoint를 제공한다.
- load test는 k6 script로 재현한다.
- Grafana/Loki/ClickHouse/Redpanda는 P1/P2 확장으로 둔다.

Rate Limit 성능 서사:

```text
1. PostgreSQL-backed fixed window rate limit을 구현한다.
2. k6로 RPS를 올리며 p95 latency, DB query latency, lock/contention, connection pool saturation을 측정한다.
3. 병목이 확인되면 RateLimiter interface 뒤에 Redis adapter를 추가하는 P1 최적화 계획을 제시한다.
4. DB baseline과 Redis 개선 수치를 비교해 기술 선택의 근거를 만든다.
```

## 10. B2B 데모 시나리오

데모의 청중은 개발자가 아니라 가상의 고객사 내부 사용자다. 발표자는 GateLM 관리자 역할을 수행한다.

예시 시나리오:

```text
Jungle Support 팀이 고객 응대 보조 LLM 앱을 사용한다.
여러 내부 사용자가 동시에 문의 요약, 답변 초안, 정책 질문, 자유 프롬프트를 보낸다.
GateLM 관리자는 실시간으로 요청 수, 차단 요청, redaction, cache hit, latency, rate limit을 확인한다.
일부 사용자가 위험 문자열을 보내면 Provider 호출 전에 차단된다.
반복 요청은 cache hit으로 Provider 호출 없이 응답된다.
부하 테스트 결과를 통해 DB-backed rate limit의 현재 성능과 다음 개선 방향을 설명한다.
```

데모에서 보여줄 장면:

- 관리자가 Project/Application/API Key/App Token/Provider/Model을 준비한다.
- 여러 사용자가 업무형 LLM 요청을 보낸다.
- 민감정보는 redaction되고 위험 정보는 block된다.
- 같은 요청은 cache hit으로 Provider 호출 count가 증가하지 않는다.
- `model=auto` 요청의 selected model과 routing reason이 남는다.
- requestId로 log list, detail, dashboard까지 추적한다.
- metrics와 k6 결과로 latency/RPS/cache hit/rate limit 병목을 설명한다.

## 11. 단계별 구현 순서

제안하는 구현 순서는 다음이다.

1. Contract Freeze: runtime config, Gateway context, log/event, rate limit, metrics 계약을 먼저 고정한다.
2. Control Plane Baseline: seed가 아니라 최소 관리 API/UI에서 설정이 생성되고 Gateway가 읽도록 만든다.
3. Governance Baseline: API Key/App Token과 PostgreSQL-backed Rate Limit을 pipeline에 연결한다.
4. Safety & Cost Baseline: masking/block, exact cache, simple routing을 계약 기준으로 보강한다.
5. Observability Baseline: log/detail/dashboard, structured log, metrics를 연결한다.
6. Demo & Evidence: B2B demo flow, smoke, k6 baseline, 발표용 지표를 만든다.
7. Optimization Backlog: Redis Rate Limit, ClickHouse/Redpanda, Semantic Cache, RAG demo를 P1/P2로 분리한다.

## 12. 팀 토론 질문

팀 토론에서는 아래 질문을 먼저 결정한다.

1. GateLM의 v1 제품 정의를 B2B LLM Gateway로 고정할 것인가?
2. 새 P0를 "v1.0.0 baseline demo 가능 상태"로 재정의할 것인가?
3. 기존 A/B/C/D/E 역할을 vertical slice 기준으로 재배치할 것인가?
4. Rate Limit은 v1에서 PostgreSQL-backed baseline으로 시작하고 Redis는 P1 최적화로 둘 것인가?
5. RAG/FAQ chatbot은 v1 필수가 아니라 P1 demo extension으로 둘 것인가?
6. Observability는 v1에서 dashboard뿐 아니라 metrics와 k6 evidence까지 포함할 것인가?
7. 다음 PR부터 계약 문서와 smoke 기준을 먼저 고정한 뒤 구현할 것인가?

## 13. 보안 원칙

v1 baseline에서도 보안 기준은 낮추지 않는다.

- raw prompt 저장 금지
- raw response 저장 금지
- API Key/App Token/Provider Key 평문 저장 금지
- Authorization header 로그 출력 금지
- raw provider error body 저장 금지
- 실제 secret 또는 실제 개인정보를 seed/test/snapshot에 사용 금지
- cache key에 raw prompt 사용 금지
- masking stage를 cache 뒤로 이동 금지

제품 baseline이 작더라도 이 기준이 깨지면 B2B Gateway로 설득할 수 없다.
