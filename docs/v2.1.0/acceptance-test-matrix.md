# GateLM v2.1.0 Self-host Acceptance Test Matrix

> [!NOTE]
> **문서 상태: Versioned self-host scope.** 현재 문서 진입점은 [`docs/current/README.md`](../current/README.md)다. 이 matrix의 존재만으로 current HEAD의 fresh-host acceptance 또는 공식 v2.1.0 release 완료를 의미하지 않는다.

This document fixes the testable completion conditions for the v2.1.0 self-host MVP.

`docs/v2.0.0/contracts.md` remains the official source for Gateway behavior, RuntimeSnapshot, Provider, Observability, API, DB, Event, Metrics, and Security-sensitive fields. This matrix does not create new product API, DB, Event, or Metrics contracts.

## Global Checks

| Check | Command / Evidence | Required result |
|---|---|---|
| whitespace | `git diff --check` | no errors |
| v2 docs gate | `corepack pnpm run verify:v2-docs` | command exits 0 |
| sensitive exposure | search changed files for forbidden terms and secret-shaped examples | no new forbidden storage/exposure |
| source path | docs review | v2.0.0 behavior contract remains authoritative |
| image safety | Dockerfile review | no `.env`, credentials, private key, or local secret copied |
| customer path | compose/script review | no app service depends on source repo volume mount |

Forbidden sensitive values:

```text
raw prompt
raw response
raw detected value
raw prompt fragment
API Key
App Token
Provider Key
Authorization header
provider raw error body
actual secret
```

## PR-0. v2.1 Self-host Documentation Baseline

| Scenario | Input / Setup | Expected result | Evidence |
|---|---|---|---|
| Scope clarity | open v2.1 docs | v2.1 is defined as Single-node Docker Compose self-host MVP | doc review |
| v2.0 preservation | compare v2.1 docs with v2.0 contracts | no Gateway/API/DB/Event/Metrics behavior is redefined | doc review |
| non-goals | open `contracts.md` | Helm, HA, air-gap, mandatory ClickHouse/Redpanda are out of MVP | doc review |
| install flow | open plan/tasks/matrix | compose up, migrate, seed, smoke-test path is documented | doc review |
| security rules | open docs | forbidden sensitive values are prohibited in images/scripts/logs/env examples | doc review |

## PR-1. Production Docker Images

| Scenario | Input / Setup | Expected result | Evidence |
|---|---|---|---|
| Web image build | build `gatelm/web:2.1.0` | image builds successfully | build output |
| Control Plane image build | build `gatelm/control-plane-api:2.1.0` | image builds successfully and includes Prisma client generation path | build output |
| Gateway image build | build `gatelm/gateway-core:2.1.0` | compiled Go binary image builds successfully | build output |
| AI Service image build | build `gatelm/ai-service:2.1.0` | image builds and can run app entrypoint | build output |
| app entrypoint | run each app container | container starts app process, not shell | container logs/health |
| image secrets | inspect Dockerfiles and build context | no `.env`, key, credential, private key, or secret copied | review |
| no source mount requirement | run image without repo volume | app starts with env/config only | smoke |

Reject:

- app image whose command is `bash` or an interactive shell
- image that requires customer source checkout
- image that bakes provider keys or local `.env`

## PR-2. Self-host Compose Bundle

| Scenario | Input / Setup | Expected result | Evidence |
|---|---|---|---|
| compose config | `docker compose -f deploy/selfhost/docker-compose.yml config` | config renders successfully | command output |
| required services | inspect rendered config | Web, Control Plane, Gateway, AI Service, Postgres, Redis, Mock Provider exist | config review |
| image tags | inspect rendered config | app services use explicit image tags or documented env image tags | config review |
| volumes | inspect rendered config | PostgreSQL and Redis use named volumes | config review |
| healthchecks | inspect rendered config | app and dependency services have health checks where available | config review |
| internal URLs | inspect env/config | service-to-service URLs use Compose service names | config review |
| no source mounts | inspect rendered config | app services do not mount repo source | config review |
| env example | inspect `.env.example` | placeholders only; no real or secret-shaped values | review |

Reject:

- customer path requiring `node-toolbox`, `go-toolbox`, or `python-toolbox`
- app services using `.:/workspace` source mounts
- `.env.example` containing actual secrets

## PR-3. Self-host Config And Secrets

| Scenario | Input / Setup | Expected result | Evidence |
|---|---|---|---|
| required env validation | missing required self-host value | script or service fails with actionable error | smoke/log |
| mock mode | mock provider mode selected | no provider credential required | smoke |
| actual provider mode | actual provider mode selected without credential binding | setup fails before provider call or reports safe missing credential | smoke/log |
| provider credential resolver | env-backed credential configured | Gateway resolves credential server-side only | Gateway smoke |
| public vs internal URL | inspect `.env.example` and compose | public URLs and internal service URLs are distinct | review |
| log redaction | startup with configured values | logs do not print credential values | log review |

Reject:

- provider key in DB seed, image, compose file, docs, logs, UI, API response, or metric label
- browser-exposed App Token in self-host docs as a required customer pattern

## PR-4. Migration And Bootstrap Scripts

| Scenario | Input / Setup | Expected result | Evidence |
|---|---|---|---|
| install script | clean host with Docker/Compose | validates env, pulls/starts stack, exits 0 | command output |
| migrate script | empty Postgres volume | applies required Prisma and SQL migrations in documented order | command output |
| migrate idempotency | run migrate twice | second run succeeds or reports no-op safely | command output |
| seed script | migrated empty DB | creates/verifies minimum tenant/project/application/provider/runtime state | command output/query |
| seed idempotency | run seed twice | second run succeeds without duplicate active data | command output/query |
| runtime readiness | after seed | Gateway can load published RuntimeSnapshot or documented equivalent execution view | Gateway ready/smoke |
| sensitive output | run scripts | scripts do not print raw API Key, App Token, Provider Key, Authorization header, raw prompt, raw response, or actual secret | output review |

Reject:

- destructive migration in install path
- migration script that silently ignores failure
- seed that requires manual SQL edits for normal fresh install

## PR-5. Self-host Smoke Test

| Scenario | Input / Setup | Expected result | Evidence |
|---|---|---|---|
| Web health | stack running | Web responds at documented URL | smoke output |
| Control Plane health | stack running | `/healthz` returns ok | smoke output |
| Gateway health | stack running | `/healthz` returns ok | smoke output |
| Gateway readiness | stack running | `/readyz` returns ready or documented dependency status | smoke output |
| AI Service health | stack running | `/healthz` returns ok | smoke output |
| dependency readiness | stack running | DB and Redis dependencies are reachable | smoke output |
| Gateway request | bootstrap completed | one `/v1/chat/completions` request succeeds | smoke output |
| Request Log | after Gateway request | request appears in Request Log read path | smoke output |
| redacted output | smoke output | request ID may print; raw prompt/response and credential headers do not print | output review |

Reject:

- smoke test that only checks container status
- smoke test that prints Authorization header, API Key, App Token, Provider Key, raw prompt, or raw response
- smoke test that bypasses Gateway main path

## PR-6. Self-host Operations Runbook

| Scenario | Input / Setup | Expected result | Evidence |
|---|---|---|---|
| install docs | teammate follows docs | fresh install reaches smoke success | manual evidence |
| upgrade docs | image tag changes | docs describe pull, migrate, restart, smoke-test | doc review |
| backup docs | operator needs backup | PostgreSQL dump command and volume warning are documented | doc review |
| restore docs | operator needs restore | restore sequence is documented with stop/start guidance | doc review |
| troubleshooting docs | common failure | port conflict, DB not ready, migration failure, Gateway not ready, provider credential missing are covered | doc review |
| support boundary | docs review | Compose MVP vs Helm/HA future boundary is clear | doc review |
| secret examples | docs review | examples use placeholders and do not include actual secrets | doc review |

## Release-Level Acceptance

v2.1.0 self-host MVP is ready when:

- `deploy/selfhost` exists with Compose, env example, scripts, and docs.
- Production images exist for Web, Control Plane API, Gateway Core, and AI Service.
- A fresh install can run:

```text
copy .env.example .env
edit .env
install
migrate
seed
smoke-test
```

- Web Console is reachable.
- Control Plane API is reachable.
- Gateway Core is reachable and ready.
- AI Service is reachable.
- PostgreSQL-backed data survives container restart.
- One Gateway request succeeds.
- Request Log shows the request.
- v2.0.0 Gateway behavior remains intact.
- forbidden sensitive values are absent from images, compose files, env examples, docs, scripts, logs, API responses, UI, metrics labels, and smoke output.
