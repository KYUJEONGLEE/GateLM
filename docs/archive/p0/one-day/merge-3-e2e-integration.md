# Merge 3: 실제 연결과 E2E 완성

## 목표

분리 구현된 기능을 실제 데모 흐름으로 연결한다.

이 단계가 끝나면 Web에서 credential을 발급하고, 고객사 앱 데모 화면에서 Gateway 요청을 보내고, 로그와 대시보드에서 결과를 확인할 수 있어야 한다.

## 에이전트 사용 방법

에이전트에게 여러 문서를 하나씩 첨부하지 않는다.

각 역할 에이전트에는 이 파일 하나와 자기 역할 프롬프트만 전달한다.

에이전트는 자기 역할 프롬프트의 `읽을 문서` 목록에 적힌 파일을 직접 열어서 확인한 뒤 작업한다.

만약 에이전트가 로컬 파일을 읽을 수 없는 환경이라면, 그때만 필요한 문서를 추가로 첨부한다.

## 공통 계약

- Gateway 외부 API는 OpenAI-compatible 형식을 유지한다.
- Control Plane API 응답은 `{ "data": ... }` envelope을 사용한다.
- API Key와 App Token 원문은 생성 응답에서 1회만 반환한다.
- DB에는 credential 원문을 저장하지 않고 hash와 prefix만 저장한다.
- 로그 API는 원문 prompt와 원문 response를 반환하지 않는다.
- P0에서는 Mock Provider만 사용한다.
- P0에서는 `stream=true`를 지원하지 않는다.
- P0에서는 Rate Limit, Budget hard block, Semantic Cache를 구현하지 않는다.
- Web은 Provider를 직접 호출하지 않고 Control Plane 또는 Gateway만 호출한다.
- 담당 영역 밖 파일은 최소한으로만 수정한다.

## 역할별 구현 프롬프트

### A: Demo seed/reset

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-3-e2e-integration.md
- docs/p0/a-day5-demo-baseline.md
- docs/p0/demo-acceptance.md
- docs/architecture/db-schema.md

Merge 3 A 작업을 수행해줘.
데모 초기화를 위한 seed/reset 흐름을 보강해줘.
Control Plane API가 데모 데이터 기준으로 안정적으로 동작해야 한다.
다른 역할의 Gateway/Web 내부 구현은 수정하지 않는다.
완료 기준은 데모 시작 전에 Tenant/Project/Application/key/token 상태를 재현 가능하게 만드는 것이다.
```

### B: Log/Dashboard API 연결 보강

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-3-e2e-integration.md
- docs/architecture/llm-log-schema.md
- docs/architecture/dashboard-metrics.md
- docs/p0/demo-acceptance.md

Merge 3 B 작업을 수행해줘.
Gateway 로그 목록, 로그 상세, 대시보드 summary API가 Web에서 사용 가능한 형태인지 확인하고 보강해줘.
요청 수, 성공 수, 차단 수, 총 토큰, 총 비용, 평균 latency, cache hit 정보를 제공해야 한다.
원문 prompt/response는 반환하지 않는다.
완료 기준은 Web에서 표시할 summary 데이터가 Gateway API로 조회되는 것이다.
```

### C: Routing context 연결

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-3-e2e-integration.md
- docs/architecture/gateway-flow.md
- docs/p0/a-day3-runtime-config.md
- docs/p0/demo-acceptance.md

Merge 3 C 작업을 수행해줘.
Gateway 요청 context에 tenant, project, application, end_user_id, feature_id, requested_model, routed_model을 안정적으로 담아줘.
model=auto일 때 Simple Routing 결과와 routing reason이 로그 상세에서 보이도록 연결한다.
인증 실패 응답 형식은 기존 계약을 깨지 않는다.
완료 기준은 auto 요청의 routed_model과 routing reason이 로그 상세에서 확인되는 것이다.
```

### D: 데모용 보안/캐시 케이스

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-3-e2e-integration.md
- docs/policies/pii-masking-policy.md
- docs/p0/p0-test-matrix.md
- docs/p0/demo-acceptance.md

Merge 3 D 작업을 수행해줘.
데모에서 보여줄 세 가지 보안/캐시 요청을 안정화해줘.
1번은 일반 요청 cache miss,
2번은 개인정보 포함 redacted,
3번은 동일 요청 exact cache hit로 구성한다.
위험 정보 차단 요청도 smoke test에 포함한다.
완료 기준은 데모용 요청 세트가 항상 같은 결과를 내는 것이다.
```

### E: Web E2E 연결

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-3-e2e-integration.md
- docs/architecture/api-spec.md
- docs/architecture/dashboard-metrics.md
- docs/p0/demo-acceptance.md

Merge 3 E 작업을 수행해줘.
Web에서 고객사 앱 연동 데모 화면을 실제 Gateway에 연결해줘.
발급받은 API Key와 App Token으로 /v1/chat/completions 요청을 보내고,
성공 후 request_id를 보여주며 로그 상세로 이동할 수 있게 한다.
로그 목록, 로그 상세, 대시보드 요약도 실제 API에 연결한다.
완료 기준은 Web만 보고 온보딩부터 로그 확인까지 시연 가능한 것이다.
```

## 머지 후 통과해야 할 테스트 리스트

- Web에서 Tenant/Project/Application 생성 가능
- Web에서 API Key/App Token 발급 가능
- Web 고객사 앱 데모에서 Gateway 요청 성공
- 요청 성공 후 request_id 표시
- 로그 목록에 방금 요청 표시
- 로그 상세에 routing/cache/masking/token/cost/latency 표시
- 대시보드 summary 갱신
- 일반 요청 cache miss 확인
- 개인정보 포함 요청 redacted 확인
- 동일 요청 2회차 exact cache hit 확인
- 위험 정보 포함 요청 blocked 확인

## 머지 후 Codex 검증 요청 프롬프트

```text
Merge 3 구현이 끝났어.
docs/p0/one-day/merge-3-e2e-integration.md 기준으로 E2E 구현 상황을 검증해줘.
Web 온보딩부터 Gateway 요청, 로그 상세, 대시보드 summary까지 가능한 범위에서 직접 테스트해줘.
자동 테스트와 smoke script를 우선 실행하고,
통과/실패/미구현/수동확인 필요 항목을 표로 정리해줘.
데모 시나리오가 끊기는 지점이 있으면 우선순위까지 적어줘.
```
