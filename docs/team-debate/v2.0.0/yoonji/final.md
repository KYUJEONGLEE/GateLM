# Final Opinion - 이윤지 / AI Safety & Evaluation

> 이 문서는 이윤지 역할 관점의 v2.0.0 team-debate 최종 의견입니다.
> 공식 계약 문서가 아니며, API, DB, Event, Metrics, security-sensitive field를 확정하지 않습니다.
> raw prompt, raw response, API Key, App Token, Provider Key, Authorization header, 실제 secret 또는 실제 개인정보 예시는 포함하지 않습니다.

## 1. 최종 입장

지섭님이 제안한 "조직 기반 LLMOps Gateway MVP" 방향에 동의합니다.
v2.0.0은 모든 고급 기술을 한 번에 붙이는 버전이 아니라, v1.x에서 검증한 실제 Provider, RuntimeSnapshot, streaming thin slice, safety evidence, performance evidence를 바탕으로 운영자가 조직의 LLM traffic을 설명하고 통제할 수 있는 목표 지점이어야 합니다.

AI Safety & Evaluation 관점에서 v2.0.0의 핵심은 detector 목록을 늘리는 것이 아닙니다.
핵심은 Gateway가 안전 판단을 일관되게 적용하고, 팀이 그 판단을 raw data 없이 재현 가능하게 설명할 수 있는 evidence를 갖는 것입니다.

## 2. 수렴된 방향

| 주제 | 최종 의견 |
| -- | -- |
| Safety 목표 | detector 확장보다 판단 가능성, corpus, FP/FN report, latency evidence |
| Raw content | v2.0.0 기본값은 raw prompt/raw response 저장 및 표시 금지 |
| RemoteSafetyEngine | Gateway enforced decision이 아니라 shadow/evaluation path부터 시작 |
| 직원 Chat UI | Application boundary 안에서 Gateway만 호출하고, Employee/Admin 노출 경계 분리 |
| Runtime policy | static snapshot + thin live publish부터 검증 |
| Provider | 실제 Provider 1종 + 모델 2개 이상 + Mock fallback 유지 |
| Streaming | request-side pre-provider safety를 먼저 보장하고 response-side scan은 evidence path |
| Semantic Cache | v2 core가 아니라 redacted 기준 evidence track |
| Observability | safety aggregate는 corpus report와 request detail evidence로 해석 가능해야 함 |
| Demo | preset/synthetic input 중심, 제한 자유 입력은 리허설과 guardrail 이후 판단 |

## 3. 이윤지 역할의 v2.0.0 Main Path

| Main path | 설명 |
| -- | -- |
| SafetyDecision 책임 범위 정리 | Gateway가 실제로 적용한 safety 판단과 shadow/evidence 결과를 구분합니다. |
| Synthetic safety corpus | 실제 개인정보나 secret 없이 redaction/block/pass expectation을 반복 검증합니다. |
| Detector quality report | false positive, false negative, latency, category coverage를 사람이 읽을 수 있게 정리합니다. |
| RuntimeSnapshot safety policy 검증 | publish된 safety policy 후보가 corpus expectation과 맞는지 확인합니다. |
| Gateway pre-provider safety evidence | redaction/block이 cache/provider 전에 실행됐다는 증거를 requestId 흐름으로 보여줍니다. |
| Demo safety evidence pack | raw value 없이 redaction, block, provider bypass, dashboard aggregate를 설명합니다. |

## 4. v1.x 우선 처리

1. v1 safety corpus smoke와 expected outcome matrix를 정리합니다.
2. raw prompt/raw response/secret 미저장 체크리스트를 유지합니다.
3. 실제 Provider adapter 연동 후에도 redaction/block parity가 유지되는지 검증합니다.
4. RuntimeSnapshot 또는 static safety policy fixture와 corpus expectation을 연결합니다.
5. Streaming thin slice에서는 request-side pre-provider safety를 먼저 검증합니다.
6. RemoteSafetyEngine은 shadow/evaluation report부터 만들고 enforced decision으로 보이지 않게 합니다.

## 5. v2.0.0까지 남길 것

- v2 safety category 선정 기준
- prompt injection/toxicity/internal keyword의 main path 포함 여부
- RemoteSafetyEngine enforce 승격 조건
- Employee, Developer, Admin별 safety detail 노출 경계
- Semantic Cache safety gate와 false hit review 기준
- Safety corpus report와 Dashboard aggregate의 연결 방식
- 청중 참여형 데모 입력의 허용 범위와 emergency stop 기준

## 6. 팀 결정 요청

아래 항목은 공식 v2 계약 전에 팀 회의에서 결정해야 합니다.

- raw prompt/response 저장 opt-in 여부
- RemoteSafetyEngine의 권한과 장애 시 기본 동작
- v2.0.0 safety category 범위
- 직원 Chat UI의 Application boundary와 권한별 safety 표시 수준
- Streaming safety 범위
- Semantic Cache를 evidence track으로 둘지 여부
- RuntimeSnapshot safety policy provenance의 최소 표현
- Demo 입력을 preset 중심으로 제한할지 여부

## 7. 발표 Evidence

| Evidence | 보여주는 메시지 |
| -- | -- |
| Synthetic corpus report | 실제 개인정보 없이 detector 기대 결과를 검증했다 |
| Redaction scenario | email/phone 후보가 Provider 호출 전 redacted 된다 |
| Block scenario | credential/RRN/private key 후보는 Provider 호출 전 차단된다 |
| Request Detail | raw value 없이 safety decision과 policy provenance를 설명한다 |
| Dashboard aggregate | block/redaction count를 장애가 아니라 policy outcome으로 보여준다 |
| Remote shadow report | 실험 결과와 enforced decision을 구분한다 |
| Streaming safety smoke | streaming 요청도 Provider 호출 전 safety를 통과한다 |
| Semantic Cache evidence | raw prompt 없이 redacted 기준 후보만 실험한다 |

## 8. 명시적으로 하지 않을 것

- raw prompt 저장을 v2.0.0 기본 기능으로 넣지 않습니다.
- raw response 저장을 v2.0.0 기본 기능으로 넣지 않습니다.
- 실제 secret이나 실제 개인정보를 corpus, fixture, snapshot, demo에 넣지 않습니다.
- RemoteSafetyEngine shadow result를 Gateway enforced decision처럼 표시하지 않습니다.
- Semantic Cache candidate를 Exact Cache hit rate에 섞지 않습니다.
- team-debate 문서에서 API/DB/Event/Metrics/security-sensitive field 이름을 확정하지 않습니다.

## 9. 한 줄 결론

Safety 관점에서 GateLM v2.0.0의 성공 기준은 화려한 detector 목록이 아니라, 원문을 저장하지 않고도 안전 판단을 재현 가능하게 검증하고 운영자가 설명할 수 있는 evidence를 남기는 것입니다.
