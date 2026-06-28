# Final Opinion - 김규민

> Product Experience & Demo 관점의 v2.0.0 최종 의견 초안입니다.
> 공식 계약 문서가 아니며, 팀 합의 전 API, DB, Event, Metrics, security-sensitive field를 확정하지 않습니다.
> raw prompt, raw response, secret 원문 예시는 넣지 않습니다.

## 1. 최종 입장

지섭님 제안의 큰 방향에 동의합니다. GateLM v2.0.0은 조직 기반 LLMOps Gateway MVP로 잡는 것이 좋습니다.

다만 Product Experience 관점에서 v2.0.0의 성공 기준은 기술을 많이 붙이는 것이 아니라, 관리자가 아래 질문에 답할 수 있는 장면을 만드는 것입니다.

| 질문 | 화면에서 보여야 하는 것 |
| -- | -- |
| 우리 조직의 LLM traffic이 정상인가? | traffic, error, latency, cost 흐름 |
| 비용과 위험은 어디서 생기는가? | scope별 사용량과 safety outcome |
| Gateway가 실제로 통제하고 있는가? | routing, cache, policy result |
| 정책 변경이 요청에 반영되는가? | Runtime policy 상태와 요청 결과 연결 |
| 발표 중 문제가 생겨도 설명 가능한가? | live/fallback evidence |

## 2. v1.x 우선 처리

v1.x에서는 v2.0.0의 발표 evidence를 먼저 쌓아야 합니다.

1. Dashboard와 Request Log를 fixture로 안정화합니다.
2. 실제 Provider 1종과 Mock fallback을 UI에서 구분 가능하게 만듭니다.
3. RuntimeSnapshot 또는 runtime policy thin slice를 요청 결과와 연결합니다.
4. traffic simulator 또는 scenario runner로 Dashboard가 움직이게 만듭니다.
5. streaming은 우선 최종 상태 표시부터 시작하고, lifecycle 확장은 v2 계약으로 남깁니다.

## 3. v2.0.0까지 남길 것

- 조직 기반 Admin Dashboard
- scope drilldown UX
- request detail v2
- Runtime policy 변경과 요청 결과 연결
- Gateway-only employee chat
- Application API preset demo
- traffic simulator와 fallback mode
- 원문 노출 없는 데모 evidence

## 4. 소비 계약과 생산 계약

### 소비해야 하는 계약 후보

| 계약 종류 | 이유 |
| -- | -- |
| Dashboard aggregate | 조직 상태 요약 |
| Request summary/detail | 요청 추적 |
| Runtime policy status | 정책 변경 설명 |
| Gateway outcome summary | routing/cache/safety 결과 설명 |
| Demo scenario result | 발표 흐름 제어 |
| Fixture parity rule | live/fallback 일관성 |

정확한 이름과 저장 방식은 여기서 확정하지 않습니다.

### 생산해야 하는 계약 후보

| 산출물 | 목적 |
| -- | -- |
| Web Console IA | v2 제품 구조 제안 |
| demo scenario flow | 발표 동선 고정 |
| 화면별 read model 요구사항 | 다른 역할의 계약 논의 입력 |
| fixture parity checklist | 병렬 개발과 fallback 안정성 |
| evidence checklist | 발표 전 검증 기준 |

## 5. 데모 Evidence

| Evidence | 설명 |
| -- | -- |
| Dashboard live update | simulator 또는 preset traffic 이후 화면이 갱신됩니다. |
| Request detail drilldown | 원문 없이 Gateway 판단 결과를 추적합니다. |
| Runtime policy reflection | 정책 변경 후 다음 요청의 결과 변화를 설명합니다. |
| Gateway value display | cache, routing, safety, cost 관점의 효과를 보여줍니다. |
| Fallback resilience | live 실패 상황에서도 같은 메시지를 유지합니다. |

## 6. 팀 결정 요청

- v2 Web Console 정보 구조
- Demo 화면과 운영 Dashboard의 경계
- RuntimeSnapshot 또는 runtime policy 상태를 UI에서 설명하는 방식
- Request Detail에서 원문 없이 보여줄 수 있는 정보 범위
- traffic simulator와 청중 입력 허용 범위
- live/fallback fixture parity 기준
- v1.x에서 끝낼 것과 v2.0.0까지 남길 것의 경계

## 7. 한 줄 결론

Product Experience 관점에서 GateLM v2.0.0은 Gateway가 회사 전체 LLM 사용을 통제한다는 장면을 Dashboard, Request Detail, Runtime Policy, Demo Evidence로 증명하는 버전이어야 합니다.
