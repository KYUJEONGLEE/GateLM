# GateLM Self-host Install Guide

This guide is for a customer-managed single-node GateLM v2.1.0 Docker Compose installation.

Run all commands from:

```bash
deploy/selfhost
```

## What You Install

The base bundle runs the existing non-RAG services. Rows marked **RAG
overlay** are added only when `TENANT_CHAT_RAG_ENABLED=true`.

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

The app images are pulled from a registry. Customers do not need to build source code.

## Prerequisites

- Linux server, macOS, or Windows with Docker Desktop
- Docker Engine with Docker Compose v2
- `bash`
- `curl`
- Access to the image registry that hosts `gatelm/<service>:2.1.0`
- At least 4 GiB of temporary free space when optional PII models are enabled

Check Docker:

```bash
docker version
docker compose version
```

## 1. Registry Login

If your registry requires authentication, login before running install:

```bash
docker login <registry-host>
```

Examples:

```bash
docker login ghcr.io
docker login registry.example.com
```

Do not paste registry passwords, provider keys, API keys, app tokens, or Authorization headers into support tickets or shared logs.

## 2. Create `.env`

Copy the example file:

```bash
cp .env.example .env
```

On PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` before production exposure.

Minimum values to review:

| Variable | Purpose |
|---|---|
| `GATELM_IMAGE_REGISTRY` | Image registry namespace, default `gatelm` |
| `GATELM_IMAGE_TAG` | Image version, default `2.1.0` |
| `GATELM_PUBLIC_DOMAIN` | Public hostname |
| `GATELM_PUBLIC_BASE_URL` | Public Web Console base URL |
| `POSTGRES_USER` | PostgreSQL username |
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `POSTGRES_DB` | PostgreSQL database name |
| `GATEWAY_EXACT_CACHE_KEY_SECRET` | Secret used for exact cache key derivation |
| `GATELM_GATEWAY_API_KEY` | Runtime project Gateway API key for smoke and public chat |
| `CONTROL_PLANE_INTERNAL_SERVICE_TOKEN` | Control Plane internal read token for Gateway |
| `GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN` | Gateway copy of the Control Plane internal read token |
| `GATEWAY_OBSERVABILITY_INTERNAL_TOKEN` | Separate server-only Web-to-Gateway observability read token |
| `TENANT_CHAT_*_SECRET` and service tokens | Tenant Chat session and service-to-service boundaries |
| `TENANT_CHAT_WORKLOAD_ACTIVE_KID` | Existing Tenant Chat completion signing key ID |
| `RAG_QUERY_EMBEDDING_ACTIVE_KID` | Chat API query embedding signing key ID |
| `RAG_WORKER_EMBEDDING_ACTIVE_KID` | RAG worker ingestion signing key ID |
| `AI_SERVICE_RAG_SERVICE_TOKEN` | Worker-to-AI extraction service authentication |

When enabling RAG, provision file-backed secrets before install. The installer
does not generate or print them and rejects missing, empty, symlinked, or
placeholder material. Use one non-root `TENANT_CHAT_RUNTIME_UID:GID` for the
four consumers.

```text
.secrets/tenant-chat/signing.jwk.json
.secrets/tenant-chat/jwks.json
.secrets/tenant-chat/binding-hmac-keys.json
.secrets/tenant-chat/content-keys.json
.secrets/tenant-chat/cache-keysets.json
.secrets/tenant-chat/usage-receipt-token
.secrets/rag/content-wrapping-keys.json
.secrets/rag/query-signing.jwk.json
.secrets/rag/query-binding-hmac-keys.json
.secrets/rag/worker-signing.jwk.json
.secrets/rag/worker-binding-hmac-keys.json
.secrets/rag/workload-jwks.json
.secrets/rag/workload-binding-hmac-keys.json
.secrets/rag/workload-identities.json
```

These files are required only when `TENANT_CHAT_RAG_ENABLED=true`. With the
flag disabled, the installer uses only `docker-compose.yml`, does not validate
or mount RAG role secrets, and keeps the existing non-RAG service set.

On Linux, directories must be mode `700`, files must not grant group/world
access, and their numeric owner must match `TENANT_CHAT_RUNTIME_UID:GID`.
Private query keys are never mounted into `rag-worker` or Gateway; private
worker keys are never mounted into `chat-api` or Gateway.

PII model inference is disabled by default and is not required for a normal
self-host install. To opt in:

1. Obtain the approved release's presigned HTTPS bundle URL through your normal
   artifact delivery process.
2. Copy `secrets/pii-model-bundle-url.example` to
   `secrets/pii-model-bundle-url` and restrict it to the installing user.
3. Open the new file in an editor and put exactly one HTTPS URL on one line.
4. Set the two feature flags and the secret file path shown below.

```bash
cp secrets/pii-model-bundle-url.example secrets/pii-model-bundle-url
chmod 600 secrets/pii-model-bundle-url
${EDITOR:-vi} secrets/pii-model-bundle-url
```

```text
GATEWAY_AI_SAFETY_SIDECAR_ENABLED=true
AI_SERVICE_INSTALL_ML_DEPS=true
AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED=true
AI_SERVICE_PII_MODEL_BUNDLE_URL_FILE=./secrets/pii-model-bundle-url
AI_SERVICE_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES=phone_number,secret
AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS=
```

Do not put the presigned URL itself in `.env`, a command argument, a support
ticket, or shared logs. The install initializer reads it only from the mounted
Compose secret. It verifies the pinned outer bundle hash, embedded manifest,
and all runtime file hashes before atomically exposing the versioned model
directory to AI Service. `AI_SERVICE_INSTALL_ML_DEPS=true` is mandatory for
this opt-in because an image without the pinned ONNX dependencies cannot load
the verified files.

Demo seed is disabled for self-host/prod-like deployments. Keep demo UUID values only for non-prod local seed experiments:

```text
GATELM_DEMO_TENANT_ID
GATELM_DEMO_PROJECT_ID
GATELM_DEMO_APPLICATION_ID
GATELM_DEMO_API_KEY_ID
GATELM_DEMO_APP_TOKEN_ID
```

## 3. Pull And Start

Use the install script:

```bash
bash scripts/install.sh
```

What it does:

- checks `.env`
- checks Docker and Compose
- warns if placeholder secrets remain
- when RAG is enabled, validates Tenant Chat/RAG secret files and role-specific workload IDs
- pulls images
- downloads and verifies the pinned PII model release when the opt-in is enabled
- starts the Compose stack
- starts the base Compose stack and, only when RAG is enabled, adds `rag-worker`, `chat-api`, and `chat-web`

Manual equivalent:

```bash
docker compose --env-file .env pull
docker compose --env-file .env up -d
docker compose --env-file .env ps
```

When `TENANT_CHAT_RAG_ENABLED=true`, add the overlay to every manual command:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.rag.yml pull
docker compose --env-file .env -f docker-compose.yml -f docker-compose.rag.yml up -d
docker compose --env-file .env -f docker-compose.yml -f docker-compose.rag.yml ps
```

Use the script for normal installs because it gives safer beginner-friendly error messages.

## 4. Run Migrations

Run:

```bash
bash scripts/migrate.sh
```

This applies:

- Control Plane Prisma migrations
- Gateway runtime SQL in `deploy/selfhost/migrations/`

If migration fails, fix the migration issue before creating runtime resources.

## 5. Create Runtime Resources

Create the first real runtime boundary through the Console or admin API:

- tenant
- project
- application
- Gateway API key
- provider configuration
- active RuntimeSnapshot pointer

Do not run `scripts/seed.sh` in self-host/prod-like deployments; it exits with a clear error.

## 6. Smoke Test

Run:

```bash
bash scripts/smoke-test.sh
```

The smoke test checks:

- PostgreSQL readiness
- Redis readiness
- service health endpoints
- one Gateway `/v1/chat/completions` request
- Request Log lookup for that request

The script does not print request body, response body, Authorization header, API key, app token, provider key, or raw model output.

When optional PII models are enabled, run the separate model-runtime smoke:

```bash
bash scripts/pii-model-smoke.sh
```

This proves the pinned OpenAI primary is loaded with no additional model, the
runtime ML allowlist is exactly `phone_number,secret`, and one sanitized batch
request takes the hybrid inference path and masks its fixed synthetic value. It
does not prove production-grade PII accuracy or Tenant Chat end-to-end behavior
because the Self-host bundle does not include the Tenant Chat API/Web
applications.

## 7. Open The Services

Default local URLs:

| Surface | URL |
|---|---|
| Web Console | `http://localhost:3000` |
| Tenant Chat Web (RAG enabled) | `http://localhost:3002` |
| Control Plane API | `http://localhost:3001` |
| Gateway Core | `http://localhost:8080` |
| AI Service | `http://localhost:8001` |
| Mock Provider | `http://localhost:8090` |

For production, put TLS and public routing in front of the stack with your reverse proxy or load balancer.

## 8. Daily Operations

Check service status:

```bash
docker compose --env-file .env ps
```

View logs without sharing secrets:

```bash
docker compose --env-file .env logs --tail=100 gateway-core
docker compose --env-file .env logs --tail=100 control-plane-api
docker compose --env-file .env -f docker-compose.yml -f docker-compose.rag.yml logs --tail=100 rag-worker chat-api chat-web
```

Restart one service:

```bash
docker compose --env-file .env restart gateway-core
```

Stop the stack:

```bash
docker compose --env-file .env down
```

Named volumes keep PostgreSQL and Redis data unless explicitly removed.
