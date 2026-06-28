# GateLM v2.0.0 Final Position - 재혁님

> 재혁님 / Control Plane & Runtime Policy 관점의 최종 의견 초안입니다.
> 아직 팀 합의 전 working draft이며, 공식 API, DB, Event, Metrics, security-sensitive field를 확정하지 않습니다.

## 1. 최종 입장

지섭님의 v2.0.0 방향 제안에 대체로 동의합니다. v2.0.0은 기술 목록을 많이 붙이는 버전이 아니라, v1.x에서 검증한 조각들이 모여 조직 기반 LLMOps Gateway MVP로 설명되는 목표 버전이어야 합니다.

재혁님 역할에서 v2.0.0의 핵심은 "관리자가 정책을 만든다"가 아니라 "정책이 안전하게 검증되고 publish되며 Gateway runtime에서 일관되게 소비된다"는 것을 증명하는 것입니다.

## 2. v1.x 우선순위

- static RuntimeSnapshot 또는 runtime policy export
- policy validation smoke
- Gateway 소비 경로 thin slice
- invalid publish 방지
- 실제 Provider 정책 후보와 Mock fallback 유지
- sanitized demo fixture 준비

## 3. v2.0.0까지 남길 것

- runtime policy lifecycle 정식화
- 조직/팀/budget scope 최종 합의
- live publish/reload 운영 기준
- streaming/cache/safety/rate policy 정규화
- audit/log/metric/event 최종 계약
- 민감 원문 저장 opt-in 여부

## 4. main path

Control Plane은 v2.0.0 main path에서 정책 authoring, validation, publish, Gateway 소비 가능 artifact 생성까지 책임집니다. 단, 세부 저장 구조나 외부 계약 필드는 팀 합의 전까지 확정하지 않습니다.

## 5. shadow/evidence path

Gateway 구현이 늦어져도 Control Plane은 static snapshot, validation report, sanitized fixture, failure mode 정리로 병렬 evidence를 만들 수 있습니다. 이 evidence는 발표에서 "정책 변경이 운영 결과에 영향을 준다"는 메시지를 지탱해야 합니다.

## 6. 팀 결정 요청

- RuntimeConfig와 RuntimeSnapshot 경계
- identity/scope/budget 표현 방식
- publish/reload 실패 시 기본 동작
- 민감 원문 저장 여부와 opt-in 조건
- Provider/streaming/cache/safety/rate policy의 v2 포함 범위
- event/log/metric evidence 수준
- 데모 입력 방식과 fallback 동선

## 7. 한 줄 결론

Control Plane 관점의 v2.0.0 성공 기준은 멋진 설정 화면이 아니라, 안전하게 publish된 정책이 Gateway runtime 결과와 데모 evidence로 확인되는 것입니다.
