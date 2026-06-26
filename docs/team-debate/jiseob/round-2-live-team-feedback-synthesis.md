# Round 2 Live Team Feedback Synthesis

## 1. 읽은 문서

이번 의견은 아래 새 토론 문서를 읽고 정리한 것이다.

- `docs/team-debate/hyeok/round1.md`
- `docs/team-debate/kyumin/round-2-v1-baseline-opinion.md`
- `docs/team-debate/kyujeong/round-4-v1-v2-roadmap-response.md`
- `docs/team-debate/yoonji/expanded-p0-parallel-implementation-plan.md` 최신 변경분

기존 `v1-v2-roadmap-synthesis.md`의 방향은 대체로 유지하되, 이번 라운드에서 더 선명해진 쟁점을 반영한다.

## 2. 현재 수렴한 지점

지금까지의 토론은 다음 방향으로 수렴하고 있다.

- GateLM은 B2B LLM Gateway다.
- v1.0.0은 작더라도 실제 운영 제품처럼 설명되는 baseline이어야 한다.
- v2.0.0은 중간 발표 목표로 보고, v1에서 측정한 병목을 근거로 성능과 아키텍처를 고도화한다.
- Web Console과 Customer Demo App은 분리해야 한다.
- RAG, Semantic Cache, Streaming, Redpanda, ClickHouse는 v1 메인 경로가 아니라 v2 또는 evidence path에 두는 쪽으로 기울고 있다.
- Metrics와 k6 baseline은 v1부터 잡아야 한다.

이제 토론은 방향성보다 구체 결정을 내려야 하는 단계로 보인다.

## 3. 실제 Provider에 대한 의견

Hyeok과 Kyujeong은 실제 Provider가 있으면 "진짜 Gateway"라는 인상이 크게 올라간다고 본다. Kyumin은 실제 Provider를 보조 경로로 두고 Mock Provider가 메인 경로를 보장해야 한다고 본다.

내 판단은 다음이다.

```text
실제 Provider 1개는 v1 메인 후보 1순위로 시도한다.
하지만 v1 합격 기준은 Mock Provider fallback만으로도 통과 가능해야 한다.
```

이유:

- 실제 Provider는 제품 신뢰도를 크게 올린다.
- 하지만 외부 네트워크, quota, secret 설정, provider 장애가 발표 성공 조건이 되면 위험하다.
- GateLM의 본질은 특정 Provider 호출 자체가 아니라, Provider 호출 전후의 정책/보안/비용/로그 통제다.

따라서 구현 기준은 다음이 좋다.

- Provider Adapter interface는 mock과 actual provider가 같은 경로를 탄다.
- 실제 Provider secret은 DB, log, 화면, fixture에 남지 않는다.
- 실제 Provider 실패 시 mock fallback 또는 pre-recorded fallback으로 데모를 이어갈 수 있다.
- 발표에서는 실제 Provider 장면을 보여주되, core smoke는 mock으로도 항상 통과한다.

## 4. Rate Limit scope에 대한 의견

Kyujeong은 `applicationId`를 기본 scope로 보는 것이 자연스럽다고 했다. App Token이 Application 단위이고, 데모에서 "이 앱이 제한됐다"라고 보여주기 쉽다는 이유다.

Kyumin은 `projectId`를 추천했다. 기업 비용 통제 메시지와 Dashboard 설명이 더 직관적이라는 이유다.

둘 다 타당하다. 다만 v1에서는 하나를 고정해야 한다.

내 제안은 다음이다.

```text
v1 Rate Limit enforcement scope는 applicationId로 둔다.
Dashboard와 metrics는 projectId 기준 aggregate를 함께 보여준다.
Budget은 v1 후보 또는 v2에서 projectId 기준으로 둔다.
```

이유:

- Rate Limit은 짧은 시간의 요청 폭주를 제어하는 기능이므로 Application 단위가 자연스럽다.
- App Token 검증 결과와 바로 연결되기 때문에 Gateway context에 이미 필요한 정보가 있다.
- 데모에서 Customer Demo App을 하나의 Application으로 보여주기 쉽다.
- 비용 통제 메시지는 project aggregate와 Budget에서 더 잘 설명된다.

v1 Rate Limit contract는 아래처럼 좁게 잡는다.

```text
scope: applicationId
algorithm: fixed_window
windowSeconds: 60
storage: PostgreSQL
decision: allowed, remaining, retryAfterSeconds, reason
detail: requestId 기준 Request Detail에 기록
metrics: allowed/blocked count와 decision duration 기록
extension: RateLimiter interface 뒤에 Redis adapter 추가 가능
```

이렇게 하면 Kyujeong의 Application 단위 통제와 Kyumin의 Project 단위 비용 메시지를 둘 다 살릴 수 있다.

## 5. Metrics는 v1의 필수 계약으로 본다

이번 라운드에서 가장 강하게 합의된 부분은 metrics다.

v2에서 Redis, ClickHouse, Redpanda, Semantic Cache를 이야기하려면 v1 baseline 수치가 있어야 한다. 따라서 metrics는 polish가 아니라 v1 contract에 가깝다.

v1 최소 metrics:

```text
gateway_requests_total
gateway_request_duration_ms
gateway_provider_duration_ms
gateway_cache_requests_total
gateway_cache_hits_total
gateway_masking_actions_total
gateway_blocked_requests_total
gateway_rate_limit_decisions_total
gateway_rate_limit_duration_ms
gateway_invocation_log_write_duration_ms
```

Dashboard는 운영자가 보는 제품 화면이고, metrics는 기술적 근거다. 둘을 섞지 않는 것이 좋다.

- Dashboard: 요청 수, 차단 수, cache hit, 비용, latency 요약
- Metrics: p95 latency, stage duration, rate limit overhead, log write overhead
- k6 report: v1 baseline 성능과 v2 개선 전후 비교 근거

## 6. Yoonji 계획에 대한 반영

Yoonji의 최신 계획은 Kyujeong과 Kyumin의 피드백을 상당히 반영했다.

좋은 점:

- Web Console과 Customer Demo App 역할을 분리했다.
- Day 1에 공통 계약을 먼저 고정한다.
- optional infra가 메인 Gateway path를 막지 않도록 했다.
- 아키텍처 가드레일과 구조 검증 매트릭스를 넣었다.
- 하루 끝에 실제 결과물을 보여줄 수 있는 merge 리듬을 제안했다.

조심할 점:

- "각 담당 4회 머지"가 기계적으로 적용되면 skeleton PR이 너무 많아질 수 있다.
- PR 단위는 파일 수나 단계명이 아니라 스크럼에서 보여줄 outcome 기준이어야 한다.
- 공유 contract는 별도 PR로 작게 가되, 각 slice가 계속 mock만 쌓고 실제 연결을 미루면 안 된다.

내 제안:

```text
하루에 담당자당 1~2개 PR을 목표로 한다.
PR 하나는 반드시 실행 가능한 결과 또는 검증 가능한 fixture/smoke를 포함한다.
계약 PR은 작게, feature PR은 스크럼 결과물이 보이는 크기로 자른다.
```

## 7. v1 메인 경로 업데이트

현재 토론을 반영하면 v1 메인 경로는 아래로 고정하는 것이 좋다.

```text
관리자가 Project/Application/API Key/App Token/Provider 설정을 준비한다
-> Customer Demo App이 GateLM Gateway로 요청한다
-> Gateway가 API Key와 App Token을 검증한다
-> applicationId 기준 PostgreSQL-backed Rate Limit decision을 수행한다
-> 민감정보를 redaction하거나 위험 정보를 block한다
-> 안전한 동일 요청은 Exact Cache로 Provider 호출을 건너뛴다
-> model=auto 요청은 selectedModel과 routingReason을 남긴다
-> Mock Provider가 항상 안정적으로 응답하고, 가능하면 실제 Provider 1개도 같은 adapter path로 응답한다
-> requestId로 Log, Detail, Dashboard, Metrics까지 추적한다
-> k6 baseline으로 현재 성능과 v2 개선 방향을 설명한다
```

이 경로에 없는 기능은 v1 필수 여부를 다시 의심해야 한다.

## 8. v2 방향 업데이트

v2는 기능을 더 붙였다는 이야기가 아니라, v1에서 측정한 병목을 근거로 확장성을 증명하는 단계로 둔다.

v2에서 보여줄 비교:

| v1 baseline | v2 improvement | evidence |
| --- | --- | --- |
| PostgreSQL Rate Limit | Redis Rate Limit | p95 latency, DB query latency, contention 감소 |
| PostgreSQL Log Query | ClickHouse Analytics | synthetic large log query latency |
| Direct Log Writer | Redpanda Event Pipeline | response path와 analytics path 분리 |
| Exact Cache | Semantic Cache experiment | safe-hit 기준, false positive 위험, 평가셋 |
| Dashboard Summary | Time-series Dashboard | cost/latency/cache/rate trend |

이렇게 잡으면 Hyeok의 큰 제품 임팩트와 Kyumin의 구조 안정성, Yoonji의 실행 계획, Kyujeong의 경로 분리 제안을 모두 살릴 수 있다.

## 9. 바로 결정해야 할 항목

이제 다음 회의에서는 아래 결정을 내려야 한다.

1. 실제 Provider 1개를 v1 메인 후보 1순위로 시도하되, mock fallback을 v1 합격 기준으로 둘 것인가?
2. Rate Limit enforcement scope를 `applicationId`로 확정할 것인가?
3. Project 단위 비용 통제는 Dashboard aggregate와 Budget 후보로 분리할 것인가?
4. v1 metrics 이름과 label을 누가 contract로 고정할 것인가?
5. k6 baseline owner를 누구로 둘 것인가?
6. Day 0 contract freeze owner를 누구로 둘 것인가?
7. 하루 PR 기준을 "담당자당 1~2개, 스크럼 결과물 기준"으로 합의할 것인가?

## 10. 현재 최종 입장

새 의견들을 반영해도 큰 방향은 바뀌지 않는다.

v1은 작지만 실제 운영 제품처럼 설명되는 B2B Gateway baseline이어야 한다.

다만 이번 라운드를 통해 세 가지는 더 강해졌다.

- 실제 Provider는 가능하면 v1 메인 후보 1순위로 시도한다.
- Rate Limit은 `applicationId` 기준 PostgreSQL-backed fixed window로 시작한다.
- metrics와 k6 baseline은 v1의 필수 증거로 본다.

v2는 Redpanda, ClickHouse, Redis Rate Limit, Semantic Cache, Streaming을 "새 기능 목록"으로 붙이는 것이 아니라, v1 metrics로 확인한 병목을 해결하는 기술적 개선 단계로 잡는다.
