# GateLM AWS Triage Compose

This is a source-build deployment path for one EC2 instance. It is not a production self-host bundle. Use it to expose packaging, migration, seed, runtime, and provider-key gaps quickly while keeping AWS costs small.

It differs from `deploy/selfhost` on purpose:

- app images are built from the current repo on the EC2 instance
- no ECR, ECS, RDS, ElastiCache, ALB, Route53, or Secrets Manager is required
- PostgreSQL, Redis, mock provider, AI service, Control Plane, Gateway, and Web run on one Docker network
- PostgreSQL, Redis, mock provider, and AI service are not published to the EC2 host
- the customer application runs on port 3002 so Web Console application/chat links do not fall back to localhost
- the default provider mode is mock
- the current Gateway chat path authenticates with the project Gateway API key; the demo app token is still seeded for Control Plane compatibility and credential-management screens

## EC2 Setup

From the EC2 instance:

```bash
git clone <repo-url> GateLM
cd GateLM/deploy/aws-triage
cp .env.example .env
```

Edit `.env`:

```bash
nano .env
```

Replace:

- `GATELM_PUBLIC_DOMAIN`
- `GATELM_PUBLIC_BASE_URL`
- `GATELM_APPLICATION_BASE_URL`
- `POSTGRES_PASSWORD`
- `GATEWAY_EXACT_CACHE_KEY_SECRET`
- `GATELM_DEMO_API_KEY`
- `GATELM_DEMO_APP_TOKEN`

Use simple generated values for secrets so the interpolated database URL stays valid:

```bash
openssl rand -hex 32
```

`GATELM_DEMO_API_KEY` is used by the Web/Application BFF when it calls Gateway. `GATELM_DEMO_APP_TOKEN` is still used by the demo seed to populate the app-token management surface, but current Gateway chat requests no longer require `X-GateLM-App-Token`.

Optional Google login for the main landing page uses the Web Console auth proxy and Control Plane OAuth handler. Configure these only after creating a Google Cloud OAuth client for the exact callback URL:

```bash
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://<ec2-public-ip>:3000/api/auth/google/callback
```

For HTTPS, use `https://gatelm.co.kr/api/auth/google/callback` and set:

```bash
CONTROL_PLANE_AUTH_COOKIE_SECURE=true
```

## Security Group

For the first HTTP triage pass, keep EC2 Security Group sources restricted to your current IP.

Recommended public exposure:

- SSH `22`: your IP only
- Web `3000`: your IP only until HTTPS is ready
- Application `3002`: your IP only until HTTPS is ready
- Control Plane `3001`: do not expose publicly
- Gateway `8080`: do not expose publicly

When HTTPS is enabled through a host-level reverse proxy such as Caddy, open `80` and `443`, keep `22` restricted to your IP, and prefer closing public `3000`/`3002` access. Keep `3001` and `8080` blocked from the public internet while `CONTROL_PLANE_ADMIN_AUTH_MODE=demo_admin_placeholder`.

## Build

```bash
docker compose --env-file .env config --quiet
docker compose --env-file .env build
```

On a small instance, the first build can be slow. Keep `AI_SERVICE_INSTALL_ML_DEPS=false` unless you are intentionally testing the heavier AI safety path.

## Initialize Data

Start only infrastructure services first:

```bash
docker compose --env-file .env up -d postgres redis mock-provider
```

Apply Control Plane Prisma migrations:

```bash
docker compose --env-file .env run --rm control-plane-api ./node_modules/.bin/prisma migrate deploy
```

Apply Gateway runtime tables:

```bash
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < migrations/001_gateway_runtime_tables.sql
```

Apply dashboard pricing catalog compatibility tables and demo pricing seed:

```bash
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < ../../db/migrations/012_create_model_pricing_catalog_compat.sql
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < ../../db/seeds/002_seed_dashboard_pricing_catalog.sql
```

Seed the current MVP demo tenant, project, application, credentials, provider, and active RuntimeSnapshot:

```bash
docker compose --env-file .env run --rm control-plane-api node dist/prisma/seed.js
```

For an existing triage DB with old zero-cost successful logs, optionally backfill dashboard pricing metadata after the pricing seed:

```bash
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < ../../scripts/dev/backfill-dashboard-pricing-costs.sql
```

## Actual Provider Mode

Keep mock mode for the first boot. After the mock smoke path works, switch to an actual provider by editing `.env`:

```bash
GATELM_DEMO_PROVIDER_MODE=actual
CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP=provider_credential:00000000-0000-4000-8000-000000000601=OPENAI_API_KEY
GATEWAY_PROVIDER_CREDENTIAL_ENV_MAP=provider_credential:00000000-0000-4000-8000-000000000601=OPENAI_API_KEY
OPENAI_API_KEY=<server-only-provider-secret>
```

The right side of each env-map entry is the environment variable name. Put the real provider secret only in `OPENAI_API_KEY`, never in the map string.

Then rerun seed and recreate the runtime services:

```bash
docker compose --env-file .env run --rm control-plane-api node dist/prisma/seed.js
docker compose --env-file .env up -d --force-recreate control-plane-api gateway-core application web
```

## Start

```bash
docker compose --env-file .env up -d ai-service control-plane-api gateway-core application web
docker compose --env-file .env ps
```

Local checks from the EC2 instance:

```bash
curl -fsS http://127.0.0.1:3001/healthz
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/readyz
curl -fsS http://127.0.0.1:3000/
curl -fsS http://127.0.0.1:3002/
```

Browser checks from your machine, only if the matching Security Group sources are restricted:

```text
http://<ec2-public-ip>:3000
http://<ec2-public-ip>:3002
```

Do not rely on public browser access to `3001` or `8080`; use the local EC2 curl checks above.

## HTTPS And DNS

If using `gatelm.co.kr` and `chat.gatelm.co.kr`, create DNS `A` records pointing at the current EC2 public IPv4. If the instance is stopped and started without an Elastic IP, the public IP can change and the DNS records must be updated.

For host-level Caddy, use `Caddyfile.example`:

```bash
sudo cp Caddyfile.example /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

After HTTPS is active, update `.env`:

```bash
GATELM_PUBLIC_DOMAIN=gatelm.co.kr
GATELM_PUBLIC_BASE_URL=https://gatelm.co.kr
GATELM_APPLICATION_BASE_URL=https://chat.gatelm.co.kr
GOOGLE_OAUTH_REDIRECT_URI=https://gatelm.co.kr/api/auth/google/callback
CONTROL_PLANE_AUTH_COOKIE_SECURE=true
```

Then recreate Control Plane, Web, and Application:

```bash
docker compose --env-file .env up -d --force-recreate control-plane-api web application
```

## After Pulling A New Main/Dev Build

From `deploy/aws-triage`, after pulling new repo changes:

```bash
docker compose --env-file .env config --quiet
docker compose --env-file .env build
docker compose --env-file .env up -d postgres redis mock-provider
docker compose --env-file .env run --rm control-plane-api ./node_modules/.bin/prisma migrate deploy
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < migrations/001_gateway_runtime_tables.sql
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < ../../db/migrations/012_create_model_pricing_catalog_compat.sql
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < ../../db/seeds/002_seed_dashboard_pricing_catalog.sql
docker compose --env-file .env run --rm control-plane-api node dist/prisma/seed.js
docker compose --env-file .env up -d --force-recreate ai-service control-plane-api gateway-core application web
docker compose --env-file .env ps
```

## Stop Or Remove

Stop containers without deleting volumes:

```bash
docker compose --env-file .env stop
```

Remove containers and the local database/cache volumes:

```bash
docker compose --env-file .env down -v
```

Stopping the EC2 instance stops compute charges, but the EBS volume still exists. Terminate the EC2 instance when you are done with the triage environment.

## Known Triage Risks

- provider API keys are still supplied through environment variables
- changing provider credential env-map values requires restarting Gateway
- the demo seed supports the default UUID values only
- Gateway success can come from mock fallback; inspect Gateway metadata when testing live providers
- this path has no managed backup, centralized logs, or multi-instance availability
- HTTPS/domain support is host-level triage configuration, not a production ALB/ACM deployment
