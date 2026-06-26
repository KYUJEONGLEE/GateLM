# Kyumin 의견 - v1.0.0 Baseline 합의안

## 결론

Jiseob의 `v1-baseline-proposal.md`를 v1.0.0 논의의 기준으로 삼는 것에 동의한다.

다만 Hyeok 의견처럼 모든 설득 기능을 v1 필수로 올리면 실패 위험이 크다. Kyujeong이 말한 것처럼 메인 데모 경로, 보조 데모 경로, 실험/증거 경로를 분리해야 한다.

내 기준의 v1.0.0은 다음 한 문장으로 정의할 수 있다.

```text
고객사 업무 앱의 LLM 요청 하나가 GateLM을 통과하면서
인증, 정책, 보안, 비용 절감, 라우팅, 로그, 대시보드, 성능 근거까지
하나의 흐름으로 설명되는 상태
```

v1.0.0은 기능 개수가 아니라 이 흐름이 끊기지 않는지가 기준이어야 한다.

## 메인 데모 경로

v1.0.0에서 반드시 성공해야 하는 경로는 아래로 고정하는 것이 좋다.

```text
관리자가 Project / Application / Provider / API Key / App Token을 준비한다
-> 고객사 업무 앱이 Gateway로 요청한다
-> Gateway가 API Key와 App Token을 검증한다
-> tenant / project / application context를 확정한다
-> PostgreSQL-backed Rate Limit을 최소 판단한다
-> 민감정보를 redaction 또는 block 처리한다
-> Exact Cache miss / hit를 처리한다
-> model=auto 요청을 Simple Routing으로 결정한다
-> Mock Provider 또는 실제 Provider adapter를 호출한다
-> Request Log / Detail / Dashboard / metrics / k6 report로 결과를 추적한다
```

이 경로에 없는 기능은 v1.0.0 필수인지 다시 의심해야 한다.

## v1.0.0에 포함할 것

아래 항목은 v1.0.0의 제품 메시지를 만들기 위해 포함하는 것이 맞다.

| 영역 | 포함 기준 |
|---|---|
| 제품 정의 | B2B LLM Gateway로 고정한다. Chat UI나 RAG 제품으로 보이면 안 된다. |
| 역할 분담 | 레이어 기준이 아니라 vertical slice 기준으로 재배치한다. |
| Control Plane | 관리자가 만든 설정이 Gateway 판단에 실제로 쓰여야 한다. |
| Gateway Runtime | text-only 요청, requestId propagation, Provider Adapter, timeout/error contract를 안정화한다. |
| Governance | API Key, App Token, tenant/project/application context, 최소 Rate Limit 판단을 포함한다. |
| Safety | email/phone redaction, API Key/JWT/RRN/private key 계열 block을 포함한다. |
| Cost Control | Exact Cache와 Simple Routing을 포함한다. |
| Observability | Request Log, Detail, Dashboard 요약, structured log, metrics endpoint를 포함한다. |
| Performance Evidence | k6 baseline으로 latency/RPS/cache/rate limit 병목을 설명한다. |
| Demo | Web Console과 고객사 demo app의 역할을 분리한다. |

## v1.0.0에서 보조 경로로 둘 것

아래 항목은 성공하면 설득력이 올라가지만, 실패해도 메인 데모가 살아 있어야 한다.

| 항목 | 내 판단 |
|---|---|
| 실제 Provider 1개 | 보조 데모로 둔다. Mock Provider가 메인 경로를 보장해야 한다. |
| Budget Block | Rate Limit 이후에 붙인다. 시간이 부족하면 Request Detail에 후보 정책으로만 남겨도 된다. |
| Provider timeout/fallback | 실제 Provider를 붙인다면 반드시 필요하다. 메인 경로를 깨지 않는 fallback으로 둔다. |

실제 Provider는 있으면 좋다. 하지만 실제 Provider 장애, secret 설정, 외부 네트워크 상태가 발표 성공 조건이 되면 안 된다.

## v1.0.0 필수에서 뺄 것

아래 항목은 버리는 것이 아니라 P1/P2 확장으로 설명하는 것이 낫다.

- SSE Streaming
- Semantic Cache
- Redis-backed Rate Limit
- Redpanda / ClickHouse log pipeline
- Runtime Policy Editor
- Custom Regex Rule UI
- RAG / FAQ chatbot
- Self-hosted installer
- 복잡한 사용자 초대 / 권한 관리

이 기능들은 모두 제품적으로 의미가 있다. 하지만 v1.0.0의 한 줄 경로를 강화하지 않거나, 데모 안정성을 흔들 가능성이 크다.

## 기술스택에 대한 내 입장

기술스택은 기존 `framework-selection.md` 의견을 유지한다.

```text
Gateway Core        Go 1.24 + 표준 net/http + 명시적인 pipeline/stage 구조
Control Plane API   NestJS + TypeScript
Web Console         Next.js App Router + TypeScript
Database            PostgreSQL 16
Cache               Redis 7
```

다만 v1.0.0에서는 Redis를 모든 곳에 먼저 쓰기보다, 역할을 분리하는 것이 좋다.

- Exact Cache는 Redis를 쓴다.
- Rate Limit은 PostgreSQL-backed fixed window로 baseline을 만든다.
- RateLimiter interface를 먼저 두고, Redis adapter는 P1 최적화로 둔다.

이렇게 하면 "왜 Redis Rate Limit이 필요한가"를 감으로 말하지 않고, k6와 DB query latency로 설명할 수 있다.

## 바로 결정해야 할 것

다음 라운드는 방향성보다 구체 결정을 해야 한다.

### 1. Rate Limit scope

내 추천은 `projectId`다.

이유:

- 기업의 비용 통제 메시지와 가장 잘 맞다.
- Dashboard와 Request Detail에서 설명하기 쉽다.
- `apiKeyId`는 운영상 유용하지만, 발표 메시지는 project 단위가 더 직관적이다.

초기 contract는 아래 정도로 충분하다.

```text
scope: projectId
algorithm: fixed window
window: 60초
decision: allowed, remaining, retryAfterSeconds, reason
storage: PostgreSQL
extension: RateLimiter interface 뒤에 Redis adapter 추가 가능
```

### 2. Gateway가 Control Plane 설정을 읽는 방식

내 추천은 v1.0.0에서는 DB-backed active config read다.

완전한 Redis active config publish까지 넣으면 구현 범위가 커진다. 반대로 `.env` static config에 머물면 제품처럼 보이지 않는다.

따라서 v1.0.0은 다음 정도가 적당하다.

```text
Control Plane DB
-> active config query/repository
-> Gateway startup 또는 request path에서 필요한 설정 조회
-> P1에서 Redis active config cache로 최적화
```

단, Gateway handler가 DB schema에 직접 묶이면 안 된다. `RuntimeConfigProvider` 같은 interface 뒤에 둬야 한다.

### 3. Demo client 위치

내 추천은 Web Console과 별도 customer demo app을 분리하는 것이다.

- Web Console: 관리자 화면
- Customer Demo App: 고객사 업무 앱 역할

둘을 섞으면 GateLM이 Chat UI 제품처럼 보일 위험이 있다.

### 4. k6 기준

v1.0.0의 k6는 pass/fail 수치보다 병목 설명 자료로 두는 것이 좋다.

목표는 "우리가 고성능 시스템을 완성했다"가 아니라 "현재 병목을 측정하고 다음 최적화 근거를 만들 수 있다"이다.

## 내가 보는 역할별 완료 기준

| Slice | 완료 기준 |
|---|---|
| Control Plane & Runtime Config | 관리자가 만든 project/app/key/token/provider/model 설정이 Gateway 판단에 실제로 쓰인다. |
| Gateway Runtime & Provider | text-only 요청이 Provider Adapter를 통해 안정적으로 처리되고 timeout/error contract가 유지된다. |
| Governance | 인증, context, rate limit decision이 요청 결과와 로그 상세에 남는다. |
| Safety & Cost | redaction/block/cache/routing/cost-saving evidence가 한 요청 흐름에서 보인다. |
| Observability & Demo | requestId 하나로 log/detail/dashboard/metrics/demo flow가 연결된다. |

## 최종 제안

Jiseob의 v1 baseline을 기준으로 삼고, Kyujeong의 범위 조절을 적용하자.

내가 정리한 최종 배치는 다음이다.

```text
제품 기준: Jiseob
범위 조절: Kyujeong
기술스택: Kyumin
실행 계획: Yoonji
데모 임팩트 후보: Hyeok
```

v1.0.0은 작은 smoke test가 아니라 제품 baseline이어야 한다.

하지만 제품 baseline이라는 말이 모든 확장 기능을 필수로 넣자는 뜻은 아니다. 고객사 업무 앱 요청 하나가 GateLM을 통과하면서 통제, 보안, 비용 절감, 관측, 성능 근거가 연결되면 v1.0.0으로 충분히 설득력 있다.
