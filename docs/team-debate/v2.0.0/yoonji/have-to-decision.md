# Have-To Decisions - 이윤지

> 공식 계약이 아니라 AI Safety & Evaluation Lab 관점에서 팀 결정이 필요한 항목을 모으는 토론 메모입니다.
> Codex가 임의로 결정하면 위험한 항목만 적습니다.
> 합의된 내용은 나중에 공식 `docs/v2.0.0/*` 문서로 옮깁니다.

## 빠른 결정 요약

| No | 결정할 것 | 추천안 | 영향 범위 | 우선순위 | 상태 |
| -- | -- | -- | -- | -- | -- |
| 1 | raw prompt/response 저장 opt-in 여부 | v2.0.0 기본값은 금지 유지, opt-in은 v2.x 별도 계약으로 분리 | Gateway, Web, Observability, Control Plane, Security | P0 | 추천안 있음 |
| 2 | RemoteSafetyEngine의 권한 | v2.0.0 전까지 shadow/evaluation 기본, enforce는 별도 계약 후 | Gateway, Safety Lab, Control Plane | P0 | 추천안 있음 |
| 3 | v2 safety category 범위 | corpus와 report가 있는 category만 main path 후보, 나머지는 evidence path | Safety Lab, Gateway, Web, Observability | P0 | 추천안 있음 |
| 4 | 직원 Chat UI의 safety 노출 경계 | Application boundary 유지, Employee에게는 최소 안내, Admin에게만 redacted detail | Web, Gateway, Safety Lab, Observability | P0 | 추천안 있음 |
| 5 | Streaming safety 범위 | v1.x는 request-side pre-provider safety, response-side scan은 evidence path | Gateway, Web, Observability, Safety Lab | P1 | 추천안 있음 |
| 6 | 청중 참여형 데모 입력 방식 | preset 중심, 제한 자유 입력은 리허설과 guardrail 확인 후 | Web, Gateway, Safety Lab, 발표자 | P1 | 추천안 있음 |
| 7 | Semantic Cache safety gate | v2 core가 아니라 evidence track, raw prompt 없는 redacted 기준 실험 | Gateway, Safety Lab, Observability, Web | P1 | 추천안 있음 |

## 1. Raw Prompt/Response 저장 opt-in 여부

### 왜 결정해야 하나?

원문 저장은 Safety Lab만의 문제가 아니다.
DB, Request Detail, Dashboard, 권한, retention, 암호화, audit, demo 신뢰도까지 모두 영향을 받는다.
팀이 명시적으로 결정하지 않은 상태에서 누군가 "디버깅 편의"로 원문 저장을 열면 GateLM의 핵심 보안 메시지가 깨진다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | v2.0.0에서도 raw prompt/response 저장 금지 유지 | 보안 메시지가 명확하고 v1 계약과 일관된다. | 일부 디버깅과 품질 분석이 어렵다. |
| B | 특정 tenant/project에서 opt-in 허용 | 실제 운영 요구에 가까운 논의를 할 수 있다. | 접근 제어, 암호화, retention, audit, UI 노출 정책을 모두 정해야 한다. |
| C | demo/dev 환경에서만 임시 허용 | 개발 편의성이 높다. | 습관적으로 fixture나 log에 원문이 남을 위험이 크다. |

### 추천안

A를 v2.0.0 기본값으로 둔다.
Opt-in은 v2.x 후보로 분리하고, 별도 계약에서 암호화, retention, 접근 제어, audit, UI 노출 범위를 먼저 결정한다.

### 결정 전까지 안전한 기본값

raw prompt, raw response, raw detected sensitive value는 저장하지 않는다.
평가와 데모에는 synthetic corpus, redacted preview, hash, aggregate만 사용한다.

### 영향을 받는 역할

전체 역할.
특히 Gateway, Observability, Web, Control Plane, Safety Lab 모두 영향을 받는다.

## 2. RemoteSafetyEngine의 권한

### 왜 결정해야 하나?

Python/FastAPI 기반 RemoteSafetyEngine은 v2 safety 고도화의 좋은 실험 축이다.
하지만 이를 Gateway hot path의 필수 blocking dependency로 만들면 latency, availability, fallback, 책임 경계가 모두 복잡해진다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | shadow/evaluation only | Gateway 안정성을 유지하면서 품질 근거를 모을 수 있다. | 즉시 제품 기능으로 보이는 힘은 약하다. |
| B | 일부 category만 enforce 허용 | 고급 safety를 제품 기능처럼 보여줄 수 있다. | 장애/latency/fallback 계약이 먼저 필요하다. |
| C | 모든 safety 판단을 remote로 위임 | Safety Lab이 빠르게 실험할 수 있다. | Gateway baseline과 v1 계약의 안정성을 크게 흔든다. |

### 추천안

v2.0.0 전까지 A를 기본으로 둔다.
B는 latency budget, fallback rule, fail-open/fail-closed 기준, evaluation report, 장애 시 Gateway behavior가 합의된 뒤에만 검토한다.

### 결정 전까지 안전한 기본값

Rule-based Gateway SafetyEngine이 main path를 담당한다.
RemoteSafetyEngine은 shadow/evaluation 결과만 남기며 client response를 바꾸지 않는다.

### 영향을 받는 역할

이지섭, 이윤지, 재혁님, 이규정.
Web은 shadow 결과를 보여줄지 여부에서 영향을 받는다.

## 3. v2 Safety Category 범위

### 왜 결정해야 하나?

v2에서 prompt injection, toxicity, 내부 기밀 키워드, employee id, account id 같은 category를 모두 넣고 싶어질 수 있다.
하지만 detector category는 action, corpus, report, dashboard, demo 설명까지 연결되어야 한다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | v1 category 중심 유지, v2 후보는 evidence path | 안정적이고 설명 가능하다. | v2 확장성이 약해 보일 수 있다. |
| B | corpus와 report가 있는 category만 main path 후보 | 확장성과 안전성의 균형이 좋다. | category별 준비 기준을 엄격히 관리해야 한다. |
| C | v2에서 여러 category를 먼저 추가 | 기능 목록이 풍부해 보인다. | false positive와 계약 혼란이 커질 수 있다. |

### 추천안

B를 추천한다.
각 category는 synthetic corpus, expected outcome, false positive/negative report, latency impact가 있어야 main path 후보가 된다.

### 결정 전까지 안전한 기본값

v1 계약의 email, phone, resident registration number, api key, authorization header, jwt, private key 기준을 main path로 유지한다.
새 category는 evidence path로만 문서화한다.

### 영향을 받는 역할

Safety Lab, Gateway, Control Plane, Web, Observability.

## 4. 직원 Chat UI의 Safety 노출 경계

### 왜 결정해야 하나?

직원 Chat UI는 Application API preset보다 자유 입력 가능성이 높고, 사용자가 policy block을 직접 경험한다.
이때 사용자에게 너무 많은 detection detail을 보여주면 우회 힌트가 될 수 있고, 너무 적게 보여주면 제품 경험이 나빠진다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | Employee에게 최소 안내만 표시 | 우회 힌트를 줄인다. | 왜 막혔는지 이해하기 어렵다. |
| B | Employee에게 detected type까지 표시 | 사용자 교육 효과가 있다. | 민감정보 유형이 우회 힌트가 될 수 있다. |
| C | Admin detail에만 redacted preview와 policy 정보를 표시 | 운영자는 분석 가능하고 직원 노출은 줄인다. | Web 권한별 UI가 필요하다. |

### 추천안

A와 C의 조합을 추천한다.
Employee에게는 짧은 안내를 보여주고, Project/Tenant Admin에게만 redacted preview와 policy 요약을 보여준다.

### 결정 전까지 안전한 기본값

Employee UI에는 raw value, redacted preview, sample hash, secret prefix/suffix를 노출하지 않는다.
내부 Chat도 Application boundary 안에서 Gateway만 호출한다.

### 영향을 받는 역할

김규민, 이지섭, 이윤지, 이규정.

## 5. Streaming Safety 범위

### 왜 결정해야 하나?

Streaming을 시작하면 응답 도중 client abort, provider timeout, partial response 같은 상태가 생긴다.
Safety가 어느 시점까지 책임지는지 정하지 않으면 Request Log, Dashboard, 사용자 경험이 흔들린다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | request-side pre-provider safety만 v1.x thin slice | 단순하고 v1 pipeline 원칙을 지킨다. | provider response에 대한 safety는 다루지 못한다. |
| B | response-side scan을 monitor로 추가 | 향후 고도화 근거를 모을 수 있다. | streaming latency와 partial output 처리 기준이 필요하다. |
| C | streaming response도 실시간 block/redact | 강력해 보인다. | UX, latency, log, provider adapter 복잡도가 크다. |

### 추천안

v1.x는 A를 기본으로 두고, B는 evidence path로 검토한다.
C는 v2.0.0 범위가 아니라 후속 고도화로 보는 편이 안전하다.

### 결정 전까지 안전한 기본값

Streaming 요청도 Provider 호출 전 request-side safety를 먼저 통과해야 한다.
response-side safety 결과는 공식 계약 전까지 client response를 바꾸지 않는다.

### 영향을 받는 역할

이지섭, 김규민, 이규정, 이윤지.

## 6. 청중 참여형 데모 입력 방식

### 왜 결정해야 하나?

청중 참여형 입력은 Dashboard가 살아 움직이는 장면을 만들 수 있지만, 발표 중 실제 개인정보나 secret이 입력될 위험이 있다.
Safety Lab이 아무리 detector를 준비해도 발표 안정성은 별도 guardrail이 필요하다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | preset scenario만 사용 | 가장 안정적이고 반복 가능하다. | 생동감이 약할 수 있다. |
| B | 발표자 제어형 traffic simulator | 안정성과 live 느낌의 균형이 좋다. | 구현과 리허설이 필요하다. |
| C | 제한된 자유 입력 허용 | 청중 참여감이 높다. | 보안, 비용, 발표 실패 리스크가 크다. |

### 추천안

A와 B를 기본으로 준비하고, C는 리허설과 안전장치 확인 후 제한적으로만 검토한다.
자유 입력을 열더라도 synthetic prompt guide, rate limit, block fallback, emergency stop이 필요하다.

### 결정 전까지 안전한 기본값

데모 입력은 preset과 synthetic data만 사용한다.
실제 secret, 실제 개인정보, production log 복사본은 사용하지 않는다.

### 영향을 받는 역할

김규민, 이지섭, 이윤지, 이규정, 발표자.

## 7. Semantic Cache Safety Gate

### 왜 결정해야 하나?

Semantic Cache는 비용 절감 메시지가 강하지만 safety risk도 크다.
유사도가 높은 이전 응답을 재사용하면 false hit가 생길 수 있고, embedding/cache material에 raw prompt가 들어가면 v1의 보안 원칙과 충돌한다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | v2.0.0 core 기능으로 포함 | 비용 절감 데모가 강하다. | false hit, raw prompt, policy mismatch 리스크가 크다. |
| B | evidence track으로 분리 | 안전성 검증과 제품 범위를 분리할 수 있다. | v2 main path의 기능 임팩트는 낮아진다. |
| C | v2 이후로 보류 | v2 범위가 단순해진다. | cache 고도화 evidence를 준비하기 어렵다. |

### 추천안

B를 추천한다.
Semantic Cache는 redacted prompt 기준 embedding, policy gate, bypass reason, false hit review를 evidence로 먼저 검토한다.

### 결정 전까지 안전한 기본값

v2 core는 exact cache를 유지한다.
Semantic Cache 실험에는 raw prompt, raw response, 실제 개인정보, 실제 secret을 사용하지 않는다.

### 영향을 받는 역할

이지섭, 이윤지, 이규정, 김규민.
---

## Codex 추가 결정 후보 - 2026-06-29

> 아래 항목은 Safety 관점의 추가 결정 후보입니다. 실제 필드명이나 API 계약이 아니라 회의용 라벨입니다.

| No | 결정할 것 | 추천안 | 영향 범위 | 우선순위 | 상태 |
| -- | -- | -- | -- | -- | -- |
| S-1 | raw prompt/response 저장 opt-in | v2.0.0 기본 저장 금지, v2.x 후속 검토 | Safety, Web, DB, 발표 | P0 | 결정 필요 |
| S-2 | Safety main path 범위 | PII/secret redaction + block/allow 최소화 | Gateway, Safety | P0 | 결정 필요 |
| S-3 | Detector 확장 범위 | injection/toxicity는 shadow corpus와 report 중심 | Safety, 발표 | P1 | 보류 |
| S-4 | RemoteSafetyEngine runtime dependency | v2.0.0에서는 장애 시 Gateway 성공률을 해치지 않는 shadow 또는 optional 경로 | Gateway, AI service | P1 | 결정 필요 |
| S-5 | 데모 입력 제한 | synthetic/preset 우선, 자유 입력은 안전장치가 확인된 뒤 선택 | Web, 발표 | P0 | 결정 필요 |

### 결정 전까지 안전한 기본값

- provider 호출 전 최소 redaction/block을 수행한다.
- 원문 저장과 원문 UI 노출은 하지 않는다.
- category 확장은 corpus, expected outcome, FP/FN report가 있는 항목만 main path 후보로 올린다.
