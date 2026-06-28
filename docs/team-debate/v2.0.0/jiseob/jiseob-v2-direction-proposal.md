# GateLM v2.0.0 방향 제안 - 이지섭

> 이 문서는 이지섭 / Gateway Data Plane & Governance 관점의 v2.0.0 토론 초안이다.
> 공식 계약, 최종 release plan, 팀 합의 문서가 아니다.
> 다른 역할 Codex와 팀원은 이 문서에 동의, 반대, 보완 의견을 남길 수 있다.
> 합의된 내용만 이후 `docs/v2.0.0/contracts.md` 또는 `docs/v2.0.0/implementation-plan.md`로 승격한다.

## 1. 현재 관점

`v1.0.0-rc.1`은 GateLM의 B2B LLM Gateway baseline을 고정한 release candidate다.

내가 보는 다음 단계의 버전 의미는 아래와 같다.

```text
v1.0.0-rc.1
= 현재까지 만든 Gateway baseline 후보

v1.x
= v2.0.0 목표로 가는 과정
= 빠진 제품 연결, 실제 Provider, streaming, runtime config, 성능 evidence를 점진적으로 붙이는 구간

v2.0.0
= 목표
= 조직 기반 LLMOps Gateway MVP로 설명 가능한 상태
```

즉, v1.x는 단순한 v1 polish가 아니라 v2.0.0 목표로 수렴하는 release train이다.
v2.0.0은 갑자기 모든 것을 새로 만드는 버전이 아니라, v1.x에서 검증한 조각들이 모여 제품 정의가 바뀌는 지점이어야 한다.

## 2. v2.0.0 제품 목표 제안

GateLM v2.0.0은 직원 Chat UI와 Application API 요청을 모두 Gateway로 모으고,
RuntimeSnapshot 기반 정책으로 인증, safety, cache, routing, provider call, log를 처리하며,
Admin Dashboard에서 조직, 팀, 사용자, Application 단위의 비용, 보안 이벤트, cache 절감, routing 결과를 관제하는 LLMOps Gateway MVP다.

발표와 데모에서 보여주고 싶은 핵심 인상은 아래와 같다.

```text
관중 또는 simulator가 여러 직원/팀/Application 요청을 만든다
-> 모든 요청은 Provider가 아니라 GateLM Gateway를 통과한다
-> 관리자는 Admin Dashboard만 보고 traffic, 비용, 보안 이벤트, cache hit, routing 결과를 확인한다
-> 필요한 정책 조정이 다음 요청 결과에 반영된다
```

v2.0.0의 주인공은 기술 목록이 아니라 관리자 대시보드에서 회사 전체 LLM traffic을 통제하는 장면이다.

## 3. 가까운 v1.x에서 붙여야 할 것

아래 항목들은 v2.0.0을 기다리기보다 v1.x 과정에서 점진적으로 붙이는 것이 좋다고 본다.

| 항목 | 이유 | 제안 시점 |
| -- | -- | -- |
| 실제 Provider adapter 1종 | Mock Provider만으로는 제품성이 약하다. Mock fallback은 계속 유지해야 한다. | v1.2 후보 |
| 모델 2개 이상 | 고성능/저비용 모델 routing을 설명하려면 최소 2개 모델이 필요하다. | v1.2 후보 |
| Live runtime config 또는 RuntimeSnapshot thin slice | Control Plane 설정이 Gateway 요청 결과에 영향을 주는 장면이 필요하다. | v1.2 후보 |
| Streaming 응답 thin slice | LLM 제품 체감에 중요하다. 처음에는 한 Provider 형식으로 얇게 시작한다. | v1.3 후보 |
| 청중 참여 또는 traffic simulator smoke | 최종 발표에서 Dashboard가 실제로 움직이는 근거가 필요하다. | v1.3 후보 |
| k6 baseline 강화 | 현재 k6는 release evidence에 가깝다. 성능 개선 기준으로 강화해야 한다. | v1.1 후보 |

## 4. v2.0.0에 한 번에 넣지 않을 것

이 프로젝트는 포트폴리오 프로젝트지만 toy project처럼 보이면 안 된다.
다만 엔터프라이즈 기술을 한 번에 많이 붙이는 것이 곧 엔터프라이즈스럽다는 뜻은 아니다.

성능과 데이터 플랫폼은 아래 순서를 우선 제안한다.

```text
1. 현재 PostgreSQL 로그/카운터 구조를 운영 가능하게 만든다
2. PostgreSQL partition 또는 TimescaleDB를 먼저 검토한다
3. k6 baseline과 query profile로 병목을 측정한다
4. 필요하면 outbox + async worker skeleton을 붙인다
5. Redpanda/ClickHouse는 PostgreSQL 한계가 측정된 뒤 검토한다
6. Envoy, stateless gateway, HA 구조는 multi-instance 요구가 구체화된 뒤 검토한다
```

따라서 v2.0.0 목표에 ClickHouse, Redpanda, Envoy를 필수로 넣는 것은 아직 이르다고 본다.
그 대신 v2.0.0은 조직 기반 LLMOps MVP를 완성하고, v2.x에서 성능/데이터 플랫폼 고도화를 이어가는 것이 더 안전하다.

## 5. 공통으로 합의해야 할 항목

아래 항목은 Codex가 암묵적으로 결정하면 안 된다.
각 역할 Codex는 자기 의견을 낼 수 있지만, 최종 계약으로 승격하기 전에 명시적으로 토론되어야 한다.

| 항목 | 왜 중요한가 | 현재 제안 |
| -- | -- | -- |
| v1.x와 v2.0.0 경계 | 구현 범위가 계속 커지는 것을 막아야 한다. | v1.x는 과정, v2.0.0은 조직 기반 LLMOps MVP 목표 |
| `tenantId`, `teamId`, `budgetScopeId` 관계 | GatewayContext, RuntimeSnapshot, Log, Dashboard에 모두 영향이 있다. | `tenantId`는 유지, `teamId`는 성급히 core identity로 넣지 말고 `budgetScope`로 검토 |
| 직원 Chat UI 요청의 Application boundary | 직원 요청도 Gateway 정책/로그 경계에 들어와야 한다. | Internal Chat Application처럼 Application boundary를 유지하는 방향 선호 |
| raw prompt/response 저장 opt-in | 보안, DB, UI, 데모 신뢰도에 직접 영향이 있다. | 기본 금지. 필요하면 별도 opt-in 계약, retention, access control, encryption 결정 후 |
| 실제 Provider 범위 | 비용, secret, adapter, failure handling에 영향이 있다. | Provider 1종, 모델 2개 이상, Mock fallback 유지 |
| Streaming 범위 | API, log, metrics, provider adapter에 영향이 있다. | v1.x thin slice 후 v2에서 normalization 확장 |
| 성능 개선 경로 | 기술 도입 순서가 프로젝트 신뢰도를 좌우한다. | PostgreSQL partition/TimescaleDB, k6 강화, query profile 먼저 |
| 청중 참여형 데모 입력 방식 | 발표 안정성과 보안에 영향이 있다. | preset 중심, 제한 자유 입력은 리허설 후 판단 |

## 6. `teamId`와 `budgetScopeId`에 대한 조심스러운 제안

v2 제품 메시지는 조직과 팀 단위 governance를 강조한다.
하지만 `teamId`를 곧바로 Gateway core identity로 넣으면 기존 `tenantId/projectId/applicationId` 계약 전체가 흔들릴 수 있다.

현재 제안은 아래와 같다.

```text
tenantId
= 고객사/조직 경계 canonical

projectId
= 업무/프로젝트 경계

applicationId
= Application/API 사용 경계

endUserId
= 직원 또는 고객사가 넘기는 최종 사용자 식별자

budgetScopeType
= team | project | application | tenant

budgetScopeId
= budget/routing 판단에 쓰이는 scope id
```

이렇게 하면 팀 budget을 표현하면서도 `teamId`를 `tenantId` 대체 identity처럼 쓰는 위험을 줄일 수 있다.
다만 이 결정은 Gateway, Control Plane, Web, Observability 모두에 영향이 있으므로 각 역할의 의견이 필요하다.

## 7. 역할별 main path와 shadow/evidence path

v2 계획은 모든 역할이 Gateway 구현 완료를 기다리는 구조가 되면 안 된다.
각 역할은 main path와 shadow/evidence path를 함께 가져야 한다.

### 김규민 - Product Experience & Demo

Main path:

- 조직 기반 Admin Dashboard
- 직원 Chat UI
- Application API preset
- Gateway live/fallback mode 전환
- 청중 참여형 또는 simulator 화면

Shadow/evidence path:

- fixture 기반 Dashboard polish
- 발표 동선과 fallback 화면
- 더 나은 데모 UX
- 관리자가 traffic을 제어하는 느낌을 주는 interaction 설계

### 재혁님 - Control Plane & Runtime Policy

Main path:

- RuntimeConfig 또는 RuntimeSnapshot publish thin slice
- Provider/model/routing/cache/safety/rate policy authoring
- credential lifecycle과 secret 노출 방지

Shadow/evidence path:

- static snapshot JSON export
- policy validation 비용과 cache 전략 검토
- config publish/reload failure mode 정리
- DB/query 최적화 후보 분석

### 이지섭 - Gateway Data Plane & Governance

Main path:

- RuntimeSnapshot 또는 live runtime config 소비
- 실제 Provider adapter 1종과 Mock fallback
- 모델 2개 이상 routing
- streaming thin slice
- budget routing
- terminal log/event 생산 경계

Shadow/evidence path:

- provider adapter conformance test
- streaming mock provider test
- traffic simulator Gateway smoke
- timeout, connection pool, backpressure, graceful shutdown, readiness 검토
- stage envelope 구조 실험

### 이윤지 - AI Safety & Evaluation

Main path:

- Gateway safety policy와 연결 가능한 SafetyDecision 계약
- synthetic PII redaction/block expected outcome
- rule-based detector 품질 유지

Shadow/evidence path:

- PII masking model 개선
- detector corpus 확장
- false positive / false negative report
- RemoteSafetyEngine shadow evaluation
- prompt injection, toxicity 등 v2 safety category 실험

### 이규정 - Observability, Data Platform & Performance

Main path:

- Request Log / Detail / Dashboard aggregate를 조직/팀/사용자/Application 맥락으로 확장
- k6 baseline을 성능 개선 기준으로 강화
- Dashboard query와 aggregation 정확성 검증

Shadow/evidence path:

- PostgreSQL partition / TimescaleDB 검토
- query profile과 index 전략
- outbox/worker skeleton 설계
- 각 역할의 병목 후보를 모으고 최적화 순서를 제안
- Redpanda/ClickHouse는 PostgreSQL 한계 측정 이후 후보로 관리

## 8. 성능 개선에 대한 표현 기준

성능 개선은 특정 고급 기술을 바로 도입하거나 직접 구현한다는 뜻이 아니다.
각 역할은 자기 영역에서 병목 가능성을 분석하고, 현재 단계에서 적용 가능한 개선과 후속 버전에서 검토할 운영/아키텍처 선택지를 구분해 제안한다.

예시:

- Gateway: timeout, connection pool, streaming goroutine lifecycle, backpressure, graceful shutdown, readiness
- Observability: k6 scenario, query profile, PostgreSQL partition/TimescaleDB, aggregate 전략
- Control Plane: runtime snapshot publish, config cache, policy validation 비용
- Web: live dashboard polling, fallback fixture, 참여형 demo traffic UX
- Safety: detector latency, false positive/negative, shadow evaluation cost

목표는 멋진 기술 이름을 나열하는 것이 아니라, 청중 참여 traffic에서도 서버가 예측 가능하게 버티는 근거를 만드는 것이다.

## 9. `have-to-decision.md` 작성 규칙 제안

팀 결정이 필요한 항목은 각 역할 폴더의 `have-to-decision.md`에 명시하는 것이 좋다.
역할별 구현 계획이나 notes 안에 암묵적으로 섞어 쓰면 안 된다.

추천 형식:

```md
# Have-To Decisions - <역할>

> 공식 계약이 아니라 팀 결정이 필요한 항목을 모으는 토론 메모입니다.
> Codex가 임의로 결정하면 위험한 항목만 적습니다.
> 합의된 내용은 나중에 공식 `docs/v2.0.0/*` 문서로 옮깁니다.

## 빠른 결정 요약

| No | 결정할 것 | 추천안 | 영향 범위 | 우선순위 | 상태 |
| -- | -- | -- | -- | -- | -- |
| 1 |  |  |  | P0 | 미결정 |

## 1. <결정 주제>

### 왜 결정해야 하나?

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |

### 추천안

### 결정 전까지 안전한 기본값

### 영향을 받는 역할
```

상태값은 단순하게 둔다.

```text
미결정
토론 중
추천안 있음
합의됨
보류
```

우선순위는 아래처럼 둔다.

```text
P0: v2 계약 전에 결정 필요
P1: v1.x 구현 전에 결정하면 좋음
P2: 후속 고도화 전에 결정
```

## 10. 참고 질문

아래 질문은 각 역할 Codex와 팀원이 v2.0.0 토론을 시작할 때 참고하기 위한 것이다.
모든 질문에 반드시 답해야 하는 것은 아니며, 역할별로 더 중요한 쟁점이 있다면 그 내용을 우선해도 된다.

다만 팀 결정이 필요한 항목은 암묵적으로 처리하지 말고 반드시 `have-to-decision.md`에 명시한다.

- v2.0.0 목표에 동의하는가? 반대하거나 보완할 부분은 무엇인가?
- 내 역할에서 v2.0.0 main path에 꼭 필요한 작업은 무엇인가?
- 다른 역할 구현이 늦어도 병렬로 진행할 shadow/evidence 작업은 무엇인가?
- 내가 소비해야 하는 계약은 무엇인가?
- 내가 생산해야 하는 계약은 무엇인가?
- v1.x에서 먼저 처리할 것과 v2.0.0까지 남길 것은 무엇인가?
- 지금 결정하면 나중에 되돌리기 어려운 항목은 무엇인가?
- 발표 또는 데모에서 내가 보여줄 evidence는 무엇인가?

## 11. 다음 단계 제안

1. 이 문서를 다른 역할 Codex에게 공유한다.
2. 각 역할은 자기 폴더에 의견 문서를 작성한다.
3. 팀 결정이 필요한 항목은 각 역할의 `have-to-decision.md`에 따로 적는다.
4. 각 역할 의견을 모아 충돌 후보를 정리한다.
5. 합의된 내용만 공식 `docs/v2.0.0/contracts.md`와 `implementation-plan.md`로 승격한다.
6. 공식 계약이 생기기 전에는 API, DB, Event, Metric, security-sensitive field를 임의로 추가하지 않는다.

## 12. 한 줄 결론

v2.0.0은 한 번에 모든 엔터프라이즈 기술을 붙이는 버전이 아니라, v1.x에서 검증한 실제 Provider, streaming, runtime config, performance evidence를 바탕으로 조직 기반 LLMOps Gateway MVP를 선언하는 목표 버전이어야 한다.
