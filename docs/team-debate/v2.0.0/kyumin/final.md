# Final Opinion - 김규민

> Product Experience & Demo / Web Console 관점의 v2.0.0 최종 의견입니다.
> 공식 계약 문서가 아니며, 팀 합의 전 API, DB, Event, Metrics, security-sensitive field를 확정하지 않습니다.
> raw prompt, raw response, API Key, App Token, Provider Key, Authorization header, 실제 secret은 저장하거나 표시하지 않는 것을 전제로 합니다.

## 1. 최종 입장

지섭님이 제안한 "조직 기반 LLMOps Gateway MVP" 방향에 동의합니다.
v2.0.0은 많은 기술을 한 번에 붙이는 버전이 아니라, v1.x에서 검증한 실제 Provider, RuntimeSnapshot, streaming thin slice, safety evidence, performance evidence를 제품 경험으로 묶어 설명할 수 있는 목표 지점이어야 합니다.

프론트 관점에서 v2.0.0의 성공 기준은 아래 장면을 Web Console에서 설득력 있게 보여주는 것입니다.

```text
여러 직원/팀/Application 요청이 Gateway를 통과한다
-> 정책, safety, cache, routing, provider/fallback 결과가 남는다
-> 관리자는 Dashboard와 Request Detail에서 원문 없이도 결과를 설명한다
-> 정책 변경 또는 실패 상태가 다음 요청과 연결되어 보인다
```

## 2. 수렴된 방향

| 주제 | 최종 의견 |
| -- | -- |
| 제품 목표 | 조직 기반 LLMOps Gateway MVP |
| Web Console IA | Dashboard / Management / Analytics / Demo / Settings 분리 |
| Demo와 운영 화면 | Demo traffic generator와 Admin Dashboard를 분리 |
| Scope | `teamId` core 승격은 보류하고 budget scope/read model로 표현 |
| Runtime policy | static snapshot + thin live publish부터 검증 |
| Provider | 실제 Provider 1종 + 모델 2개 이상 + Mock fallback |
| Safety | detector 확장보다 판단 가능성, corpus, shadow/evidence 중심 |
| Observability | 차트 수가 아니라 운영 evidence와 query profile 중심 |
| Streaming | v1.x thin slice, v2에서 lifecycle 확장 |
| Semantic Cache | v2 core가 아니라 evidence track |
| raw content | v2.0.0 기본값은 저장/표시 금지 유지 |

## 3. v1.x 우선 처리

1. Web Console IA를 `Dashboard / Management / Analytics / Demo / Settings` 기준으로 안정화합니다.
2. Dashboard와 Request Log/Detail read model을 fixture/live parity 기준으로 정리합니다.
3. RuntimeSnapshot 또는 runtime policy thin slice를 Request Detail과 연결합니다.
4. invalid publish, reload failure, last known safe 상태를 UI에서 설명할 수 있게 합니다.
5. 실제 Provider path와 Mock fallback path를 Request Detail/Dashboard에서 구분합니다.
6. traffic simulator 또는 scenario runner로 Dashboard가 움직이는 근거를 만듭니다.
7. safety detail은 Employee/Admin 권한별 노출 경계를 먼저 정합니다.
8. Dashboard freshness expectation과 query budget을 Observability와 같이 정합니다.

## 4. v2.0.0까지 남길 것

- 조직/팀/Application 또는 budget scope drilldown UX
- Runtime policy publish lifecycle의 운영 화면
- Request Detail v2: runtime, safety, cache, routing, budget, provider, streaming outcome 설명
- Provider/fallback outcome과 latency/cost/token evidence 표시
- Streaming final state와 최소 lifecycle evidence 표시
- Semantic Cache candidate/evidence panel
- Demo live/fallback mode 전환과 fixture parity
- 원문 노출 없는 발표 evidence pack

## 5. 소비해야 하는 계약 후보

| 계약 후보 | 필요한 이유 |
| -- | -- |
| Dashboard aggregate/read model | 조직 상태와 scope별 비용/위험 요약 |
| Request summary/detail | requestId 기준 추적과 drilldown |
| Runtime policy provenance | 정책 변경과 요청 결과 연결 |
| Gateway redacted evidence summary | Web이 직접 정책 판단을 계산하지 않기 위함 |
| Provider/fallback outcome | 실제 Provider와 Mock fallback 구분 |
| Safety exposure policy | Employee/Admin별 표시 경계 |
| Streaming terminal/lifecycle status | Chat UX와 Request Log 상태 일관성 |
| Fixture parity rule | live 실패 시 같은 메시지로 demo 유지 |

정확한 필드명, 저장 구조, metric label은 이 문서에서 확정하지 않습니다.

## 6. 생산해야 하는 산출물

| 산출물 | 목적 |
| -- | -- |
| Web Console IA proposal | v2 제품 구조와 navigation 기준 |
| 화면별 read model 요구사항 | Control Plane, Gateway, Observability와 계약 조율 |
| Demo scenario flow | 발표 동선과 traffic simulator 기준 |
| Live/fallback UX | 발표 안정성과 회귀 확인 |
| Fixture parity checklist | 병렬 개발과 fallback 신뢰도 |
| Evidence checklist | 발표 전 검증 기준 |

## 7. 팀 결정 요청

아래 항목은 공식 v2 계약 전에 팀 회의에서 결정해야 합니다.

- v2 Web Console 정보 구조
- `tenantId`, `teamId`, `budgetScopeId` 관계와 UI 표현
- 직원 Chat UI의 Application boundary
- RuntimeSnapshot/Runtime policy UI 최소 정보
- raw prompt/response 저장 opt-in 여부
- Streaming 범위와 UI 상태
- 청중 참여형 데모 입력 방식
- Dashboard polling/realtime 범위와 query budget
- Dashboard aggregate grain
- Request outcome taxonomy
- 권한별 safety detail 노출
- Semantic Cache UI 표현 범위
- policy publish/reload 실패 UX
- Provider/Mock fallback UI 구분

## 8. 발표 Evidence

| Evidence | 보여주는 메시지 |
| -- | -- |
| Organization Dashboard | 회사 전체 LLM traffic이 GateLM으로 모인다 |
| Scope drilldown | 어떤 Application 또는 budget scope가 비용과 위험을 만드는지 보인다 |
| Runtime policy-linked Detail | 정책 변경과 요청 결과가 연결된다 |
| Safety aggregate + detail | raw value 없이 redaction/block을 설명한다 |
| Exact Cache saving | Provider call을 줄인 비용/latency 절감 근거가 있다 |
| Provider fallback outcome | 실제 Provider 장애와 Mock fallback이 구분된다 |
| Traffic simulator | Demo 입력이 Dashboard/Log/Detail로 이어진다 |
| k6/query profile | 성능 주장을 측정값으로 뒷받침한다 |

## 9. 명시적으로 하지 않을 것

- Web Console에서 Provider를 직접 호출하지 않습니다.
- raw prompt/raw response/API Key/App Token/Provider Key/Authorization header 원문을 표시하지 않습니다.
- Web이 canonical cost, policy outcome, cache saving을 직접 계산하지 않습니다.
- RemoteSafetyEngine shadow result를 Gateway enforced decision처럼 표시하지 않습니다.
- Semantic Cache candidate를 Exact Cache hit rate에 섞지 않습니다.
- team-debate 문서에서 API/DB/Event/Metrics/security-sensitive field 이름을 확정하지 않습니다.

## 10. 한 줄 결론

Product Experience 관점에서 GateLM v2.0.0은 Gateway가 회사 전체 LLM 사용을 통제한다는 장면을 Dashboard, Request Detail, Runtime Policy, Demo Evidence로 원문 노출 없이 증명하는 버전이어야 합니다.
