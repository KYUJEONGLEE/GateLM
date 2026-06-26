# GateLM v1/v2 Roadmap Synthesis

## 1. 이 문서의 목적

이 문서는 `v1-baseline-proposal.md`와 다른 팀원들의 토론 문서를 종합해, GateLM의 다음 구현 계획을 v1.0.0과 v2.0.0으로 나누어 정리한다.

현재까지의 토론은 방향성 면에서는 꽤 수렴했다.

- GateLM은 개발자 편의용 proxy가 아니라 B2B LLM Gateway다.
- v1.0.0은 작더라도 제품처럼 보이는 baseline이어야 한다.
- 중간 발표는 v2.0.0에 가까운 목표로 보고, v1 이후에는 성능 개선과 아키텍처 고도화가 중심이 된다.
- Redpanda, ClickHouse, Semantic Cache, Streaming 같은 확장 기능은 매력적이지만 v1 메인 데모 안정성을 깨면 안 된다.
- Metrics, load test, structured logging은 v1부터 기준을 잡아야 한다.

따라서 이 문서는 기능을 포기하기 위한 문서가 아니라, 어떤 기능을 어떤 발표 시점과 어떤 증거 수준으로 가져갈지 정하기 위한 문서다.

## 2. 제품 정의

GateLM은 기업의 LLM 사용을 중앙 통제 지점으로 수렴시켜, 승인된 애플리케이션만 안전하게 Provider를 호출하고, 보안·비용·정책·로그를 일관되게 관리하게 해주는 B2B LLM Gateway다.

발표와 데모의 전면 메시지는 다음이어야 한다.

- 기업은 LLM 사용 경로를 표준화하고 통제할 수 있다.
- 관리자는 어떤 팀, 프로젝트, 애플리케이션이 어떤 LLM을 얼마나 쓰는지 볼 수 있다.
- Provider 호출 전에 보안, 비용, 정책 판단을 적용할 수 있다.
- 운영자는 requestId, 로그, 대시보드, metrics로 문제와 비용을 추적할 수 있다.

OpenAI-compatible request shape은 제품 메시지가 아니라 Gateway ingress contract로 설명한다.

## 3. 현재 문서들의 핵심 주장

### Jiseob

v1.0.0을 B2B Gateway 제품 baseline으로 재정의하고, P0를 "요청이 돈다"가 아니라 "제품처럼 보이는 데모가 가능하다"로 다시 잡자는 입장이다. Rate Limit은 PostgreSQL-backed baseline으로 시작하고, Redis는 부하 테스트로 필요성을 증명한 뒤 도입하자는 제안을 한다.

### Hyeok

제품 임팩트를 크게 잡는다. 실제 Provider, Streaming, Rate Limit, Budget, 시계열 Dashboard, Text-only Chat UI, Runtime Policy, Custom Regex, Redpanda/ClickHouse까지 GateLM이 기업용 제품처럼 보이게 하는 기능으로 제안한다. 방향성은 강하지만 v1 필수 범위로 모두 올리면 리스크가 크다.

### Kyumin

기술 경계와 확장성을 가장 중요하게 본다. Go Gateway, NestJS Control Plane, Next.js Console, PostgreSQL, Redis Exact Cache를 중심으로 두고, AI Service, Redpanda, ClickHouse는 확장 준비만 하자는 입장이다. v1에서 구조를 망가뜨리지 않는 기준으로 삼기 좋다.

### Yoonji

병렬 구현 계획이 강하다. 각 담당자가 mock, fixture, contract stub을 활용해 기다리지 않고 작업하자는 제안이 실용적이다. 다만 마지막 통합에 계약을 맞추면 다시 충돌이 날 수 있으므로, contract freeze를 먼저 두어야 한다.

### Kyujeong

메인 데모 경로, 보조 데모 경로, 실험/증거 경로를 분리하자는 중재안이 핵심이다. 이 관점은 v1과 v2를 나누는 기준으로 가장 유용하다.

## 4. v1.0.0의 기준

v1.0.0은 상용 완성판이 아니라, GateLM을 B2B LLM Gateway라고 부를 수 있는 첫 제품 baseline이다.

v1.0.0의 합격 기준은 기능 개수가 아니라 다음 한 줄 경로가 안정적으로 동작하는 것이다.

```text
관리자가 프로젝트/앱/키/정책을 준비한다
-> 고객사 업무 앱 또는 demo client가 Gateway로 요청한다
-> GateLM이 인증, 정책, 보안, 캐시, 라우팅을 적용한다
-> Provider 응답 또는 차단 결과를 반환한다
-> requestId로 Log, Detail, Dashboard, Metrics까지 추적한다
```

이 경로에 직접 기여하지 않거나 데모 안정성을 크게 흔드는 기능은 v1 메인 경로에서 제외한다.

## 5. v1.0.0 메인 범위

v1 메인 데모에 반드시 포함할 항목은 다음이다.

| 영역 | v1 메인 범위 |
| --- | --- |
| Control Plane | Project, Application, API Key, App Token, Provider/Model 최소 설정 |
| Gateway | text-only request, requestId, timeout/error response, mock provider path |
| 인증/식별 | API Key 인증, App Token 검증, tenant/project/application context |
| Governance | PostgreSQL-backed Rate Limit 최소 decision |
| Safety | email/phone redaction, API Key/JWT/RRN/private key 계열 block |
| Cost | Exact Cache miss -> hit, simple routing, selected model 기록 |
| Logging | success, cache_hit, blocked, auth failure, provider error 기록 |
| Detail | requestId 기준 routing/cache/masking/rate/status/cost/latency 확인 |
| Dashboard | 요청 수, 성공/차단 수, cache hit, latency, 비용 요약 |
| Metrics | request count, latency, cache hit, blocked/redacted, rate limit decision |
| Evidence | smoke script, k6 baseline report, demo checklist |

v1에서 가장 중요한 것은 이 기능들이 따로 존재하는 것이 아니라, 하나의 요청 흐름 안에서 서로 연결되어 보이는 것이다.

## 6. v1.0.0 후보 범위

아래 항목은 가능하면 v1에 넣되, 데모 안정성을 흔들면 보조 경로로 내린다.

| 항목 | v1에서의 권장 위치 | 판단 기준 |
| --- | --- | --- |
| 실제 Provider 1개 | 보조 또는 메인 후보 | secret 관리와 장애 fallback이 준비되면 메인에 포함 |
| JSON structured log | 메인 후보 | 구현 부담이 낮고 운영성 메시지가 강함 |
| Prometheus metrics endpoint | 메인 후보 | v2 성능 개선의 기준이 되므로 가능하면 포함 |
| 시계열 Dashboard 일부 | 보조 후보 | Dashboard polish에 비해 비용이 크면 숫자 카드 중심으로 축소 |
| Budget Hard Block | 보조 후보 | Rate Limit과 중복 메시지가 있으므로 시간이 남으면 포함 |

실제 Provider는 제품 신뢰도를 높일 수 있지만, 발표 중 외부 장애가 전체 데모 실패가 되면 안 된다. mock fallback은 필수다.

## 7. v1.0.0 제외 범위

다음은 v1 메인 범위에서 제외한다.

- Streaming
- Semantic Cache
- Runtime Policy Editor
- Custom Regex Rule UI
- Redpanda / ClickHouse 실연동
- RAG / FAQ chatbot
- 사용자 초대 / 권한 관리
- Self-hosted installer

이 기능들은 버리는 것이 아니라 v2.0.0 또는 P1/P2 고도화 주제로 둔다.

## 8. v2.0.0의 기준

중간 발표는 v2.0.0에 가깝게 볼 수 있다.

v2.0.0의 핵심은 기능 나열이 아니라, v1에서 확보한 Gateway baseline을 기반으로 성능, 관측성, 아키텍처 확장성을 증명하는 것이다.

v2.0.0의 방향:

- Gateway hot path의 병목을 측정하고 개선한다.
- PostgreSQL-backed Rate Limit과 Redis-backed Rate Limit을 비교한다.
- PostgreSQL request log와 ClickHouse analytics path를 비교한다.
- direct writer와 event-driven log pipeline의 trade-off를 설명한다.
- Exact Cache 이후 Semantic Cache의 안전성/평가셋 문제를 다룬다.
- Dashboard는 단순 숫자보다 시계열, 병목, 비용 추이를 보여준다.

v2는 "더 많은 기능을 붙인 버전"이 아니라 "GateLM이 대규모 운영 제품으로 확장될 수 있음을 수치와 구조로 증명하는 버전"이어야 한다.

## 9. v2.0.0 후보 범위

| 영역 | v2 후보 | 기대 효과 |
| --- | --- | --- |
| Rate Limit 최적화 | Redis adapter 추가, DB baseline과 비교 | Redis 도입 이유를 수치로 설명 |
| 로그 파이프라인 | Redpanda outbox/event path | 응답 경로와 분석 경로 분리 |
| 분석 저장소 | ClickHouse mirror 또는 synthetic benchmark | 대량 로그 조회와 시계열 분석 근거 |
| Dashboard | 시계열 chart, p95 latency, cache hit trend, rate limited count | 운영 제품 느낌 강화 |
| 성능 테스트 | k6 scenario 확장, RPS/p95/error rate report | 개선 전후 수치 제시 |
| Semantic Cache | disabled mode, evaluation set, safe-hit demo 후보 | 신뢰 리스크와 평가 방법 제시 |
| Streaming | 별도 보조 demo | 사용자 체감과 Gateway logging의 trade-off 설명 |

Redpanda와 ClickHouse는 v1 메인 데모의 필수 성공 조건으로 두지 않는다. 대신 v2에서 "왜 필요한지"를 v1 metrics와 병목 근거로 설명하면서 구체화한다.

## 10. Metrics는 v1부터 확정한다

metrics는 v2로 미루면 안 된다. v2의 성능 개선과 아키텍처 고도화는 v1 baseline 수치가 있어야 설득된다.

v1에서 최소로 남길 metrics:

- `gateway_requests_total`
- `gateway_request_duration_ms`
- `gateway_provider_duration_ms`
- `gateway_cache_requests_total`
- `gateway_cache_hits_total`
- `gateway_masking_actions_total`
- `gateway_blocked_requests_total`
- `gateway_rate_limit_decisions_total`
- `gateway_rate_limit_duration_ms`
- `gateway_invocation_log_write_duration_ms`

v1에서 metrics의 목표는 "정교한 Grafana dashboard"가 아니라 "성능 개선 전 baseline을 재현 가능하게 남기는 것"이다.

v2에서는 이 metrics를 기반으로 다음을 비교한다.

- DB-backed rate limit vs Redis-backed rate limit
- PostgreSQL log query vs ClickHouse query
- cache miss vs cache hit latency
- masking enabled vs disabled overhead
- provider timeout/error path latency

## 11. PostgreSQL-backed Rate Limit 기준

v1 Rate Limit은 PostgreSQL-backed fixed window로 시작한다.

목적은 Redis를 쓰지 않겠다는 것이 아니라, Redis를 왜 써야 하는지 설명할 baseline을 만드는 것이다.

v1 최소 기준:

- `RateLimiter` interface를 먼저 둔다.
- adapter는 PostgreSQL fixed window로 구현한다.
- scope는 `applicationId`를 기본으로 한다.
- window는 1분 fixed window 하나로 제한한다.
- decision은 `allowed`, `remaining`, `retryAfterSeconds`, `reason`만 둔다.
- 동시 요청에서 제한이 깨지지 않아야 한다.
- decision은 Request Detail에 남긴다.
- metrics로 decision count와 duration을 남긴다.

Dashboard에는 v1에서 rate limited count 정도만 보여주고, 상세 판단은 Request Detail에서 확인하게 한다.

## 12. 역할별 vertical slice

역할은 기술 레이어가 아니라 하루 끝에 보여줄 수 있는 제품 결과물 기준으로 나눈다.

| 담당 | Slice | 하루 끝 산출물 |
| --- | --- | --- |
| A | Control Plane & Runtime Config | 화면/API에서 만든 project/app/key/provider 설정을 Gateway가 읽는 장면 |
| B | Gateway Runtime & Provider | Gateway 요청이 provider/mock path를 안정적으로 지나고 error/timeout이 일관되게 처리되는 장면 |
| C | Governance | 인증, app token, rate limit decision이 요청 처리와 detail에 남는 장면 |
| D | Safety & Cost | redaction/block/cache/routing이 한 요청 흐름에서 설명되는 장면 |
| E | Observability & Demo | requestId 하나로 log/detail/dashboard/metrics/demo flow가 연결되는 장면 |

각 담당은 자기 slice를 완성하기 위해 필요한 API, DB, Gateway, UI, test를 건드릴 수 있다. 하지만 공통 계약을 바꾸는 경우에는 별도 contract PR로 먼저 합의한다.

## 13. merge 단위 원칙

merge 단위는 너무 크면 conflict가 커지고, 너무 작으면 Codex가 의미 없는 skeleton PR을 양산한다.

권장 기준:

- 하루에 담당자당 1~2개 PR을 목표로 한다.
- PR 하나는 "스크럼에서 보여줄 수 있는 작동 결과"를 가져야 한다.
- 파일 수 기준보다 outcome 기준으로 자른다.
- skeleton만 있는 PR은 허용하되, 같은 날 후속 behavior PR이 있어야 한다.
- 공통 contract 변경 PR은 작게 유지하고, feature PR과 섞지 않는다.
- UI mock, backend fixture, smoke script는 실제 통합 지점이 명시되어야 한다.

좋은 PR 예시:

- "API Key 발급 후 Gateway 인증에 사용되는 fixture와 검증 흐름"
- "Rate Limit fixed window decision과 Request Detail 기록"
- "Cache miss -> hit demo와 provider call count 검증"
- "Dashboard cards가 실제 log API 값을 읽는 흐름"
- "k6 baseline script와 첫 측정 report"

나쁜 PR 예시:

- "Control Plane 전체 구현"
- "Observability 전부 구현"
- "폴더 구조만 생성"
- "대규모 리팩토링과 기능 추가를 한 번에 처리"
- "mock만 있고 실제 연결 계획이 없는 UI"

## 14. 하루 단위 운영 방식

매일 끝 스크럼에서는 코드 설명보다 실행 결과를 보여준다.

각 담당자는 다음 중 하나 이상을 보여줘야 한다.

- 화면에서 누를 수 있는 flow
- curl 또는 smoke script 결과
- requestId로 조회되는 log/detail
- dashboard 숫자 변화
- metrics endpoint 출력
- k6 report
- 실패했지만 병목이나 trade-off를 설명하는 실험 결과

일일 진행 방식:

```text
오전: 계약/목표 확인, 작은 PR 범위 확정
오후: slice 구현, 테스트, smoke
퇴근 전: demo script 또는 화면으로 결과 공유
마지막: 통합 smoke owner가 main demo path 확인
```

스크럼 질문:

- 오늘 결과물이 v1 메인 경로를 강화했는가?
- 데모에서 직접 보여줄 수 있는가?
- 다른 slice와 계약 충돌이 생겼는가?
- metrics나 log로 증거가 남는가?
- 내일 이어서 붙일 수 있는 명확한 integration point가 있는가?

## 15. 권장 구현 순서

### Day 0. Contract Freeze

- v1 메인 데모 경로 확정
- Gateway context field 확정
- Runtime config shape 확정
- Rate Limit decision shape 확정
- Log/detail/dashboard/metrics 필드 확정
- demo fixture와 smoke expected output 확정

### Day 1. Control and Request Path

- A: project/app/key/provider 설정이 생성되는 최소 flow
- B: Gateway runtime과 mock/actual provider boundary 정리
- C: 인증과 app context를 Gateway active config에 연결
- D: masking/block/cache/routing demo path 보강
- E: requestId log/detail/dashboard 연결 smoke

### Day 2. Governance and Observability

- A: Runtime config 조회/반영 안정화
- B: provider timeout/error와 response consistency
- C: PostgreSQL-backed Rate Limit 최소 동작
- D: cost-saving evidence와 cache safety 보강
- E: metrics endpoint, dashboard cards, demo client 정리

### Day 3. Evidence and Polish

- k6 baseline 측정
- Request Detail polish
- Dashboard polish
- 실제 Provider 1개 연결 여부 최종 결정
- fallback script 정리
- v2 후보 실험 목록 정리

### Day 4. Demo Freeze

- 메인 데모 경로 freeze
- 보조 demo/evidence 분리
- 발표 순서와 역할 분담 고정
- 마지막 통합 smoke와 k6 report 고정
- v2.0.0 roadmap slide 근거 정리

## 16. 현재 기준 최종 제안

v1.0.0은 "작지만 실제로 운영 제품처럼 보이는 B2B Gateway baseline"으로 잡는다.

v1에서 반드시 잡아야 할 것은 기능 개수가 아니라 다음 세 가지다.

1. 고객사 요청 하나가 GateLM을 통과하며 통제, 보안, 비용 절감, 관측이 모두 설명된다.
2. 관리자는 requestId, dashboard, metrics로 그 결과를 확인한다.
3. 성능 개선과 아키텍처 고도화를 위한 baseline 수치가 남는다.

v2.0.0은 중간 발표 목표로 본다. v2에서는 Redpanda, ClickHouse, Redis Rate Limit, Semantic Cache, Streaming 같은 기능을 무리하게 한꺼번에 붙이는 것이 아니라, v1 metrics를 근거로 어떤 병목을 어떤 구조로 개선했는지 보여주는 방향이 좋다.

이렇게 나누면 Hyeok의 공격적인 제품 임팩트, Kyumin의 안정적인 기술 경계, Yoonji의 병렬 실행 계획, Kyujeong의 메인/보조/실험 경로 분리 제안을 모두 살릴 수 있다.
