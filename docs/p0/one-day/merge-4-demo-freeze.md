# Merge 4: 데모 안정화와 Freeze

## 목표

새 기능 추가를 멈추고 데모 실패 가능성을 줄인다.

이 단계에서는 기능을 넓히지 않고, 기존 구현을 안정화한다.

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

## 역할별 안정화 프롬프트

### A: Control Plane smoke

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-4-demo-freeze.md
- docs/p0/demo-acceptance.md
- docs/p0/p0-test-matrix.md
- docs/p0/local-dev.md

Merge 4 A 작업을 수행해줘.
새 기능을 추가하지 말고 Control Plane smoke와 seed/reset 재현성만 확인해줘.
Tenant, Project, Application, API Key, App Token 생성 흐름이 데모에서 안정적으로 반복되어야 한다.
실패하는 부분만 최소 수정한다.
```

### B: Gateway smoke

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-4-demo-freeze.md
- docs/p0/demo-acceptance.md
- docs/p0/p0-test-matrix.md
- docs/p0/local-dev.md

Merge 4 B 작업을 수행해줘.
새 기능을 추가하지 말고 Gateway smoke, log API, dashboard API 응답만 확인해줘.
safe request, 로그 목록, 로그 상세, summary 조회가 안정적으로 동작해야 한다.
실패하는 부분만 최소 수정한다.
```

### C: Auth/Routing smoke

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-4-demo-freeze.md
- docs/p0/demo-acceptance.md
- docs/p0/p0-test-matrix.md
- docs/p0/local-dev.md

Merge 4 C 작업을 수행해줘.
새 기능을 추가하지 말고 인증 실패, scope mismatch, model=auto routing 결과만 확인해줘.
정상 credential, 잘못된 API Key, 잘못된 App Token, scope mismatch가 구분되어야 한다.
실패하는 부분만 최소 수정한다.
```

### D: Security/Cache smoke

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-4-demo-freeze.md
- docs/p0/demo-acceptance.md
- docs/p0/p0-test-matrix.md
- docs/p0/local-dev.md

Merge 4 D 작업을 수행해줘.
새 기능을 추가하지 말고 마스킹, 차단, exact cache hit 회귀만 확인해줘.
개인정보는 redacted 되어야 하고, 위험 정보는 blocked 되어야 하며, 동일 요청 2회차는 cache hit가 되어야 한다.
실패하는 부분만 최소 수정한다.
```

### E: Web demo polish

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-4-demo-freeze.md
- docs/p0/demo-acceptance.md
- docs/p0/p0-test-matrix.md
- docs/p0/local-dev.md

Merge 4 E 작업을 수행해줘.
새 기능을 추가하지 말고 화면 동선, 버튼, 에러 메시지, 데모 대본 기준의 안정성만 확인해줘.
데모 중 사용자가 눌러야 하는 버튼과 확인해야 하는 값이 명확해야 한다.
실패하는 부분만 최소 수정한다.
```

## 머지 후 통과해야 할 테스트 리스트

- 전체 서비스 로컬 실행 가능
- Web 온보딩 가능
- key/token 발급 가능
- 발급 credential로 Gateway 요청 성공
- 잘못된 credential 실패
- scope mismatch 실패
- `/v1/models` 조회 가능
- `/v1/chat/completions` 호출 가능
- cache hit 확인
- masking 확인
- blocked 확인
- log list 확인
- log detail 확인
- dashboard summary 확인
- `.env`, 실제 secret, credential 파일 커밋 없음
- 원문 prompt/response 로그 노출 없음

## 추천 smoke 명령

아래 명령은 존재하는 것만 실행한다.

```powershell
docker compose ps
```

```powershell
go test ./...
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev/p0-day5-demo-check.ps1
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev/p0-day5-demo-flow.ps1
```

## 머지 후 Codex 검증 요청 프롬프트

```text
Merge 4 구현이 끝났어.
docs/p0/one-day/merge-4-demo-freeze.md 기준으로 데모 안정화 상태를 검증해줘.
새 기능 평가는 하지 말고, 데모가 처음부터 끝까지 끊기지 않는지와 smoke test 통과 여부만 봐줘.
가능한 자동 테스트와 smoke script를 실행하고,
통과/실패/미구현/수동확인 필요 항목을 표로 정리해줘.
마지막으로 데모 직전 반드시 고쳐야 할 blocker만 따로 정리해줘.
```
