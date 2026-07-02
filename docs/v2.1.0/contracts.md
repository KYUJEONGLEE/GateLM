# GateLM v2.1.0 Self-host Contracts

## 1. Status

This document defines the GateLM v2.1.0 self-host delivery contract.

v2.1.0 does not replace the v2.0.0 Gateway, RuntimeSnapshot, Provider, Observability, API, DB, Event, Metrics, or Security-sensitive field contracts.

If this document conflicts with `docs/v2.0.0/contracts.md` on request handling, runtime policy, provider execution, logging, metrics, dashboard read models, or forbidden data, `docs/v2.0.0/contracts.md` wins.

v2.1.0 adds one product delivery goal:

```text
Single-node Docker Compose self-host installable MVP
```

The customer-visible success path is:

```text
download self-host bundle
-> configure .env
-> docker compose pull
-> docker compose up -d
-> run migration
-> run bootstrap seed
-> run smoke test
-> send one Gateway request
-> see the request in Request Log
```

## 2. Source Of Truth

Read `docs/README.md` first when starting work.

For v2.1.0 self-host packaging work, use this order:

1. `docs/v2.0.0/contracts.md` for Gateway/API/DB/Event/Metrics/Security-sensitive behavior
2. `docs/v2.1.0/contracts.md` for self-host packaging and installability
3. `docs/v2.1.0/implementation-plan.md`
4. `docs/v2.1.0/implementation-tasks.md`
5. `docs/v2.1.0/acceptance-test-matrix.md`

Rules:

- v2.1.0 must not silently create new API routes, DB columns, Event fields, Metrics labels, or Security-sensitive fields.
- If self-host packaging requires a v2.0.0 contract change, stop and make a contract PR first.
- Provider and Model remain catalog/config data, not DB or code enums.
- Gateway must still consume published RuntimeSnapshot, not editable RuntimeConfig.
- Self-host scripts must not print API Keys, App Tokens, Provider Keys, Authorization headers, raw prompt, raw response, provider raw error body, or actual secrets.

## 3. Scope

v2.1.0 is in scope when it makes the existing v2.0.0 product path installable on a single customer-owned host.

| Area | v2.1.0 contract |
|---|---|
| Delivery | Docker images plus a self-host bundle |
| Runtime | Single-node Docker Compose |
| Services | Web, Control Plane API, Gateway Core, AI Service, PostgreSQL, Redis, Mock Provider |
| Optional services | Worker, Redpanda, ClickHouse, object storage |
| Install flow | configure, pull, up, migrate, seed, smoke-test |
| Data | Customer-owned PostgreSQL and Redis volumes |
| Secrets | Runtime environment or customer secret store references only |
| Verification | Fresh install smoke proves Gateway request and Request Log |

## 4. Non-goals

The following are not v2.1.0 MVP requirements:

- Kubernetes Helm chart
- multi-node high availability
- autoscaling
- air-gapped image tar bundle
- mandatory managed PostgreSQL or managed Redis
- mandatory Redpanda
- mandatory ClickHouse
- mandatory S3-compatible object storage
- AWS Secrets Manager or KMS as required dependency
- Semantic Cache live response path
- raw prompt/raw response storage opt-in
- token-level streaming logging
- response-side safety scan main path
- new billing/invoice product flow

These can be planned for later v2.x releases.

## 5. Self-host Bundle Shape

The v2.1.0 self-host bundle target path is:

```text
deploy/selfhost/
```

Minimum bundle contents:

```text
deploy/selfhost/
  docker-compose.yml
  .env.example
  README.md
  scripts/
    install.sh
    migrate.sh
    seed.sh
    smoke-test.sh
  docs/
    install.md
    upgrade.md
    backup-restore.md
    troubleshooting.md
  reverse-proxy/
    caddy/
    nginx/
```

The bundle may include both Bash and PowerShell scripts, but Bash scripts are the minimum target for the first self-host MVP.

The root development `docker-compose.yml` can remain developer-focused. Customer-facing Compose files must live under `deploy/selfhost/`.

## 6. Docker Images

v2.1.0 requires production images that start the application process directly without mounting the source repository.

Minimum images:

```text
gatelm/web:2.1.0
gatelm/control-plane-api:2.1.0
gatelm/gateway-core:2.1.0
gatelm/ai-service:2.1.0
```

Rules:

- Images must not contain `.env`, provider keys, API keys, app tokens, private keys, local credentials, or customer data.
- Images must use versioned tags. `latest` may exist for convenience, but docs and acceptance must use explicit version tags.
- Dev toolbox images are not customer delivery images.
- Compose must support registry override by env var or documented image prefix.
- Container start commands must run the app, not open an interactive shell.

## 7. Runtime Topology

v2.1.0 MVP topology:

```text
customer host
  reverse proxy optional
  web
  control-plane-api
  gateway-core
  ai-service
  postgres
  redis
  mock-provider
```

Default local ports may be exposed for MVP installability, but production guidance must route public traffic through a reverse proxy.

Recommended public routes:

```text
https://gatelm.example.com/
https://gatelm.example.com/api/
https://gatelm.example.com/gateway/v1/
```

Internal service-to-service URLs must use Compose service names, not `localhost`.

## 8. Configuration And Secrets

Self-host configuration is environment-driven.

Minimum configuration categories:

- deployment mode
- public domain/base URLs
- internal service URLs
- PostgreSQL connection
- Redis connection
- JWT/session/encryption secrets if used by the app
- Gateway API/App token bootstrap policy
- Provider credential resolver mode
- Provider credential environment bindings
- demo/mock provider mode
- log level
- image registry and tag

Rules:

- `.env.example` must contain placeholders only.
- `.env.example` must not contain real secrets or secret-shaped values.
- Scripts must validate that required secrets are not left as unsafe defaults when the selected mode requires them.
- Provider credentials must be resolved server-side only.
- Gateway, Web, and Control Plane logs must not print raw secrets or Authorization headers.

## 9. Migration And Bootstrap

v2.1.0 must provide a deterministic migration and bootstrap flow.

Migration contract:

- Apply the active Control Plane Prisma migrations.
- Apply shared SQL migrations that the Gateway log/rate-limit path requires.
- Keep migration order explicit in `migrate.sh`.
- Migration scripts must fail fast and return non-zero on failure.
- Migration scripts must not drop customer data.

Bootstrap contract:

- Create or verify a default tenant/project/application suitable for the smoke test.
- Create or verify Gateway API credential metadata and App Token metadata without printing raw tokens.
- Create or verify Mock Provider configuration.
- Ensure the Gateway can resolve a published runtime execution view.
- If RuntimeSnapshot active pointer creation is not handled by seed, bootstrap must publish the RuntimeConfig through the Control Plane path or explicitly create the same safe state.
- Bootstrap must be idempotent for repeated install attempts.

If full customer admin identity is not implemented in the current Control Plane, v2.1.0 may document a limited demo/operator bootstrap mode. That mode must be labeled as MVP bootstrap, not production-grade identity.

## 10. Smoke Test

The self-host smoke test proves installability, not just process startup.

Minimum smoke sequence:

1. `web` health endpoint or HTTP response is reachable.
2. `control-plane-api /healthz` returns success.
3. `gateway-core /healthz` returns success.
4. `gateway-core /readyz` returns success or a documented ready state with required dependencies ok.
5. `ai-service /healthz` returns success.
6. PostgreSQL and Redis are reachable from their dependent services.
7. One synthetic Gateway request succeeds through `/v1/chat/completions`.
8. The request produces a Request Log row/detail available through the documented read path.

Smoke output must redact credentials and must not echo request headers containing secrets.

## 11. Observability And Metrics

v2.1.0 self-host must preserve v2.0.0 observability semantics:

- Gateway-produced `terminalStatus + domainOutcomes` remain canonical.
- Observability must not infer stage outcomes from legacy fields.
- Metrics labels must not include request IDs, trace IDs, hashes, credential IDs, Authorization headers, provider keys, raw error detail, raw prompt, or raw response.
- Request Log and Request Detail must not expose raw prompt, raw response, provider raw error body, or credential plaintext.

Self-host install scripts may show high-level status only:

```text
ok
failed
service unavailable
request id
```

They must not show raw prompt/response payloads.

## 12. Upgrade, Backup, And Restore

v2.1.0 MVP must document operational basics even if scripts are minimal.

Minimum operations:

- image tag upgrade path
- `docker compose pull`
- migration before or during upgrade
- smoke test after upgrade
- PostgreSQL backup using dump
- PostgreSQL restore path
- volume location warning
- rollback note for image tag revert

The first MVP can document Redis as cache/state that may be recreated unless a feature explicitly depends on durable Redis data.

## 13. Completion Criteria

v2.1.0 self-host is complete when a fresh host can perform:

```text
copy .env.example .env
edit .env
./scripts/install.sh
./scripts/migrate.sh
./scripts/seed.sh
./scripts/smoke-test.sh
```

and the result is:

- Web Console is reachable.
- Control Plane API is reachable.
- Gateway Core is reachable and ready.
- AI Service is reachable.
- One Gateway request succeeds.
- Request Log shows the request.
- Restarting containers preserves PostgreSQL-backed data.
- No forbidden sensitive value is exposed in image, compose file, env example, logs, API response, UI, metrics label, fixture, or smoke output.

