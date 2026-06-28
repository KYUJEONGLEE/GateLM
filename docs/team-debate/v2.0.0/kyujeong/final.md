# Final Draft - 이규정

> Observability, Data Platform & Performance 관점의 v2.0.0 working draft 결론입니다.
> 공식 계약 확정 문서가 아니며, API, DB, Event, Metrics, security-sensitive field를 확정하지 않습니다.

## 1. 최종 입장

지섭 제안의 큰 방향에 동의합니다. v2.0.0은 v1.x에서 검증한 실제 Provider, streaming, runtime config, performance evidence를 모아 조직 기반 LLMOps Gateway MVP로 설명 가능한 상태가 되어야 합니다.

Observability 역할의 핵심은 더 많은 로그를 남기는 것이 아니라, 팀이 데모와 발표에서 "요청이 Gateway를 통과했고, 정책이 적용됐고, 결과가 관찰 가능했다"고 증명할 수 있는 evidence를 만드는 것입니다.

## 2. v1.x 우선 처리

- k6 baseline 강화
- Dashboard aggregate 정합성 검증
- query profile 수집
- 요청 흐름별 관찰 가능 지점 정리
- 원문/secret 없이도 설명 가능한 evidence 구성

## 3. v2.0.0까지 남길 것

- 조직/팀/사용자/Application 관점의 관제 경험
- 성능 병목과 개선 근거를 보여주는 evidence pack
- 보존 기간, 접근 권한, 민감 정보 처리 정책 합의
- PostgreSQL 한계 측정 이후 데이터 플랫폼 고도화 판단
- 데모에서 traffic 변화가 Dashboard에 반영되는 장면

## 4. 소비/생산 계약

소비해야 하는 것은 Gateway 처리 요약, Runtime 설정 맥락, Safety 판정 요약, Web Dashboard 요구입니다. 생산해야 하는 것은 aggregate 의미 초안, 성능 측정 결과, query profile, 병목 후보, 데모 evidence입니다.

구체 필드명과 저장 구조는 이 문서에서 확정하지 않습니다.

## 5. 팀 결정 요청

- raw prompt/response 저장 기본값
- Dashboard 집계 기준
- 성능 evidence의 최소 기준
- 보존 기간과 접근 권한
- PostgreSQL 이후 데이터 플랫폼 고도화 시점
- security-sensitive data를 관찰 데이터에서 어떻게 제외할지

## 6. 한 줄 결론

v2.0.0의 Observability는 많이 저장했다가 아니라 안전하게 관찰했고, 반복 측정했고, 설명 가능한 근거를 남겼다로 평가되어야 합니다.
