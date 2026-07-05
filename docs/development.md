# Development

이 문서는 GateLM 개발 작업을 시작할 때 지켜야 하는 기준이다.

## 브랜치 기준

- `main`과 `dev`에서 직접 구현하지 않는다.
- 작업은 `dev` 기준 feature/docs branch에서 진행한다.
- shared branch push, tag 생성/push, GitHub Release publish, PR merge는 명시적 승인 후 진행한다.

## 계약 변경 기준

계약/API/DB/Event/Metrics/security-sensitive field에 닿는 변경은 먼저 `specs/gateway/v2.0.0/contracts.md`를 확인한다.

새 필드나 라벨을 만들 때는 다음 근거가 필요하다.

- 계약 문서 근거
- 필요하면 JSON Schema와 fixture 갱신
- forbidden data와 high-cardinality metrics label 검토
- release note 또는 PR 본문에 영향 범위 기록

## Archive/Draft 사용 기준

- `docs/archive/`는 historical only다.
- `docs/drafts/`는 future/draft only다.
- archive/draft의 후보 표현을 현재 API, DB, Event, Metrics, Schema field로 바로 승격하지 않는다.

## 기본 검증

```powershell
git diff --check
corepack pnpm run verify:v2-docs
corepack pnpm run verify:v2-final
```

실행하지 못한 검증은 이유와 남은 위험을 기록한다.
