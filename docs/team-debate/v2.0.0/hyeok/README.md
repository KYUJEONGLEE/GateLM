# GateLM v2.0.0 방향 의견 - 재혁님

> 재혁님 / Control Plane & Runtime Policy 관점의 working draft입니다.
> `docs/team-debate`는 공식 계약 문서가 아니며, 합의된 내용만 이후 공식 v2 문서로 승격합니다.
> 이 문서에서는 API, DB, Event, Metrics, security-sensitive field를 확정하지 않습니다.

## 1. 지섭 제안에 대한 입장

큰 방향에는 동의합니다. v2.0.0은 갑자기 모든 기술을 붙이는 버전이 아니라, v1.x에서 검증한 Provider, streaming, runtime policy, performance evidence가 모여 조직 기반 LLMOps Gateway MVP로 설명되는 목표 지점이어야 합니다.

Control Plane 관점에서 보완하고 싶은 점은 v2.0.0의 핵심 장면이 단순히 "관리자가 설정을 만든다"가 아니라, "관리자가 만든 정책이 안전하게 검증되고 publish되며 Gateway runtime에서 재현 가능하게 소비된다"여야 한다는 점입니다.

유보하거나 팀 결정이 필요한 부분은 identity/scope, raw content 저장 여부, live publish 범위, log/metric/event 표현 방식입니다. 이 항목들은 편의상 코드나 문서에서 먼저 확정하면 되돌리기 어렵기 때문에, 현재 문서에서는 후보와 판단 기준까지만 둡니다.

## 2. Main Path

- RuntimeConfig 또는 RuntimeSnapshot publish thin slice
- Provider/model/routing/cache/safety/rate policy authoring 흐름
- policy validation과 안전한 publish/reload 기준
- Gateway가 소비할 수 있는 runtime policy 산출물 준비
- credential lifecycle과 민감값 노출 방지 원칙 정리
- invalid config, stale config, reload failure 상황의 기본 동작 제안

## 3. Shadow / Evidence Path

- static snapshot export로 Gateway 연동 전 병렬 검증
- policy validation 실패/성공 evidence 정리
- publish/reload failure mode 문서화
- policy cache 비용과 reload 빈도 후보 분석
- DB/query 최적화 후보는 분석만 하고 구조 확정은 보류
- 데모용 preset 정책과 sanitized fixture 준비

## 4. 소비해야 하는 계약 후보

- Gateway가 실제로 소비 가능한 runtime policy 최소 형태
- Safety 쪽 decision category와 policy 연결 방식
- Observability가 요구하는 감사/집계 수준
- Web Console에서 편집 가능한 정책 범위
- 실제 Provider/Mock fallback 전환에 필요한 운영 제약

## 5. 생산해야 하는 계약 후보

- publish 가능한 runtime policy artifact 후보
- validation 결과와 실패 사유 표현 기준 후보
- 정책 변경이 Gateway 결과에 반영되었음을 보여주는 evidence
- 민감 정보가 UI, log, fixture, demo에 노출되지 않는 운영 원칙
- v1.x에서 사용할 static snapshot 또는 thin live publish 샘플

## 6. v1.x에서 먼저 처리할 것

- static snapshot export
- policy validation smoke
- Gateway가 snapshot을 읽어 동작하는 최소 연결
- Mock fallback을 유지한 실제 Provider 정책 후보
- 정책 변경 전후를 비교할 수 있는 sanitized demo fixture
- invalid publish 시 안전하게 막히는 흐름

## 7. v2.0.0까지 남길 것

- 조직/팀/사용자/Application scope의 최종 모델
- live runtime config의 정식 lifecycle
- streaming, cache, safety, rate policy의 세부 정규화
- audit/event/metric의 최종 구조
- raw content 저장 opt-in 여부와 보안 조건
- 다중 Provider, 다중 모델 운영 정책의 확장 기준

## 8. 데모 Evidence

- 관리자가 정책을 바꾸면 다음 요청 결과가 바뀌는 장면
- 잘못된 정책은 publish되지 않고 기존 안전 상태가 유지되는 장면
- 민감 원문이나 비밀값 없이도 정책 효과를 설명하는 dashboard evidence
- Gateway live path가 실패해도 fallback fixture로 발표를 이어갈 수 있는 장면

## 9. 팀 결정 항목

팀 결정이 필요한 항목은 `have-to-decision.md`에 분리합니다.
