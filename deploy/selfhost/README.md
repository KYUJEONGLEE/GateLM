# GateLM Self-host Compose Bundle

This bundle is the v2.1.0 single-node Docker Compose path.

The base bundle runs the existing non-RAG services. When
`TENANT_CHAT_RAG_ENABLED=true`, the lifecycle scripts also apply
`docker-compose.rag.yml` and start the rows marked **RAG overlay**.

| Service | Image |
|---|---|
| Web Console | `gatelm/web:2.1.0` |
| Control Plane API | `gatelm/control-plane-api:2.1.0` |
| RAG Worker (`rag-worker`, RAG overlay) | `gatelm/control-plane-api:2.1.0` |
| Gateway Core | `gatelm/gateway-core:2.1.0` |
| AI Service | `gatelm/ai-service:2.1.0` |
| Tenant Chat API (`chat-api`, RAG overlay) | `gatelm/chat-api:2.1.0` |
| Tenant Chat Web (`chat-web`, RAG overlay) | `gatelm/chat-web:2.1.0` |
| PostgreSQL | `pgvector/pgvector:0.8.5-pg16-trixie` (digest pinned in Compose) |
| Redis | `redis:7-alpine` |
| Mock Provider | `python:3.12-alpine` |

The app services use `image:` references only. Customers do not need to build from source or mount the source repository.

## Quick Start

Run from `deploy/selfhost`:

```powershell
Copy-Item .env.example .env
bash scripts/install.sh
bash scripts/migrate.sh
bash scripts/smoke-test.sh
```

On Linux or macOS:

```bash
cp .env.example .env
bash scripts/install.sh
bash scripts/migrate.sh
bash scripts/smoke-test.sh
```

Before exposing the stack, edit `.env` and replace placeholder secret values. Keep runtime credentials in `.env` or a customer-managed secret system. Do not bake them into images.

When enabling RAG, provision the six files under `.secrets/tenant-chat` and the
eight files under `.secrets/rag` through your approved secret system before
running install. RAG-disabled installs do not require or mount these files. The
RAG files are `content-wrapping-keys.json`, query and worker signing JWK/binding
key pairs, and the Gateway-only `workload-jwks.json`,
`workload-binding-hmac-keys.json`, and `workload-identities.json`. Query private
material is mounted only into `chat-api`, worker private material only into
`rag-worker`, and combined verification material only into `gateway-core`.
These credentials are separate from Tenant Chat completion signing material.
No production secret generator is included in the self-host bundle.

If your shell says `permission denied`, keep using the explicit `bash scripts/<name>.sh` form. The scripts intentionally avoid printing secret values, request bodies, and response bodies.

Before running smoke tests, create a real tenant, project, application, Gateway API key, provider connection, and published RuntimeSnapshot through the Console or admin API. Demo seed is disabled for self-host/prod-like deployments.

## URLs

Default local ports:

| Surface | URL |
|---|---|
| Web Console | `http://localhost:3000` |
| Tenant Chat Web (RAG overlay) | `http://localhost:3002` |
| Control Plane API | `http://localhost:3001` |
| Gateway Core | `http://localhost:8080` |
| AI Service | `http://localhost:8001` |
| Mock Provider | `http://localhost:8090` |

Production deployments should route public traffic through a reverse proxy and TLS. Internal service-to-service traffic uses Compose service names such as `control-plane-api`, `gateway-core`, `postgres`, and `redis`.

## Configuration

`.env` controls:

- image registry and tag
- public domain/base URL
- host port bindings
- PostgreSQL database settings
- Redis connection through Compose service name
- Gateway cache and rate limit settings
- separate Web-to-Gateway observability read token
- provider mode, defaulting to mock mode
- AI Service mode
- optional PII model source secret file path; the URL itself never belongs in `.env`
- Tenant Chat service credentials and shared non-root secret-reader UID/GID
- private S3/KMS RAG storage, worker, and embedding workload identities

The lifecycle scripts select `docker-compose.rag.yml` only when the feature
flag is true. For a manual Compose command in that mode, pass both
`-f docker-compose.yml -f docker-compose.rag.yml`; the base file by itself is
the rollback-safe non-RAG stack.

PostgreSQL, Redis, and verified PII model releases use named volumes:

```text
postgres_data
redis_data
pii_model_data
```

## Health Checks

The Compose file includes health checks for all services:

- PostgreSQL readiness through `pg_isready`
- Redis readiness through `redis-cli ping`
- Web Console HTTP response
- Control Plane `/healthz`
- Gateway process liveness
- AI Service `/healthz`
- Tenant Chat API `/readyz` when the RAG overlay is enabled
- Tenant Chat Web `/login` when the RAG overlay is enabled
- RAG worker process health when the RAG overlay is enabled
- Mock Provider `/healthz`

The full Gateway `/healthz`, `/readyz`, request, and Request Log smoke path is handled by:

```bash
bash scripts/smoke-test.sh
```

## Script Steps

| Step | Script | What it does |
|---|---|---|
| 1 | `scripts/install.sh` | validates `.env`, pulls images, and starts the Compose stack |
| 2 | `scripts/migrate.sh` | runs Control Plane Prisma migrations and Gateway runtime table SQL |
| 3 | `scripts/smoke-test.sh` | checks health endpoints, sends one Gateway request, and verifies the Request Log after real runtime resources exist |
| Optional | `scripts/pii-model-smoke.sh` | checks the pinned OpenAI model is the only loaded model, verifies the ML allowlist, and runs one sanitized hybrid masking probe |

PII models are disabled by default. When enabled, the one-shot
`pii-model-init` container downloads the bundle from a URL read through a
Compose secret, verifies the release's fixed hashes, and writes a versioned
directory to `pii_model_data`. AI Service mounts that volume read-only. This
runtime smoke is model-path evidence only, not Tenant Chat end-to-end evidence.
The default runtime leaves the additional-model list blank, loads only the
pinned OpenAI model, and limits ML candidates to `phone_number` and `secret`.
The release archive still contains every manifest-pinned artifact, so bundle
download and integrity verification are unchanged by this runtime selection.

The Gateway runtime SQL lives in:

```text
deploy/selfhost/migrations/
```

Run the scripts from `deploy/selfhost`. They use `.env` for configuration and do not require customers to build source code.

## Operations Docs

Detailed operating guides:

- `docs/install.md`
- `docs/upgrade.md`
- `docs/backup-restore.md`
- `docs/troubleshooting.md`
