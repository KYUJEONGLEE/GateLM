# GateLM v2.1.0 Production Images

This document records the v2.1.0 self-host image build targets.

`docs/v2.0.0/contracts.md` remains the source of truth for Gateway behavior, RuntimeSnapshot, Provider, Observability, API, DB, Event, Metrics, and Security-sensitive fields. These images only package the existing services for self-host delivery.

## Image Tags

Use explicit version tags for customer-facing installs:

```text
gatelm/web:2.1.0
gatelm/control-plane-api:2.1.0
gatelm/gateway-core:2.1.0
gatelm/ai-service:2.1.0
```

`latest` can exist as a registry convenience tag, but self-host docs, compose files, and acceptance evidence should use the explicit `2.1.0` tag.

## Build Commands

Run these commands from the repository root:

```powershell
docker build -f infra/docker/web.Dockerfile -t gatelm/web:2.1.0 .
docker build -f infra/docker/control-plane-api.Dockerfile -t gatelm/control-plane-api:2.1.0 .
docker build -f infra/docker/gateway-core.Dockerfile -t gatelm/gateway-core:2.1.0 .
docker build -f infra/docker/ai-service.Dockerfile -t gatelm/ai-service:2.1.0 .
```

## Runtime Ports

| Image | Default port | Process |
|---|---:|---|
| `gatelm/web:2.1.0` | 3000 | Next.js standalone server |
| `gatelm/control-plane-api:2.1.0` | 3001 | NestJS compiled app |
| `gatelm/gateway-core:2.1.0` | 8080 | compiled Go gateway binary |
| `gatelm/ai-service:2.1.0` | 8001 | FastAPI app through `gatelm-ai-service` |

Containers start the app process directly. They do not require the source repository to be mounted at runtime.

## Secret Boundary

Do not bake customer configuration or secret material into images.

Forbidden image contents include:

```text
.env
provider credentials
private keys
local credentials
customer data
raw prompt
raw response
Authorization header values
actual secrets
```

Runtime configuration must be supplied by the self-host Compose environment, customer secret store references, or another server-side runtime configuration mechanism.
