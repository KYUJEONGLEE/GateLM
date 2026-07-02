# Merge 2: 핵심 기능 완성

## 목표

각 역할의 핵심 기능을 완성한다.

이 단계가 끝나면 Control Plane에서 credential을 발급하고, Gateway가 DB 기반으로 인증하며, 로그/보안/캐시/Web 온보딩이 동작해야 한다.

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

### A: Credential 발급 API

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-2-core-completion.md
- docs/architecture/api-spec.md
- docs/architecture/db-schema.md
- docs/p0/p0-test-matrix.md

Merge 2 A 작업을 수행해줘.
Control Plane에 API Key 발급, App Token 발급, 목록 조회 API를 구현해줘.
구현 대상:
- POST /api/projects/:projectId/api-keys
- POST /api/applications/:applicationId/app-tokens
- GET /api/projects/:projectId/api-keys
- GET /api/applications/:applicationId/app-tokens
원문 key/token은 생성 응답에서 1회만 반환하고 DB에는 sha256 hash와 prefix만 저장한다.
기본 scope는 gateway:chat, gateway:models로 둔다.
완료 기준은 DB에 원문 key/token이 저장되지 않는 것이다.
```

### B: 로그 저장/조회 안정화

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-2-core-completion.md
- docs/architecture/llm-log-schema.md
- docs/architecture/gateway-flow.md
- docs/p0/p0-test-matrix.md

Merge 2 B 작업을 수행해줘.
Gateway 요청 로그 저장/조회 흐름을 안정화해줘.
요청별 request_id, model, token, cost, latency, status, cache, routing, masking 결과가 조회 가능해야 한다.
원문 prompt/response는 반환하지 않는다.
완료 기준은 요청 1건 이후 로그 목록과 로그 상세에서 필요한 메타데이터가 확인되는 것이다.
```

### C: DB 인증 실제 연결

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-2-core-completion.md
- docs/architecture/db-schema.md
- docs/architecture/gateway-flow.md
- docs/p0/a-day3-runtime-config.md

Merge 2 C 작업을 수행해줘.
Gateway가 Authorization Bearer API Key와 X-GateLM-App-Token을 DB에서 검증하도록 연결해줘.
정상 credential은 통과해야 한다.
잘못된 API Key는 401로 처리한다.
잘못된 App Token 또는 scope mismatch는 403으로 처리한다.
model=auto 요청은 Simple Routing을 적용하고 routed_model을 로그 context에 남긴다.
완료 기준은 발급 credential 기반 Gateway 호출이 가능한 것이다.
```

### D: 보안/캐시 Gateway 통합

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-2-core-completion.md
- docs/policies/pii-masking-policy.md
- docs/architecture/gateway-flow.md
- docs/p0/p0-test-matrix.md

Merge 2 D 작업을 수행해줘.
마스킹, 위험 정보 차단, Exact Cache를 실제 Gateway 요청 흐름에 통합해줘.
개인정보 포함 요청은 redacted prompt가 provider에 전달되어야 한다.
위험 정보 포함 요청은 provider 호출 전에 blocked 되어야 한다.
동일 요청 2회차는 provider 호출 없이 cache hit가 되어야 한다.
완료 기준은 redacted, blocked, exact cache hit 세 시나리오가 테스트로 확인되는 것이다.
```

### E: Web 온보딩 연결

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-2-core-completion.md
- docs/architecture/api-spec.md
- docs/architecture/dashboard-metrics.md
- docs/p0/demo-acceptance.md

Merge 2 E 작업을 수행해줘.
Web 온보딩 화면을 실제 Control Plane API에 연결해줘.
Tenant 생성, Project 생성, Application 생성, API Key 발급, App Token 발급이 화면에서 가능해야 한다.
발급된 원문 key/token은 1회만 보여주고 다시 볼 수 없다는 안내를 표시한다.
아직 Gateway 호출은 다음 Merge에서 연결해도 된다.
완료 기준은 Web에서 credential 발급까지 완료되는 것이다.
```

## 머지 후 통과해야 할 테스트 리스트

- A: API Key 발급 API 성공
- A: App Token 발급 API 성공
- A: credential 원문이 DB에 저장되지 않음
- B: 요청 로그 저장 성공
- B: 요청 로그 목록 조회 성공
- B: 요청 로그 상세 조회 성공
- C: 발급 credential로 Gateway 인증 성공
- C: 잘못된 API Key는 401
- C: 잘못된 App Token 또는 scope mismatch는 403
- D: 개인정보 포함 요청 redacted
- D: 위험 정보 포함 요청 blocked
- D: 동일 요청 2회차 exact cache hit
- E: Web에서 온보딩 완료
- E: Web에서 API Key/App Token 발급 완료

## 머지 후 Codex 검증 요청 프롬프트

```text
Merge 2 구현이 끝났어.
docs/p0/one-day/merge-2-core-completion.md 기준으로 구현 상황을 검증해줘.
Control Plane credential 발급, Gateway DB 인증, 로그 조회, 보안/캐시, Web 온보딩을 테스트해줘.
가능한 자동 테스트를 먼저 실행하고,
통과/실패/미구현/수동확인 필요 항목을 표로 정리해줘.
원문 key/token/prompt/response가 저장되거나 노출되는지도 확인해줘.
```
