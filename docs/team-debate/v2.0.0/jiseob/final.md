# Final Draft - 이지섭 / Gateway Data Plane & Governance

> 이 문서는 GateLM v2.0.0 team-debate를 정리하기 위한 이지섭 관점의 최종 의견 초안입니다.
> 공식 계약이 아니라 working draft이며, API, DB, Event, Metrics, security-sensitive field를 확정하지 않습니다.
> 합의된 내용만 이후 공식 v2.0.0 문서로 승격합니다.

## 1. 결론

GateLM v2.0.0은 모든 엔터프라이즈 기술을 한 번에 붙이는 버전이 아니라, v1.x에서 검증한 실제 Provider, RuntimeSnapshot, streaming, redacted evidence, performance baseline을 바탕으로 조직 기반 LLMOps Gateway MVP를 선언하는 목표 버전이어야 합니다.

Gateway Data Plane은 이 목표에서 "요청이 반드시 Gateway를 통과하고, 정책이 요청 결과에 영향을 주며, 그 결과가 안전하게 evidence로 남는다"는 장면을 책임집니다.

## 2. 제안 문서에 대한 최종 입장

### 동의

- v1.x를 v2.0.0으로 가는 과정으로 보는 방향
- v2.0.0의 주인공은 기술 목록이 아니라 관리자 대시보드에서 LLM traffic을 통제하는 장면이라는 점
- 실제 Provider 1종, 모델 2개 이상, Mock fallback 유지 방향
- RuntimeSnapshot thin slice는 v1.x에서 먼저 붙여야 한다는 점
- raw prompt/response 저장은 기본 금지로 두는 방향
- PostgreSQL 기반 운영 가능성, k6 baseline, query profile을 먼저 확인한 뒤 고급 데이터 플랫폼을 검토하는 방향

### 보완

- Gateway는 v2.0.0에서 모든 정책 시스템을 완성하기보다, 정책 소비와 결과 evidence 생산 경계를 명확히 보여주는 데 집중합니다.
- 공식 계약 전에는 필드명보다 흐름과 책임 경계를 먼저 합의합니다.
- Demo evidence는 raw data가 아니라 redacted summary와 aggregate 중심으로 준비합니다.
- 다른 역할의 구현이 늦어도 Gateway smoke, fixture, conformance test로 병렬 진행할 수 있어야 합니다.

### 유보

- `teamId`를 Gateway core identity로 승격할지는 아직 유보합니다.
- event/log/metric의 canonical naming은 Observability와 Safety 합의 이후 확정해야 합니다.
- streaming normalization의 최종 형태는 v2.0.0 이후 고도화 대상으로 남길 수 있습니다.

## 3. Main Path

```text
Application 또는 Chat 요청
-> Gateway 진입
-> RuntimeSnapshot 또는 runtime config 참조
-> safety/cache/routing/budget 판단
-> provider adapter 또는 mock fallback 호출
-> 응답 또는 streaming 응답 반환
-> redacted evidence 생산
-> Observability와 Dashboard가 소비
```

이 경로는 얇아도 끝까지 연결되어야 합니다. v2.0.0에서 가장 중요한 것은 정책 기반 Gateway 요청 처리가 실제로 설명 가능하다는 점입니다.

## 4. Shadow / Evidence Path

- RuntimeSnapshot fixture 기반 요청 처리
- provider adapter conformance test
- mock fallback smoke
- streaming thin slice smoke
- timeout/failure/backpressure 검토
- traffic simulator 요청 처리
- redacted terminal evidence
- k6 baseline과 연결 가능한 Gateway scenario

## 5. 소비/생산 계약 후보

Gateway가 소비해야 하는 계약 후보는 RuntimeSnapshot 또는 runtime config publish 결과, Application API / Chat 요청 경계, SafetyDecision 계열 판단 결과, routing/cache/budget policy 후보, provider credential 참조 방식, Observability가 요구하는 request correlation 맥락입니다.

Gateway가 생산해야 하는 계약 후보는 요청 처리 결과 요약, routing/cache/safety/provider/streaming 결과 요약, demo와 dashboard가 소비 가능한 redacted evidence입니다.

생산 계약은 raw prompt/response와 secret을 포함하지 않는 것을 기본값으로 둡니다.

## 6. v1.x에서 먼저 처리할 것

- 실제 Provider adapter 1종 검증
- 모델 2개 이상 routing smoke
- Mock fallback 유지
- RuntimeSnapshot 또는 static config fixture 소비
- streaming thin slice
- timeout/failure handling 기준 정리
- redacted evidence 출력
- traffic simulator와 Gateway smoke 연결
- k6 baseline 개선 후보 정리

## 7. v2.0.0까지 남길 것

- 조직 기반 LLMOps Gateway MVP 메시지 완성
- 정책 변경이 요청 결과에 반영되는 장면
- Provider, Mock fallback, streaming thin slice가 연결된 demo path
- Dashboard가 소비 가능한 redacted evidence
- 성능 baseline과 병목 후보 설명
- security-sensitive data를 노출하지 않는 demo 운영 방식

## 8. v2.0.0 이후로 넘길 수 있는 것

- 완전한 streaming normalization
- 대규모 event/log pipeline
- ClickHouse, Redpanda, Envoy 도입
- multi-instance HA 구조
- raw prompt/response opt-in 세부 기능
- 장기 retention과 encryption 세부 정책
- 고도화된 provider abstraction

## 9. 한 줄 최종 의견

Gateway 관점에서 v2.0.0의 성공 기준은 많은 기술 도입이 아니라, 정책 기반 요청 처리와 안전한 evidence 생산이 실제 demo path에서 끊기지 않고 연결되는 것입니다.
