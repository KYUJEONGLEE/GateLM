# GateLM v2.0.0 방향 의견 - 김규민

> Product Experience & Demo / Web Console 관점의 토론 메모다.
> 공식 계약이 아니라 `docs/team-debate/v2.0.0/jiseob/jiseob-v2-direction-proposal.md`에 대한 의견이며, 합의된 내용만 이후 v2 공식 문서로 승격해야 한다.

## 2026-06-29 1차 의견

### 요약

지섭님이 제안한 v2.0.0 방향인 "조직 기반 LLMOps Gateway MVP"에는 동의한다.
프론트 관점에서 중요한 점은 v2를 기술 목록으로 보이게 만드는 것이 아니라, 관리자가 회사 전체 LLM traffic을 이해하고 통제하는 장면을 제품적으로 설득력 있게 만드는 것이다.

다만 Web Console이 Gateway나 Observability의 책임을 대신 계산하면 안 된다.
v2에서 프론트가 잘 만들 수 있으려면 화면 단위보다 먼저 `Dashboard`, `Request Log`, `RuntimeSnapshot`, `Budget/Scope`, `Streaming 상태`, `Demo traffic`의 읽기 계약이 안정적으로 필요하다.

## 동의하는 부분

### v2.0.0 제품 메시지

v2.0.0을 "조직 기반 LLMOps Gateway MVP"로 잡는 방향은 Web Console과 잘 맞는다.
v1은 단일 demo flow가 동작하는 증명에 가까웠고, v2는 관리자가 여러 팀, 사용자, Application traffic을 한 화면에서 이해하는 경험이 중심이 되어야 한다.

이 관점이면 Web Console의 첫 화면도 단순 metric 나열이 아니라 아래 질문에 답해야 한다.

| 질문 | Web Console에서 보여야 하는 것 |
| -- | -- |
| 지금 조직 전체 LLM 사용량이 정상인가? | traffic, error, rate limit, safety event, latency |
| 비용이 어디서 늘고 있는가? | team/project/application/user scope별 cost와 trend |
| 정책이 실제 요청에 반영되는가? | RuntimeSnapshot version과 요청 결과의 연결 |
| Gateway가 Provider 직접 사용보다 어떤 이득을 줬는가? | cache saving, redaction/block, routing result, provider bypass |

### v1.x를 v2로 가는 release train으로 보는 점

v1.x에서 실제 Provider, 모델 2개 이상, RuntimeSnapshot thin slice, traffic simulator를 먼저 붙이는 방향에 동의한다.
프론트는 이 구간에서 fixture fallback과 live mode를 같이 유지하면서 데모 안정성을 책임질 수 있다.

### Redpanda/ClickHouse를 v2.0.0 필수로 두지 않는 점

동의한다.
Web Console 입장에서는 데이터 플랫폼 이름보다 dashboard query가 안정적으로 빠르게 나오고, 집계 기준이 설명 가능하며, request detail로 drill-down 되는 것이 더 중요하다.
PostgreSQL 기반으로 먼저 query profile과 aggregation 기준을 고정한 뒤, 병목이 측정되면 다음 저장소를 검토하는 편이 발표와 구현 모두 안전하다.

## 보완이 필요한 부분

### 1. Web Console 정보 구조를 v2 계약에 포함해야 한다

v2에서 조직, 팀, 사용자, Application 단위 관제를 보여주려면 navigation과 화면 구조가 먼저 정리되어야 한다.

제안하는 v2 Web Console 구조는 아래와 같다.

| 상위 영역 | 하위 화면 | 목적 |
| -- | -- | -- |
| Dashboard | Overview, Cost, Safety, Cache, Routing | 조직 상태 요약과 이상 징후 탐지 |
| Management | Organization, Team/Budget Scope, Project, Application, Provider, Runtime Snapshot | 설정과 정책 기준 관리 |
| Analytics | Request Logs, Request Detail, User/Team Usage, Provider Performance | 추적과 원인 분석 |
| Demo | Employee Chat, Application API Preset, Traffic Simulator | 발표와 smoke 검증 |
| Settings | Credentials, Audit, Environment | 운영 설정과 보안 확인 |

이 구조는 확정안이 아니라 프론트 구현 기준을 잡기 위한 초안이다.
중요한 점은 `Demo`와 `Admin Dashboard`를 섞지 않는 것이다.
시연용 입력 화면은 제품의 일부일 수 있지만, 운영자가 보는 관제 화면과 정보 위계가 달라야 한다.

### 2. `teamId`를 화면 identity로 바로 노출할지 조심해야 한다

지섭님 제안처럼 `teamId`를 Gateway core identity로 성급히 넣지 않고 `budgetScopeType`, `budgetScopeId`로 검토하는 방향에 동의한다.

프론트 관점에서도 화면 필터는 다음처럼 유연해야 한다.

```text
Tenant
-> Project
-> Application
-> Budget Scope
   - tenant
   - project
   - application
   - team
   - user group
```

즉 UI는 `Team`을 보여줄 수 있어도, GatewayContext의 canonical identity로 고정된다고 가정하면 안 된다.
Dashboard와 Log API는 `scopeType`, `scopeId`, `scopeDisplayName` 정도의 presentation-safe 필드를 주는 편이 좋다.

### 3. RuntimeSnapshot은 UI에서 설명 가능한 단위여야 한다

RuntimeSnapshot이 v2의 핵심이라면 Web Console은 단순히 "현재 설정"을 보여주는 데서 끝나면 안 된다.
요청 결과와 연결되는 snapshot metadata가 필요하다.

프론트가 소비하고 싶은 최소 필드는 아래와 같다.

| 필드 | 이유 |
| -- | -- |
| `runtimeSnapshotId` | 요청 detail과 설정 화면을 연결 |
| `runtimeSnapshotVersion` | 정책 변경 전후 비교 |
| `publishedAt` | 데모에서 변경 반영 시점 설명 |
| `publishedBy` | audit UX |
| `configHash` | Gateway 응답/로그와 무결성 연결 |
| `routingPolicyHash` | routing 결과 설명 |
| `safetyPolicyHash` | redaction/block 결과 설명 |
| `rateLimitPolicyHash` | rate limit 결과 설명 |

단, Web Console은 hash를 계산하지 않고 표시만 해야 한다.

### 4. Streaming thin slice는 UX 계약을 따로 잡아야 한다

Streaming은 v2 제품 체감에 중요하므로 방향에는 동의한다.
하지만 streaming을 붙이면 Request Log와 Detail에서 "응답 중", "완료", "중단", "provider timeout", "client aborted" 같은 상태가 생긴다.

따라서 API만 streaming으로 열기보다 UI에 필요한 상태 계약을 같이 잡아야 한다.

필요한 최소 상태:

| 상태 | UI 의미 |
| -- | -- |
| `started` | Gateway가 요청을 받음 |
| `first_token` | Provider 응답이 시작됨 |
| `completed` | 정상 완료 |
| `client_aborted` | 사용자가 중단 |
| `provider_timeout` | Provider 지연/실패 |
| `policy_blocked` | Provider 호출 전 차단 |

v1.x thin slice에서는 Request Log에 최종 상태만 보여줘도 되지만, v2 계약에는 streaming lifecycle을 확장할 자리를 남겨야 한다.

### 5. 청중 참여형 데모는 preset 중심이 맞다

청중 참여 또는 simulator는 Dashboard가 살아 움직이는 장면을 만드는 데 필요하다.
다만 자유 입력을 바로 열면 보안, 비용, 발표 안정성 리스크가 커진다.

프론트 제안은 아래 순서다.

1. 운영자용 traffic simulator preset
2. 발표자 제어형 scenario runner
3. 제한된 audience input
4. 리허설과 안전장치가 확인된 뒤 공개 입력

Demo App은 끝까지 Gateway만 호출해야 하고 Provider 직접 호출은 없어야 한다.
또한 화면에는 raw prompt, raw response, API Key, App Token, Authorization header 원문이 절대 나오면 안 된다.

## 프론트가 v2 main path에서 맡아야 할 것

| 항목 | 설명 | 의존 계약 |
| -- | -- | -- |
| Organization Dashboard | 조직 전체 traffic, cost, safety, cache, routing 요약 | Dashboard aggregate API |
| Scope Drilldown | tenant/project/application/team/user group 기준 drilldown | scope query contract |
| Request Log / Detail v2 | RuntimeSnapshot, cache reuse, routing, streaming/error 상태 표시 | request detail contract |
| Employee Chat UI | 직원이 쓰는 내부 Chat UI, Gateway-only 호출 | Gateway BFF contract |
| Application API Preset | API 사용 고객사 앱 시나리오 | Gateway request scenario contract |
| Traffic Simulator | 발표자가 traffic을 만들고 Dashboard 반영 확인 | simulator scenario contract |
| Live/Fallback Mode | live API 실패 시 fixture로 데모 지속 | fixture parity contract |

## 프론트가 생산해야 하는 것

프론트는 canonical 정책 판단을 생산하지 않는다.
대신 아래 산출물을 생산할 수 있다.

| 산출물 | 소비자 |
| -- | -- |
| v2 demo scenario flow | 전체 팀 |
| 화면별 필요한 read model 목록 | Control Plane, Observability |
| Dashboard/Detail fixture schema 요구사항 | Observability, Gateway |
| Demo fallback UX | 발표자, 전체 팀 |
| Web Console navigation proposal | 전체 팀 |

## 결정이 필요한 항목

팀 결정이 필요한 항목은 `docs/team-debate/v2.0.0/kyumin/have-to-decision.md`에 따로 정리한다.
README에는 프론트 관점의 방향과 근거만 남기고, 회의에서 결정해야 할 항목은 별도 문서에서 추적한다.

## 현재 결론

지섭님 제안은 v2 방향으로 타당하다.
프론트 관점의 보완점은 "조직 기반 LLMOps"를 말로만 선언하지 않고, 화면에서 설명 가능한 read model과 navigation 계약을 v2 초기에 같이 고정해야 한다는 것이다.

Web Console은 Gateway의 정책 판단을 대신하지 않는다.
대신 Gateway, Control Plane, Observability가 생산한 결과를 관리자가 이해하고 조작할 수 있는 제품 경험으로 묶는 역할을 해야 한다.
