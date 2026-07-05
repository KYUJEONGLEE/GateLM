# GateLM Documentation Guide

이 문서는 GateLM의 문서 지도이자 권위 수준을 설명하는 진입점이다. 작업을 시작할 때는 이 문서를 먼저 읽고, 계약/API/DB/Event/Metrics/Security-sensitive field 판단은 `specs/`의 계약 문서를 우선한다.

## 현재 버전 체계

| 구분 | 값 | 의미 |
|---|---|---|
| Latest GitHub Release | `v0.0.1` | 현재 공개 release |
| Next release target | `v0.1.0` | Organization-Based Gateway MVP release readiness |
| Gateway spec version | `v2.0.0` | Gateway 계약, schema, fixture version |
| Legacy milestone | `v1.0.0` | historical milestone, 현재 product release가 아님 |
| Future/draft track | `v2.1.0` | self-host/evaluation draft, 현재 계약을 대체하지 않음 |

`v2.0.0`과 `v2.1.0`은 GitHub Release 번호가 아니라 계약/계획 문서의 version label이다.

## Source Of Truth

문서끼리 충돌하면 아래 순서로 판단한다.

1. `specs/gateway/v2.0.0/contracts.md`
2. `specs/gateway/v2.0.0/schemas/*.schema.json`
3. `specs/gateway/v2.0.0/fixtures/*.fixture.json`
4. 현재 release readiness 문서: `docs/releases/v0.1.0.md`
5. archive/draft 문서가 아닌 현재 공개 문서

계약 변경이 필요하면 README나 release note에 끼워 넣지 않는다. 별도 contract/spec 변경으로 분리한다.

## 문서 권위 수준

| 위치 | 권위 | 용도 |
|---|---|---|
| `README.md` | public entry | 처음 온 사람이 프로젝트 정체성과 현재 상태를 이해하는 입구 |
| `docs/` | public docs | 사람이 읽는 개발/운영/구성/로드맵 문서 |
| `specs/gateway/v2.0.0/` | authoritative spec | Gateway 계약, JSON Schema, fixture |
| `docs/releases/` | release readiness | release note, verification result, known gaps |
| `docs/archive/` | historical only | 과거 milestone, old planning, RC checklist, legacy contract |
| `docs/drafts/` | future/draft only | 아직 current release 계약이 아닌 future material |
| `.codex/local/` | local harness | Codex와 사용자 사이의 로컬 작업 메모, 커밋 대상 아님 |

## 공개 문서

| 문서 | 설명 |
|---|---|
| `docs/getting-started.md` | 로컬 실행과 기본 검증 |
| `docs/architecture/README.md` | 현재 아키텍처와 main request path |
| `docs/configuration.md` | 환경 변수, provider credential, RuntimeSnapshot mode |
| `docs/development.md` | 브랜치, 계약 변경, 검증 규칙 |
| `docs/deployment.md` | 로컬, self-host draft, AWS/SaaS positioning |
| `docs/roadmap.md` | release cadence와 향후 기준 |
| `docs/releases/v0.1.0.md` | `v0.1.0` release readiness 초안 |

## Spec

현재 Gateway 계약은 아래에서 관리한다.

| 문서 | 설명 |
|---|---|
| `specs/gateway/v2.0.0/contracts.md` | Gateway v2.0.0 계약 기준 |
| `specs/gateway/v2.0.0/schemas/` | JSON Schema |
| `specs/gateway/v2.0.0/fixtures/` | Schema fixture |

Spec 문서의 Provider/Model field는 DB enum 또는 code enum 고정 근거로 사용하지 않는다. Provider와 Model은 catalog/config data로 유지한다.

## Archive

| 위치 | 설명 |
|---|---|
| `docs/archive/v1.0.0/` | 잘못 제품 release처럼 보일 수 있던 legacy milestone 문서 |
| `docs/archive/gateway-v2.0.0-planning/` | v2.0.0 구현 계획, PR packet, RC checklist 등 historical planning |
| `docs/archive/p0/` | 초기 P0 기록 |

Archive 문서는 배경 이해와 의사결정 추적에만 사용한다. 현재 계약과 충돌하면 `specs/gateway/v2.0.0/contracts.md`를 우선한다.

## Draft

`docs/drafts/gateway-v2.1.0/`는 self-host packaging, advanced routing/evaluation, production image 계획을 담은 draft 영역이다. 현재 `v0.1.0` release나 Gateway v2.0.0 계약을 대체하지 않는다.

Draft 문서의 후보 표현을 공식 API, DB, Event, Metrics, Schema field로 바로 승격하지 않는다.

## 검증

문서, schema, fixture, entry document, Node/pnpm baseline을 바꾸면 아래 검증을 우선 실행한다.

```powershell
git diff --check
corepack pnpm run verify:v2-docs
corepack pnpm run verify:v2-final
```

영향 범위에 따라 typecheck, smoke, Go test를 추가한다. 실행하지 못한 검증은 release note나 PR 본문에 이유와 남은 위험을 적는다.

## Forbidden Data

아래 값은 DB, log, fixture, API response, metric label, UI, release evidence에 평문으로 남기지 않는다.

- raw prompt
- raw response
- raw detected value
- raw prompt fragment
- API Key
- App Token
- Provider Key
- Authorization header
- provider raw error body
- actual secret
