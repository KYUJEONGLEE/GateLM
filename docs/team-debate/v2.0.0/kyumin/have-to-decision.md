# Have-To Decisions - 김규민

> 공식 계약이 아니라 Product Experience & Demo / Web Console 관점에서 팀 결정이 필요한 항목을 모은 토론 메모입니다.
> 합의된 내용만 이후 `docs/v2.0.0/contracts.md` 또는 `docs/v2.0.0/implementation-plan.md`로 옮깁니다.

## 빠른 결정 요약

| No | 결정할 것 | 추천안 | 영향 범위 | 우선순위 | 상태 |
| -- | -- | -- | -- | -- | -- |
| 1 | v2 Web Console 정보 구조 | Dashboard / Management / Analytics / Demo / Settings 분리 | Web, Demo, 발표 동선 | P0 | 미결정 |
| 2 | `tenantId`, `teamId`, `budgetScopeId` UI 표현 | Gateway core identity는 유지하고 scope read model로 표현 | Gateway, Control Plane, Web, Observability | P0 | 미결정 |
| 3 | 직원 Chat UI의 Application boundary | Internal Chat Application으로 Application boundary 유지 | Gateway, Control Plane, Web, Observability | P0 | 미결정 |
| 4 | RuntimeSnapshot UI 최소 필드 | version/hash/published metadata 제공 | Control Plane, Gateway, Web, Observability | P0 | 미결정 |
| 5 | raw prompt/response 저장 opt-in | 기본 금지, 별도 권한/retention/encryption 계약 전까지 UI 미제공 | Security, Gateway, Observability, Web | P0 | 미결정 |
| 6 | Streaming 범위와 UI 상태 | v1.x thin slice는 최종 상태, v2는 lifecycle 확장 | Gateway, Web, Observability | P1 | 미결정 |
| 7 | 청중 참여형 데모 입력 방식 | preset -> controlled input -> limited free input 순서 | Web, Gateway, Safety | P1 | 미결정 |
| 8 | Dashboard polling/realtime 범위 | v2.0.0은 polling 우선, realtime은 v2.x 후보 | Web, Observability, Gateway | P1 | 미결정 |
| 9 | Dashboard aggregate grain | 모든 조합을 열지 않고 Overview/Cost/Safety/Cache/Routing 우선 grain 제한 | Web, Observability, Gateway | P0 | 추천안 있음 |
| 10 | Request outcome taxonomy | terminal status 유지 + domain별 outcome group 분리 | Gateway, Web, Observability, Safety | P0 | 추천안 있음 |
| 11 | 권한별 safety detail 노출 | Employee는 최소 안내, Admin만 redacted detail과 policy summary | Web, Gateway, Safety, Observability | P0 | 추천안 있음 |
| 12 | Semantic Cache UI 표현 범위 | v2 core가 아니라 evidence track으로 표시 | Web, Gateway, Safety, Observability | P1 | 추천안 있음 |
| 13 | policy publish/reload 실패 UX | invalid publish 차단과 last known safe 상태를 UI에 명확히 표시 | Web, Control Plane, Gateway, Observability | P0 | 추천안 있음 |

## 1. v2 Web Console 정보 구조

### 왜 결정해야 하나?

v2.0.0의 제품 메시지가 조직 기반 LLMOps라면 Web Console의 정보 구조가 제품 인상을 결정한다.
`Demo`와 `Admin Dashboard`가 섞이면 발표 화면은 화려해져도 실제 운영 콘솔처럼 보이지 않는다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | v1 구조 유지 | 구현 변경 적음 | 조직/팀/운영 관제가 약해 보임 |
| B | Dashboard / Management / Analytics / Demo / Settings 분리 | 운영 콘솔과 데모 흐름을 분리 가능 | 초기 navigation/fixture 계약 필요 |
| C | Demo 중심 단일 UX | 발표 동선은 빠름 | 제품성이 약해지고 toy project처럼 보일 위험 |

### 추천안

B안을 추천한다.
운영자는 Dashboard와 Analytics에서 관제하고, 발표자는 Demo 영역에서 traffic을 만든 뒤 Dashboard 반영을 보여주는 구조가 가장 설명 가능하다.

### 결정 전까지 안전한 기본값

현재 UI polish 브랜치의 좌측 navigation 구조를 확장 가능한 기본값으로 둔다.
Demo 전용 화면은 운영 Dashboard 하위에 넣지 않는다.

### 영향을 받는 역할

김규민, 이규정, 이지섭, 재혁님

## 2. `tenantId`, `teamId`, `budgetScopeId` UI 표현

### 왜 결정해야 하나?

팀 단위 비용/정책 관제를 보여주려면 `team` 개념이 필요하다.
하지만 `teamId`를 Gateway core identity로 바로 넣으면 v1의 `tenantId/projectId/applicationId` 계약과 Request Log/Dashboard 집계 기준이 흔들릴 수 있다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | `teamId`를 GatewayContext core field로 추가 | 팀 단위 표현이 직접적 | 기존 계약 변경 폭이 큼 |
| B | `budgetScopeType`, `budgetScopeId`로 표현 | team/project/application/tenant 확장 가능 | UI에서 display metadata가 별도 필요 |
| C | v2에서는 team 미지원 | 단순함 | 조직 기반 LLMOps 메시지가 약함 |

### 추천안

B안을 추천한다.
Web은 `scopeType`, `scopeId`, `scopeDisplayName` read model을 소비하고, canonical identity 변경은 신중히 다룬다.

### 결정 전까지 안전한 기본값

Dashboard 필터 UI는 `Scope`로 설계하고 `Team`에 고정하지 않는다.

### 영향을 받는 역할

이지섭, 재혁님, 이규정, 김규민

## 3. 직원 Chat UI의 Application boundary

### 왜 결정해야 하나?

직원 Chat UI도 Gateway 정책, 로그, 비용 관리 대상이어야 한다.
Application boundary가 없으면 인증, rate limit, runtime policy, request log 연결이 흐려진다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | 직원 Chat UI를 Internal Chat Application으로 등록 | v1 Application 계약 재사용 | Control Plane에 내부 앱 개념 필요 |
| B | 직원 Chat UI를 별도 identity로 취급 | UX 표현은 명확 | Gateway/Log 계약 분기 증가 |
| C | 직원 Chat UI는 데모 전용 fixture로만 둠 | 구현 쉬움 | v2 제품 목표와 약함 |

### 추천안

A안을 추천한다.
직원 Chat UI도 고객사 Application 중 하나로 보고 Gateway만 호출해야 한다.

### 결정 전까지 안전한 기본값

Web에서는 직원 Chat을 `applicationType=internal_chat`처럼 표시할 수 있게 UI를 설계하되, 실제 필드명은 공식 계약 전까지 확정하지 않는다.

### 영향을 받는 역할

김규민, 재혁님, 이지섭, 이규정

## 4. RuntimeSnapshot UI 최소 필드

### 왜 결정해야 하나?

v2의 핵심 장면은 관리자가 정책을 바꿨고 다음 요청 결과에 반영됐다는 것을 보여주는 것이다.
이를 설명하려면 Request Detail과 RuntimeSnapshot 화면을 연결할 최소 metadata가 필요하다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | hash만 표시 | 구현 단순 | 관리자 UX가 설명하기 어려움 |
| B | snapshot id/version/published metadata/hash 제공 | 요청과 설정 변경 연결 가능 | read model 계약 필요 |
| C | UI에서는 RuntimeSnapshot 숨김 | 화면 단순 | v2 핵심 메시지 약화 |

### 추천안

B안을 추천한다.
`runtimeSnapshotId`, `runtimeSnapshotVersion`, `publishedAt`, `publishedBy`, `configHash`, `routingPolicyHash`, `safetyPolicyHash`, `rateLimitPolicyHash` 정도를 최소 후보로 둔다.

### 결정 전까지 안전한 기본값

Web은 hash를 계산하지 않고, API가 제공한 값을 표시만 한다.

### 영향을 받는 역할

재혁님, 이지섭, 이규정, 김규민

## 5. raw prompt/response 저장 opt-in

### 왜 결정해야 하나?

raw prompt/response 저장은 보안, 개인정보, 고객 신뢰도, UI 접근 제어에 직접 영향을 준다.
프론트에서 한번 노출 UX를 만들면 이후 되돌리기 어렵다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | 계속 전면 금지 | 안전하고 v1 원칙 유지 | 디버깅 정보 제한 |
| B | opt-in으로 제한 허용 | enterprise debugging 설명 가능 | retention/access/encryption 계약 필요 |
| C | 개발/데모에서만 허용 | 개발 편함 | 실수로 신뢰도 훼손 위험 |

### 추천안

현재는 A안을 기본값으로 두고, B안은 별도 보안 계약이 생긴 뒤 검토한다.
UI에는 raw prompt/raw response 열람 화면을 만들지 않는다.

### 결정 전까지 안전한 기본값

redacted preview, masking action, policy result, prompt hash 같은 metadata만 표시한다.

### 영향을 받는 역할

전체 역할

## 6. Streaming 범위와 UI 상태

### 왜 결정해야 하나?

Streaming은 Chat UX 체감에 중요하지만, Request Log와 Detail에는 중간 상태와 실패 상태가 생긴다.
이 상태를 계약 없이 구현하면 Web과 Observability가 서로 다른 의미로 표시할 수 있다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | v2까지 streaming 제외 | 단순함 | LLM 제품 체감 약함 |
| B | v1.x thin slice, v2 lifecycle 확장 | 점진적 검증 가능 | 상태 계약 필요 |
| C | v2에서 full streaming normalization | 완성도 높음 | 범위가 커짐 |

### 추천안

B안을 추천한다.
v1.x에서는 safe streaming demo와 최종 log 상태를 먼저 붙이고, v2에서는 `started`, `first_token`, `completed`, `client_aborted`, `provider_timeout`, `policy_blocked` 같은 lifecycle을 검토한다.

### 결정 전까지 안전한 기본값

Request Log는 최종 상태 중심으로 표시하고, 중간 event timeline은 v2 계약 전까지 필수 UI로 만들지 않는다.

### 영향을 받는 역할

이지섭, 이규정, 김규민

## 7. 청중 참여형 데모 입력 방식

### 왜 결정해야 하나?

청중 참여형 입력은 Dashboard가 살아 움직이는 효과가 있지만, 보안/비용/발표 안정성 리스크도 크다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | preset simulator만 사용 | 안정적 | 참여감은 약함 |
| B | 발표자 제어형 scenario runner | 안정성과 동적 데모 균형 | UI 준비 필요 |
| C | 제한 자유 입력 | 참여감 높음 | 안전장치 필요 |
| D | 완전 자유 입력 | 강한 데모 효과 | 리스크가 큼 |

### 추천안

A -> B -> C 순서로 확장한다.
v2.0.0 목표에는 B까지를 main path로 두고 C는 리허설 후 판단한다.

### 결정 전까지 안전한 기본값

preset 중심으로 구현한다.
자유 입력은 허용하더라도 Gateway safety와 rate limit이 준비된 뒤 제한적으로만 연다.

### 영향을 받는 역할

김규민, 이지섭, 이윤지, 이규정

## 8. Dashboard polling/realtime 범위

### 왜 결정해야 하나?

v2 데모에서는 traffic simulator 요청이 Dashboard에 반영되는 장면이 중요하다.
하지만 realtime stack을 성급히 도입하면 구현 범위가 커지고 운영 근거 없이 기술만 늘어날 수 있다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | 수동 refresh | 단순함 | 데모 체감 약함 |
| B | 짧은 interval polling | 구현 단순, 데모 충분 | query 부하 관리 필요 |
| C | SSE/WebSocket realtime | 체감 좋음 | Gateway/Observability/Web 범위 증가 |

### 추천안

v2.0.0은 B안을 추천한다.
Polling interval과 query cost를 k6/query profile 기준으로 조정하고, SSE/WebSocket은 v2.x 후보로 둔다.

### 결정 전까지 안전한 기본값

Web은 polling을 끄고 켤 수 있는 구조로 만들고, fixture fallback에서도 같은 화면 흐름을 유지한다.

### 영향을 받는 역할

김규민, 이규정, 이지섭

## 9. Dashboard aggregate grain

### 왜 결정해야 하나?

Web Console 화면 구조와 Observability read model이 맞지 않으면 Dashboard는 많은 차트를 갖고도 설명력이 약해진다.
모든 dimension 조합을 열면 query 비용과 UI 복잡도가 같이 커진다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | v1 overview만 확장 | 빠름 | 조직 기반 LLMOps 메시지가 약함 |
| B | Overview/Cost/Safety/Cache/Routing 우선 grain 제한 | 제품 메시지와 query profile을 같이 관리 가능 | 화면별 read model 합의 필요 |
| C | 모든 dimension 조합 지원 | 유연함 | v2.0.0에는 과하고 성능 리스크 큼 |

### 추천안

B안을 추천한다.
프론트는 `Organization Overview`, `Cost / Usage`, `Safety`, `Cache`, `Routing` 화면별로 필요한 grain을 먼저 고정하고 그 외 ad-hoc 분석은 v2.x로 미룬다.

### 결정 전까지 안전한 기본값

v1 Dashboard overview를 유지하고, 추가 grain은 fixture/read model draft로만 실험한다.

### 영향을 받는 역할

김규민, 이규정, 이지섭, 재혁님

## 10. Request outcome taxonomy

### 왜 결정해야 하나?

v2에서는 cache, safety, routing, budget, provider failover, streaming outcome이 한 요청에 동시에 붙을 수 있다.
Web이 임의로 badge와 label을 만들면 Dashboard count와 Request Detail 설명이 어긋날 수 있다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | v1 terminal status만 계속 확장 | 단순함 | status가 너무 많은 의미를 떠안음 |
| B | terminal status는 유지하고 domain별 outcome group 분리 | 목록/집계/상세 설명이 명확 | read model 합의 필요 |
| C | event timeline 중심으로 전면 재설계 | 장기 확장성 높음 | v2.0.0에는 범위가 큼 |

### 추천안

B안을 추천한다.
Request Log 목록은 terminal status 중심으로 유지하고, Detail에서 cache/safety/routing/budget/provider/streaming outcome을 나눠 보여주는 구조가 좋다.

### 결정 전까지 안전한 기본값

v1 terminal status와 error code를 유지한다.
새 outcome은 공식 계약 전까지 fixture나 문서의 후보 개념으로만 둔다.

### 영향을 받는 역할

이지섭, 이규정, 김규민, 이윤지

## 11. 권한별 safety detail 노출

### 왜 결정해야 하나?

직원 Chat UI와 Admin Request Detail은 같은 safety 결과를 보더라도 노출 목적이 다르다.
Employee에게 detector detail이나 redacted preview를 과하게 보여주면 우회 힌트가 될 수 있고, Admin에게 너무 적게 보여주면 운영 분석이 어렵다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | 모든 사용자에게 최소 안내만 표시 | 가장 안전함 | Admin 분석력이 약함 |
| B | Employee에게도 detector detail 표시 | 사용자 교육 가능 | 우회 힌트와 노출 리스크 |
| C | Employee는 최소 안내, Admin은 redacted detail/policy summary 표시 | 안전성과 운영 분석 균형 | 권한별 UI/read model 필요 |

### 추천안

C안을 추천한다.
Employee Chat은 짧은 안내와 재작성 유도만 제공하고, Admin Request Detail에서만 redacted preview, detector type summary, policy/snapshot 연결 정보를 제공한다.

### 결정 전까지 안전한 기본값

Employee UI에는 raw value, redacted preview, sample hash, credential prefix/suffix를 노출하지 않는다.
Admin UI도 raw prompt/raw response/secret 원문은 표시하지 않는다.

### 영향을 받는 역할

김규민, 이윤지, 이지섭, 이규정

## 12. Semantic Cache UI 표현 범위

### 왜 결정해야 하나?

Semantic Cache는 비용 절감 메시지가 강하지만 false hit, policy mismatch, raw prompt/embedding material 리스크가 있다.
UI가 이를 Exact Cache와 같은 안정된 main path 기능처럼 보여주면 제품 신뢰도가 깨질 수 있다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | v2 main Dashboard에 cache 기능으로 노출 | 데모 임팩트 큼 | 안전/품질 근거 전에는 위험 |
| B | evidence/lab track으로만 표시 | 실험과 제품 기능을 구분 | 데모 임팩트는 낮음 |
| C | v2에서는 UI 미노출 | 가장 안전 | v2 cache 고도화 논의가 약해짐 |

### 추천안

B안을 추천한다.
Web에서는 `Exact Cache`와 `Semantic Cache Candidate`를 명확히 구분하고, Semantic Cache는 policy gate와 safety evidence가 붙은 실험 결과로만 표현한다.

### 결정 전까지 안전한 기본값

v2 core 화면에는 Exact Cache saving을 중심으로 표시한다.
Semantic Cache 후보는 raw prompt/raw response/실제 개인정보/실제 secret 없이 synthetic evidence로만 다룬다.

### 영향을 받는 역할

김규민, 이지섭, 이윤지, 이규정

## 13. policy publish/reload 실패 UX

### 왜 결정해야 하나?

v2의 핵심 장면은 관리자가 만든 정책이 Gateway runtime에 반영되는 것이다.
하지만 invalid publish, reload failure, stale runtime 상태를 UI가 숨기면 관리자는 정책이 적용됐는지 오해할 수 있다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | 성공 상태만 표시 | 화면 단순 | 실패 시 신뢰도 하락 |
| B | validation failed/published/last known safe를 구분 | 운영 상태 설명 가능 | Control Plane/Gateway 상태 계약 필요 |
| C | full audit timeline까지 표시 | 강력한 운영 UX | v2.0.0에는 범위가 클 수 있음 |

### 추천안

B안을 추천한다.
Web Console은 invalid publish 차단, published 상태, Gateway가 last known safe를 쓰는 상태, fixture fallback 상태를 구분해서 보여줘야 한다.

### 결정 전까지 안전한 기본값

live publish 상태가 불명확하면 Web은 "적용됨"처럼 표시하지 않는다.
데모에서는 sanitized fixture fallback으로 같은 메시지를 유지한다.

### 영향을 받는 역할

김규민, 재혁님, 이지섭, 이규정
---

## Codex 추가 결정 후보 - 2026-06-29

> 아래 항목은 Product/Web Console 관점의 추가 결정 후보입니다. 실제 필드명이나 API 계약이 아니라 회의용 라벨입니다.

| No | 결정할 것 | 추천안 | 영향 범위 | 우선순위 | 상태 |
| -- | -- | -- | -- | -- | -- |
| P-1 | 직원 Chat UI의 Application boundary | v2.0.0은 Application preset 기반, 완전 자유 입력은 데모 후보로 제한 | Web, Gateway, Safety | P0 | 결정 필요 |
| P-2 | 운영자 화면의 main path | 정책 수정/배포/롤백, 예산 제한, 라우팅/장애 evidence를 한 흐름으로 구성 | Web, Control Plane | P0 | 결정 필요 |
| P-3 | raw prompt/response 노출 | 기본 미노출, redacted preview와 synthetic evidence 사용 | Web, Safety, 발표 | P0 | 결정 필요 |
| P-4 | 청중 참여형 데모 입력 | preset + 제한된 자유 입력 중 선택 | Web, 발표, Safety | P1 | 결정 필요 |
| P-5 | Streaming UI 범위 | 실제 provider 연결이 안정화된 뒤 얇은 UX로 제한 | Web, Gateway | P1 | 보류 |

### 결정 전까지 안전한 기본값

- Web Console은 "운영자가 바꾸고 검증하는 화면"을 중심으로 잡는다.
- 직원 Chat UI는 v2 evidence 보조 화면으로 두고, 조직/Application 경계가 흔들리면 범위를 줄인다.
- 원문 노출 없이도 발표 가능한 dashboard, request detail, policy rollout evidence를 우선한다.
