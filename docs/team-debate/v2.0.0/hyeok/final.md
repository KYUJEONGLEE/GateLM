# GateLM v2.0.0 Final Opinion - 재혁님

> Control Plane & Runtime Policy 관점의 v2.0.0 최종 토론 정리입니다.
> 이 문서는 `docs/team-debate` working draft이며, 공식 API, DB, Event, Metrics, security-sensitive field를 확정하지 않습니다.
> 합의된 내용만 이후 `docs/v2.0.0/contracts.md` 또는 `docs/v2.0.0/implementation-plan.md`로 승격해야 합니다.

## 1. 최종 입장

지섭님이 제안한 "조직 기반 LLMOps Gateway MVP" 방향에 동의합니다.
v2.0.0은 많은 기술을 한 번에 붙이는 버전이 아니라, v1.x에서 검증한 실제 Provider, RuntimeSnapshot, streaming thin slice, safety evidence, performance evidence를 운영자가 이해할 수 있는 하나의 제품 흐름으로 묶는 목표 지점이어야 합니다.

Control Plane 관점에서 v2.0.0의 핵심은 "관리자가 정책을 만든다"가 아니라 아래 문장을 증명하는 것입니다.

```text
정책은 검증되고,
안전하게 publish되며,
Gateway runtime이 같은 정책 상태를 소비하고,
Web/Observability는 원문과 secret 없이 그 결과를 설명한다.
```

## 2. 수렴된 방향

| 주제 | 최종 의견 |
| -- | -- |
| 제품 목표 | 조직 기반 LLMOps Gateway MVP |
| Runtime policy | static snapshot + thin live publish부터 검증 |
| Provider | 실제 Provider 1종 + 모델 2개 이상 + Mock fallback |
| Web Console | Dashboard / Management / Analytics / Demo / Settings 분리 |
| Observability | 차트보다 운영 evidence, request detail, query profile 중심 |
| Safety | detector 확장보다 판단 가능성, corpus, shadow/evidence 중심 |
| Streaming | v1.x thin slice, v2에서 lifecycle 확장 |
| Semantic Cache | v2 core가 아니라 evidence track |
| raw content | v2.0.0 기본값은 저장/표시 금지 유지 |

## 3. v1.x에서 먼저 처리할 것

1. static RuntimeSnapshot 또는 runtime policy export를 Gateway가 소비하는 thin slice를 만듭니다.
2. policy validation smoke를 만들고 invalid publish가 runtime에 반영되지 않게 합니다.
3. last known safe 상태를 유지하는 기본 동작을 정의합니다.
4. 실제 Provider path와 Mock fallback path를 구분 가능한 evidence로 남깁니다.
5. Request Detail에서 runtime provenance를 원문 없이 설명할 수 있게 합니다.
6. sanitized demo fixture로 policy 변경 전후를 비교할 수 있게 합니다.
7. Web/Observability가 소비할 최소 runtime 상태 후보를 문서화합니다.

## 4. v2.0.0까지 남길 것

- RuntimeSnapshot 또는 RuntimeConfig의 공식 lifecycle
- 조직/팀/Application/budget scope 관계의 최종 합의
- live publish/reload의 실패 상태와 복구 기준
- streaming/cache/safety/rate policy의 포함 범위
- audit/log/metric/event의 최종 계약
- raw prompt/response 저장 opt-in 여부와 보안 조건
- Provider/Mock fallback 상태의 dashboard/detail 표현 기준
- 화면별 freshness expectation과 query budget 기준

## 5. 내 역할의 main path

| Main path | 설명 |
| -- | -- |
| Policy authoring | 관리자가 운영 정책 후보를 만들고 수정하는 흐름 |
| Validation | 잘못된 정책이 publish되지 않도록 사전 검증 |
| Publish thin slice | Gateway가 소비 가능한 artifact 또는 snapshot 생산 |
| Runtime provenance | 요청 결과가 어떤 정책 상태를 참조했는지 설명할 후보 제공 |
| Failure handling | invalid publish, reload failure, stale runtime, last known safe 기본 동작 정리 |
| Secret hygiene | raw prompt/response, provider key, authorization header, 실제 secret이 evidence에 들어가지 않도록 경계 설정 |

## 6. 소비해야 하는 계약 후보

| 계약 후보 | 필요한 이유 |
| -- | -- |
| Gateway runtime consumption rule | Control Plane artifact가 실제 요청에 적용되는 방식 확인 |
| Gateway redacted evidence summary | Web/Observability가 원문 없이 결과를 설명하기 위함 |
| Provider/fallback outcome | 실제 Provider와 Mock fallback 경로 구분 |
| Safety decision summary | 정책과 safety 판단 연결 |
| Dashboard/Request Detail read model | Runtime provenance가 어디까지 필요한지 결정 |
| Fixture parity rule | live path 실패 시 demo message를 유지하기 위함 |

정확한 필드명, 저장 방식, event name, metric label은 이 문서에서 확정하지 않습니다.

## 7. 생산해야 하는 산출물

| 산출물 | 목적 |
| -- | -- |
| Runtime policy artifact 후보 | Gateway 소비 경로 검증 |
| Validation report 후보 | invalid publish 차단 evidence |
| Publish/reload state 후보 | Web Console이 운영 상태를 설명 |
| Last known safe evidence | 실패 시 안전 상태 유지 증명 |
| Sanitized fixture | 발표와 병렬 개발 안정성 |
| Control Plane decision list | 팀 회의에서 확정할 항목 분리 |

## 8. 팀 결정 요청

- RuntimeConfig와 RuntimeSnapshot의 경계
- `tenantId`, `teamId`, `budgetScopeId` 관계
- 직원 Chat UI의 Application boundary
- raw prompt/response 저장 opt-in 여부
- 실제 Provider와 모델 범위
- Streaming 범위와 lifecycle 표현
- publish/reload 실패 시 기본 동작
- Provider/Mock fallback UI와 aggregate 구분
- Dashboard freshness expectation과 query budget
- API/DB/Event/Metrics/Security-sensitive field의 공식 승격 시점

## 9. 발표 Evidence

| Evidence | 보여주는 메시지 |
| -- | -- |
| Policy validation failure | 잘못된 정책은 Gateway runtime에 반영되지 않는다 |
| RuntimeSnapshot-linked Request Detail | 정책 변경과 요청 결과가 연결된다 |
| Last known safe 유지 | publish/reload 실패에도 안전한 이전 상태를 쓴다 |
| Actual Provider + Mock fallback | 실제 호출과 fallback 안정성이 구분된다 |
| Redacted evidence | 원문과 secret 없이도 운영자가 설명할 수 있다 |
| Dashboard aggregate | 조직/Application/budget scope 단위로 결과가 모인다 |

## 10. 명시적으로 하지 않을 것

- raw prompt/raw response/API Key/App Token/Provider Key/Authorization header/실제 secret을 문서나 fixture에 넣지 않습니다.
- team-debate 문서에서 공식 API/DB/Event/Metrics field를 확정하지 않습니다.
- invalid policy를 Gateway runtime에 반영하지 않습니다.
- RemoteSafetyEngine shadow result를 Gateway enforced decision처럼 취급하지 않습니다.
- Semantic Cache candidate를 Exact Cache hit와 같은 안정된 main path로 표시하지 않습니다.
- 데이터 플랫폼 고도화를 병목 측정 전 v2.0.0 필수로 확정하지 않습니다.

## 11. 한 줄 결론

Control Plane 관점에서 GateLM v2.0.0은 "정책을 수정할 수 있다"가 아니라 "검증된 정책이 안전하게 publish되고, Gateway 결과와 운영 evidence로 원문 없이 설명된다"를 증명하는 버전이어야 합니다.
