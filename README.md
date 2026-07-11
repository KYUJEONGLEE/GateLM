# GateLM

GateLM은 기업의 LLM 요청을 승인된 Gateway 경로로 모아 보안, 비용, 정책, 로그, 관측을 중앙에서 관리하는 B2B LLM Gateway입니다.

현재 개발은 `dev` 브랜치에서 계속 진행 중이며 다음 제품 SemVer는 아직 확정되지 않았습니다. 공식 GitHub 최신 릴리스는 `v0.0.1`, 최신 versioned 문서는 `docs/v2.1.0/`입니다. `v2.0.0` workstream은 active가 아니며 문서는 historical baseline으로 유지합니다.

## 1. Documentation

개발자와 구현 에이전트는 다음 두 문서부터 읽습니다.

1. [`docs/current/README.md`](docs/current/README.md)
2. [`docs/current/source-of-truth.md`](docs/current/source-of-truth.md)

필요할 때만 다음 문서를 추가로 읽습니다.

- [`docs/README.md`](docs/README.md): 전체 문서 분류가 필요할 때
- [`docs/current/implementation-status.md`](docs/current/implementation-status.md): 현재 구현 사실을 확인할 때
- [`docs/current/documentation-gaps.md`](docs/current/documentation-gaps.md): 충돌이나 미결정 사항을 확인할 때

일반 작업은 current 문서와 실제 코드/타입을 기준으로 시작합니다. historical v2 구현 계획을 매 작업의 할 일 목록으로 사용하지 않습니다.

API, DB, Event, Metrics 또는 Security-sensitive field의 호환성을 확인해야 하고 current 대체 계약이 없을 때만 아래 v2.0.0 baseline을 참고합니다.

1. `docs/v2.0.0/contracts.md`
2. `docs/v2.0.0/schemas/*.schema.json`
3. `docs/v2.0.0/fixtures/*.fixture.json`

아래 파일은 historical plan/criteria입니다.

- `docs/v2.0.0/implementation-plan.md`
- `docs/v2.0.0/implementation-tasks.md`
- `docs/v2.0.0/implementation-pr-packets.md`
- `docs/v2.0.0/acceptance-test-matrix.md`
- `docs/v2.0.0/db-migration-plan.md`

문서별 정확한 상태와 권한은 [`docs/current/source-of-truth.md`](docs/current/source-of-truth.md)에서 확인합니다.

## 2. Current Product Path

현재 `dev` 구현에서 확인되는 기본 제품 흐름은 다음과 같습니다.

```text
Tenant / Project / Application setup
-> Provider connection and policy configuration
-> Employee access and control
-> Gateway auth and published runtime policy
-> budget / rate limit / safety / routing / cache
-> Provider Adapter or fallback
-> Request Log / Live Requests / Request Detail / Dashboard
```

Advanced Routing, Semantic Cache, Safety sidecar, self-host bundle처럼 release 상태와 기본 활성화 여부가 다른 기능은 [`docs/current/implementation-status.md`](docs/current/implementation-status.md)의 상태 구분을 따릅니다.

## 3. Repository Layout

| Path | Purpose |
|---|---|
| `apps/control-plane-api` | NestJS/Prisma Control Plane API |
| `apps/gateway-core` | Go Gateway data plane and governance pipeline |
| `apps/web` | Next.js/React 관리 콘솔, Dashboard, Request Detail |
| `apps/application` | Next.js/React Application/Chat surface |
| `apps/ai-service` | FastAPI safety/evaluation service |
| `deploy/selfhost` | Single-node Docker Compose self-host bundle |
| `infra/observability` | Prometheus/Grafana 관측 설정 |
| `docs/current` | Active documentation entrypoint and implementation snapshot |
| `docs/v2.1.0` | Latest versioned self-host/routing evidence scope |
| `docs/v2.0.0` | Historical behavior baseline and past planning/acceptance records |

## 4. Local Baseline

| Runtime | Version |
|---|---|
| Node.js | `22` |
| pnpm | `9.15.0` |
| PostgreSQL | `16` |
| Redis | `7` |

루트 `.nvmrc`, `.node-version`, `package.json`은 Node 22와 pnpm 9.15.0을 기준으로 합니다.

기본 문서 검증:

```powershell
corepack pnpm run verify:v2-docs
```

영향 범위에 따라 다음을 추가합니다.

```powershell
corepack pnpm run verify:v2-final
pnpm --filter @gatelm/control-plane-api typecheck
pnpm --filter @gatelm/web typecheck
go test ./...
```

## 5. Local Development

로컬 의존성은 root Compose 기준으로 시작한다.

```powershell
docker compose up -d
docker compose ps
```

volume까지 초기화해야 할 때만 아래 명령을 사용한다. PostgreSQL과 Redis의 로컬 데이터가 삭제된다.

```powershell
docker compose down --remove-orphans -v
docker compose up -d
```

Gateway의 `GATEWAY_RUNTIME_SNAPSHOT_MODE` 기본값은 `demo`다. `strict` 또는 `strict_snapshot`은 Control Plane base URL과 internal token이 필요하며, active RuntimeSnapshot을 가져오지 못하면 조용히 demo/static 경로로 대체하지 않는다.

## 6. Development Flow

현재 기본 통합 흐름은 feature/fix/docs 브랜치에서 `dev` 대상 PR을 만들고, 검증된 `dev`를 별도 PR로 `main`에 승격하는 방식입니다.

열린 PR이나 원격 feature 브랜치의 내용은 `dev`에 병합되기 전까지 현재 구현으로 문서화하지 않습니다.

## 7. Security Guardrails

다음 값은 API response, DB record, fixture, structured log, metric label, UI에 평문으로 남기지 않습니다.

- raw prompt 또는 raw response
- raw detected value 또는 raw prompt fragment
- API Key, App Token, Provider Key
- Authorization header
- provider raw error body
- actual secret

Provider와 Model은 catalog/config data로 유지하며 DB enum 또는 code enum으로 고정하지 않습니다.
