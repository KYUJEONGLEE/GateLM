# 이지섭 - Gateway Data Plane & Governance v2.0.0 의견

> 이 문서는 GateLM v2.0.0 team-debate를 위한 이지섭 / Gateway Data Plane & Governance 관점의 working draft입니다.
> 공식 API, DB, Event, Metrics, security-sensitive field 계약이 아닙니다.
> 합의된 내용만 이후 공식 contracts 또는 implementation plan으로 승격합니다.

## 1. 기본 입장

기존 `jiseob-v2-direction-proposal.md`의 큰 방향에 동의합니다.

v2.0.0은 새로운 기술을 한 번에 많이 붙이는 버전이 아니라, v1.x에서 검증한 실제 Provider, streaming, RuntimeSnapshot, performance evidence를 바탕으로 조직 기반 LLMOps Gateway MVP를 설명할 수 있는 목표 버전이어야 합니다.

Gateway Data Plane은 Control Plane, Safety, Observability, Web이 만든 기능을 실제 요청 흐름에서 연결하는 위치입니다. 따라서 v2.0.0의 신뢰도는 "정책이 실제 요청에 반영되고, 그 결과가 evidence로 남는다"는 장면에서 나와야 합니다.

## 2. 동의 / 반대 / 보완

### 동의

- v1.x를 v2.0.0으로 가는 release train으로 보는 관점
- 실제 Provider adapter 1종과 Mock fallback을 함께 유지하는 방향
- RuntimeSnapshot 또는 live runtime config thin slice를 v1.x에서 먼저 검증하는 방향
- raw prompt/response 저장은 기본 금지로 두고, 필요 시 별도 opt-in 논의가 필요하다는 점
- ClickHouse, Redpanda, Envoy 같은 기술은 PostgreSQL 한계와 운영 요구가 측정된 뒤 검토하는 방향

### 반대 또는 주의

- v2.0.0에서 Gateway가 모든 역할의 세부 계약을 먼저 확정하는 방식에는 반대합니다.
- `teamId`를 Gateway core identity로 성급히 승격하는 것은 위험합니다.
- streaming, safety, observability를 한 번에 완전한 형태로 정규화하려 하면 v2 범위가 과도해질 수 있습니다.
- API/DB/Event/Metrics/security-sensitive field 이름을 이 문서에서 확정하면 안 됩니다.

### 보완 제안

- Gateway는 v2.0.0에서 완성된 플랫폼보다 검증 가능한 요청 경로를 우선합니다.
- main path는 실제 요청 처리 흐름이고, shadow/evidence path는 다른 역할이 늦어도 병렬로 진행할 수 있는 검증 작업으로 둡니다.
- 계약은 확정이 아니라 소비/생산 후보로만 기록합니다.
- 데모 evidence는 raw prompt/response나 secret이 아니라, redacted log, aggregate metric, routing/safety/cache 결과 요약 중심으로 준비합니다.

## 3. Main Path

Gateway Data Plane & Governance의 main path는 아래 흐름을 얇지만 끝까지 연결하는 것입니다.

```text
request
-> Gateway context
-> RuntimeSnapshot 또는 runtime config 참조
-> safety/cache/routing 판단
-> provider adapter 또는 mock fallback
-> response 또는 stream
-> redacted terminal evidence
-> observability/log/dashboard 소비 가능 결과
```

v2.0.0까지 Gateway가 반드시 보여줘야 하는 것은 "정책이 요청 결과에 영향을 주고, 그 결과가 추적 가능하게 남는다"는 점입니다.

## 4. Shadow / Evidence Path

- provider adapter conformance test
- mock provider 기반 streaming smoke
- timeout, retry, backpressure, graceful shutdown 검토
- RuntimeSnapshot fixture 소비 테스트
- redaction 이후 log/event sample 검증
- traffic simulator 기반 Gateway smoke
- k6 baseline과 연계 가능한 요청 시나리오 정리

## 5. 소비해야 하는 계약 후보

- Control Plane: RuntimeSnapshot 또는 runtime config publish 결과
- Web/Product: Application API 요청 경계와 demo preset 요청 형태
- Safety: SafetyDecision 또는 masking decision 계열 판단 결과
- Observability: request log/detail에서 요구하는 최소 추적 맥락
- Governance: tenant/application/budget scope 계열의 정책 판단 맥락
- Secret 관리: provider credential을 Gateway가 직접 노출하지 않는 소비 방식

## 6. 생산해야 하는 계약 후보

- 요청 처리 결과 요약
- routing 결과 요약
- cache hit/miss 결과 요약
- safety 적용 결과 요약
- provider call 결과 요약
- streaming 완료 또는 실패 결과 요약
- dashboard와 demo가 소비할 수 있는 redacted evidence

## 7. v1.x에서 먼저 처리할 것

- 실제 Provider adapter 1종 연결 후보 검증
- Mock fallback 유지
- 모델 2개 이상 routing smoke
- RuntimeSnapshot 또는 static config fixture 소비
- streaming thin slice
- timeout/failure handling 기준 정리
- k6 baseline과 연결 가능한 Gateway scenario
- redacted evidence 출력 방식 정리

## 8. v2.0.0까지 남길 것

- 완전한 streaming normalization
- 고도화된 event schema 확정
- DB 저장 구조 고도화
- multi-instance / HA 구조
- ClickHouse, Redpanda, Envoy 도입 판단
- raw prompt/response opt-in 정책
- security-sensitive field의 구체 naming과 retention 정책

## 9. 데모 Evidence

- 동일한 요청이 Gateway를 통과했다는 trace
- RuntimeSnapshot 또는 정책 변경 후 routing/cache/safety 결과가 달라지는 장면
- 실제 Provider와 Mock fallback 전환 장면
- streaming thin slice가 끊기지 않고 동작하는 장면
- dashboard가 소비 가능한 redacted request result
- 실패 요청의 timeout/fallback 처리 결과

## 10. 팀 결정 필요 항목

자세한 결정 항목은 `have-to-decision.md`에 분리합니다.
