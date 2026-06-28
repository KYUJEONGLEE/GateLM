# GateLM v2.0.0 방향 의견 - 이윤지

> AI Safety & Evaluation Lab 관점의 v2.0.0 토론 메모다.
> 공식 계약이 아니며, 합의된 내용만 이후 `docs/v2.0.0/contracts.md` 또는 `docs/v2.0.0/implementation-plan.md`로 승격해야 한다.
> 이 문서에서는 API, DB, Event, Metrics, security-sensitive field를 확정하지 않는다.

## 2026-06-29 1차 의견

### 요약

지섭님이 제안한 "조직 기반 LLMOps Gateway MVP" 방향에 동의한다.
Safety 관점에서 v2.0.0은 "AI detector를 붙였다"가 아니라, 조직의 LLM 요청이 Gateway를 통과할 때 어떤 보안 판단이 일어났는지 설명 가능하고 재현 가능하게 보여주는 버전이어야 한다.

v2.0.0까지 Safety Lab이 지켜야 할 핵심은 두 가지다.

1. Gateway hot path는 안정적으로 유지한다.
2. 더 강한 safety 기능은 corpus, report, shadow evaluation으로 증거를 만든 뒤 공식 계약으로 승격한다.

즉 Python/FastAPI AI service나 RemoteSafetyEngine은 v2의 중요한 실험 축이 될 수 있지만, 계약이 정해지기 전에는 Gateway의 필수 runtime dependency가 되면 안 된다.

## 지섭 제안에 대한 의견

### 동의하는 부분

v1.x를 v2.0.0으로 가는 release train으로 보는 방향에 동의한다.
Safety도 v1에서 끝난 기능이 아니라, v1.x 과정에서 corpus와 평가 기준을 키우고 v2에서 조직 단위 governance evidence로 연결해야 한다.

특히 아래 방향은 Safety 관점에서도 안전하다.

| 제안 | Safety 관점 |
| -- | -- |
| 실제 Provider 1종과 Mock fallback 유지 | 실제 Provider 연동 후에도 redaction/block이 Provider 호출 전에 보장되는지 검증할 수 있다. |
| RuntimeSnapshot thin slice | 어떤 safety policy가 적용됐는지 요청 결과와 연결할 수 있다. |
| Streaming thin slice | LLM 제품 체감은 좋아지지만, safety 처리 순서와 중단 상태를 먼저 정리해야 한다. |
| k6 baseline 강화 | detector latency와 false positive 처리 비용을 성능 논의에 포함할 수 있다. |
| Redpanda/ClickHouse를 v2 필수로 두지 않음 | Safety evidence는 우선 PostgreSQL log, corpus report, smoke 결과로 충분히 시작할 수 있다. |

### 보완이 필요한 부분

#### 1. v2 safety 목표는 "확장"보다 "판단 가능성"이 먼저다

v2에서 prompt injection, toxicity, 내부 기밀 키워드, policy-aware detector를 모두 논의할 수 있다.
다만 detector category를 늘리는 것 자체가 목표가 되면 위험하다.

각 category는 최소한 아래 근거를 가진 뒤 main path 후보로 올려야 한다.

| 근거 | 이유 |
| -- | -- |
| synthetic corpus | 실제 개인정보나 secret 없이 반복 검증해야 한다. |
| expected outcome | redact, block, allow, monitor 중 어떤 기대 결과인지 명확해야 한다. |
| false positive / false negative report | demo에서 "왜 막혔는지"와 "왜 통과했는지"를 설명해야 한다. |
| latency impact | Gateway hot path에 넣어도 되는지 판단해야 한다. |
| rollback/fallback rule | detector 장애가 Gateway 장애로 번지지 않아야 한다. |

#### 2. raw prompt/response opt-in은 v2.0.0 기본 목표에 넣지 않는 편이 안전하다

원문 저장 opt-in은 보안, 권한, retention, 암호화, audit, UI 노출 정책을 모두 건드린다.
조직 기반 LLMOps MVP를 선언하는 v2.0.0에서 원문 저장까지 같이 열면 데모 신뢰도보다 리스크가 커진다.

추천 방향은 아래와 같다.

```text
v2.0.0 기본값
= raw prompt/raw response 저장 금지 유지

v2.x 후보
= 별도 opt-in 계약, 접근 제어, 암호화, retention, audit log가 먼저 합의된 뒤 검토
```

데모와 평가에는 redacted preview, hash, aggregate, synthetic corpus를 사용하면 충분하다.

#### 3. 직원 Chat UI는 더 위험한 입력 경로다

직원 Chat UI는 Application API preset보다 자유 입력 가능성이 높다.
따라서 Safety는 Web Console과 함께 "직원에게 무엇을 보여줄지"와 "관리자에게 무엇을 보여줄지"를 분리해야 한다.

내 의견은 아래와 같다.

| 사용자 | 표시 방향 |
| -- | -- |
| Employee | block/redaction 여부의 짧은 안내만 표시한다. detected type 상세와 redacted preview는 기본 비노출이 안전하다. |
| Developer | 테스트와 디버깅을 위해 제한된 masking summary를 볼 수 있다. raw value는 여전히 금지한다. |
| Project/Tenant Admin | redacted preview, policy version, detector type summary를 볼 수 있다. sample hash와 raw value는 기본 비노출이 안전하다. |

규민님이 말한 Web Console read model은 필요하지만, safety detail은 권한별 노출 정책을 같이 가져가야 한다.

#### 4. Streaming은 Provider 호출 전 safety와 로그 상태를 먼저 정해야 한다

Streaming thin slice는 동의한다.
다만 Safety 입장에서는 "응답이 시작된 뒤 차단" 같은 사용자 경험이 생기면 설명이 어려워진다.

v1.x thin slice에서는 먼저 요청 prompt 기준 redaction/block을 Provider 호출 전에 끝내는 것을 기준으로 두고, response-side safety scan은 v2 evidence path로 두는 편이 안전하다.

## 이윤지 역할의 v2.0.0 main path

v2.0.0 main path에서 Safety Lab이 맡아야 하는 일은 Gateway를 대신 구현하는 것이 아니라, Gateway가 실행할 수 있는 safety 판단을 검증 가능한 계약과 evidence로 만드는 것이다.

| Main path | 설명 | 소비자 |
| -- | -- | -- |
| SafetyDecision 계약 보강 의견 | v1의 `none/redacted/blocked`, detector type, count, redacted preview, policy provenance를 v2에서도 설명 가능하게 유지한다. | Gateway, Observability, Web |
| RuntimeSnapshot safety policy 검증 | Control Plane이 publish한 safety policy가 corpus expectation과 맞는지 검증한다. | Control Plane, Gateway |
| synthetic safety corpus 확장 | email/phone/credential/RRN/private key 외에 v2 후보 category를 synthetic data로 확장한다. | Gateway, QA, Demo |
| detector quality report | false positive, false negative, latency, policy action 결과를 사람이 읽을 수 있게 정리한다. | 전체 팀 |
| RemoteSafetyEngine shadow evaluation | Python/FastAPI service를 shadow/evaluation mode로 운영하며 hot path 의존성을 만들지 않는다. | Gateway, Safety Lab |
| demo safety evidence pack | 발표에서 redaction, block, no-provider-call, no-raw-storage를 requestId 기준으로 보여준다. | Web, Observability, 발표자 |

## 병렬로 할 수 있는 shadow/evidence 작업

다른 역할 구현이 늦어도 Safety Lab은 아래 작업을 병렬로 진행할 수 있다.

| 작업 | 다른 역할 의존성 | 산출물 |
| -- | -- | -- |
| corpus case 확장 | 낮음 | synthetic JSONL 또는 Markdown case table |
| expected outcome matrix | 낮음 | detector/action별 기대 결과표 |
| false positive 후보 수집 | 낮음 | report 초안 |
| detector latency smoke | 중간 | 간단한 측정 결과 |
| RemoteSafetyEngine shadow contract sketch | 중간 | request/response 개념 문서, 단 공식 API 확정 아님 |
| prompt injection/toxicity 실험 | 낮음 | v2 후보 category report |
| audience input guardrail checklist | 낮음 | 데모 리허설 체크리스트 |

## 내가 소비해야 하는 계약

| 계약 | 생산자 | 필요한 이유 |
| -- | -- | -- |
| RuntimeSnapshot 또는 ActiveRuntimeConfig의 safety policy 개념 | 재혁님 | 어떤 detector/action 정책을 평가할지 알아야 한다. |
| Gateway safety stage 결과 | 지섭님 | Gateway가 실제로 어떤 SafetyDecision을 만들었는지 검증해야 한다. |
| Gateway pipeline 순서 | 지섭님 | safety가 cache/provider 전에 실행되는지 확인해야 한다. |
| Request Log / Detail safety read model | 규정님 | redaction/block evidence가 raw value 없이 조회되는지 확인해야 한다. |
| Dashboard aggregate 기준 | 규정님 | blocked/redacted가 장애가 아니라 정책 결과로 집계되는지 확인해야 한다. |
| Web 권한별 표시 정책 | 규민님 | Employee/Admin에게 어떤 safety detail을 보여줄지 맞춰야 한다. |
| Streaming lifecycle 후보 | 지섭님, 규민님, 규정님 | streaming 중단/완료 상태에서 safety evidence가 깨지지 않아야 한다. |

## 내가 생산해야 하는 계약

이 문서에서 공식 field를 확정하지는 않는다.
다만 v2 공식 계약으로 승격할 후보 산출물은 아래와 같다.

| 산출물 | 설명 | 소비자 |
| -- | -- | -- |
| v2 safety corpus guideline | 실제 secret/개인정보 없이 synthetic case를 만드는 기준 | 전체 팀 |
| detector expected outcome matrix | detector type 후보별 기본 action과 expectation | Gateway, Control Plane |
| safety evaluation report format | false positive, false negative, latency, coverage를 읽는 기준 | 전체 팀 |
| RemoteSafetyEngine shadow mode guideline | remote evaluator가 hot path를 깨지 않고 shadow로 돌기 위한 기준 | Gateway |
| demo safety evidence checklist | 발표에서 보여줄 안전 증거 목록 | Web, Observability, 발표자 |

## v1.x에서 먼저 처리할 것

| 시점 후보 | 처리할 것 | 이유 |
| -- | -- | -- |
| v1.1 | v1 safety corpus smoke와 report 정리 | 현재 rule-based detector 품질을 기준선으로 고정한다. |
| v1.1 | raw prompt/response/secret 미저장 검증 체크리스트 | v2 확장 전에 안전한 기본값을 흔들리지 않게 한다. |
| v1.2 | 실제 Provider adapter 연동 후 redaction/block parity 확인 | Mock에서만 안전한 구현이 아닌지 확인한다. |
| v1.2 | RuntimeSnapshot safety policy thin slice 검증 | 정책 변경이 request 결과와 연결되는 증거를 만든다. |
| v1.3 | streaming request-side safety behavior 검증 | Provider 호출 전 safety 보장이 streaming에서도 유지되는지 본다. |
| v1.3 | audience/demo input guardrail rehearsal | 자유 입력 리스크를 발표 전에 줄인다. |

## v2.0.0까지 남길 것

| 항목 | v2.0.0 목표 |
| -- | -- |
| v2 safety category 선정 | corpus와 report가 있는 category만 main path 후보로 둔다. |
| RemoteSafetyEngine 역할 | shadow/evaluation인지, 일부 enforce 후보인지 팀 결정 후 반영한다. |
| 권한별 safety detail 노출 | Employee, Developer, Admin별 노출 경계를 정한다. |
| 조직/팀 단위 safety dashboard | raw value 없이 aggregate로 설명 가능한 화면을 만든다. |
| demo evidence pack | requestId로 redaction/block/cache/provider bypass/log/dashboard를 이어 보여준다. |

## 데모나 발표에서 보여줄 evidence

Safety Lab이 발표에서 보여주고 싶은 장면은 아래와 같다.

1. 안전한 요청은 `maskingAction=none`으로 Provider까지 간다.
2. email/phone 포함 요청은 Provider 호출 전에 redacted prompt로 바뀐다.
3. credential/RRN/private key 후보는 Provider 호출 전에 blocked 된다.
4. blocked 요청은 비용 0, Provider call 없음, policy outcome으로 집계된다.
5. Request Detail은 redacted preview만 보여주고 raw value를 보여주지 않는다.
6. Dashboard는 redacted/blocked count를 장애가 아니라 보안 이벤트로 보여준다.
7. corpus report는 detector별 false positive/false negative 후보와 latency를 보여준다.
8. RemoteSafetyEngine은 shadow 결과를 남기되 v2 계약 전에는 main path를 깨지 않는다.

## 다른 역할 의견에 대한 초기 반응

### 김규민 의견에 대한 반응

규민님이 Web Console을 `Dashboard / Management / Analytics / Demo / Settings`로 분리하자는 방향에 동의한다.
Safety 관점에서는 특히 Demo와 Admin Dashboard를 분리해야 한다.
Demo 입력은 synthetic/preset 중심이어야 하고, Admin Dashboard는 redacted preview와 aggregate만 표시해야 한다.

추가로, Web Console read model을 정할 때 권한별 safety detail 노출 기준이 같이 필요하다.
Employee에게 detector detail을 많이 보여주면 우회 힌트가 될 수 있고, Admin에게 아무 근거도 보여주지 않으면 운영 설명력이 떨어진다.

### 이규정 의견에 대한 반응

규정님이 v2 Observability를 "더 많은 차트"가 아니라 운영 evidence로 본 점에 동의한다.
Safety도 redaction/block count를 보여주는 데서 끝나면 안 되고, 어떤 policy provenance와 corpus expectation이 그 판단을 뒷받침하는지 연결해야 한다.

Semantic Cache를 v2 core가 아니라 evidence track으로 두자는 의견에도 동의한다.
Semantic Cache는 raw prompt 저장 금지, redacted prompt 기준 embedding, false hit safety risk, policy gate를 함께 봐야 하므로 Safety Lab이 shadow/evidence 기준을 같이 내야 한다.

### 2026-06-29 pull 반영: enforced와 shadow 구분

규민님과 규정님이 모두 RemoteSafetyEngine 결과를 UI와 Observability에서 shadow/evidence로 구분해야 한다고 적은 점에 동의한다.
Safety Lab도 이 구분을 강하게 지지한다.

v2 문서가 만들어질 때는 최소한 아래 개념을 섞지 않아야 한다.

| 개념 | 의미 |
| -- | -- |
| Gateway enforced safety decision | client response와 terminal outcome에 실제 영향을 준 판단 |
| RemoteSafetyEngine shadow result | 품질 평가와 evidence를 위한 병렬 판단 |
| Safety corpus report | detector expectation과 false positive/negative 해석 근거 |
| Dashboard safety aggregate | 운영자가 보는 redacted/blocked 요약 |

위 이름은 공식 field 제안이 아니라 논의용 구분이다.
핵심은 "실제로 요청을 막은 판단"과 "나중에 고도화하기 위한 실험 결과"를 같은 badge나 같은 metric처럼 보여주지 않는 것이다.

## 명시적으로 하지 않을 것

아래 항목은 팀 결정과 공식 계약 없이 진행하면 안 된다.

- raw prompt 저장
- raw response 저장
- 실제 secret 또는 개인정보를 corpus, fixture, snapshot에 사용
- Python/FastAPI AI service를 Gateway v2 hot path 필수 의존성으로 고정
- detector type이나 action을 공식 계약 없이 API/DB/Event field로 확정
- cache key나 embedding에 raw prompt 사용
- audience free input을 안전장치 없이 발표에 사용

## 현재 결론

지섭님 제안의 큰 방향에는 동의한다.
Safety 관점의 보완점은 v2.0.0을 "더 많은 detector"가 아니라 "조직이 신뢰할 수 있는 안전 판단의 증거"로 정의해야 한다는 것이다.

v1.x에서는 rule-based detector의 품질과 no-raw-storage 원칙을 더 단단히 만들고, v2.0.0에서는 RuntimeSnapshot, Dashboard, Request Detail, Demo evidence가 같은 safety 판단을 설명하도록 맞추는 것이 좋다.

팀 결정이 필요한 항목은 같은 폴더의 `have-to-decision.md`에 따로 정리한다.
