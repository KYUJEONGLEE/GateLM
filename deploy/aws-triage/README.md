# GateLM AWS Triage Compose

This is a source-build deployment path for one EC2 instance. It is not a production self-host bundle. Use it to expose packaging, migration, runtime, and provider-key gaps quickly while keeping AWS costs small.

It differs from `deploy/selfhost` on purpose:

- app images are built from the current repo on the EC2 instance
- no ECR, ECS, RDS, ElastiCache, ALB, Route53, or Secrets Manager is required
- PostgreSQL, Redis, mock provider, AI service, Control Plane, Gateway, Web Console, Chat API, and Chat Web run on one Docker network
- PostgreSQL, Redis, mock provider, and AI service are not published to the EC2 host
- GateLM Chat Web runs on port 3002; Chat API remains private on the Docker network at port 3003
- the legacy `apps/application` image is not part of this production-like stack
- the default provider mode is mock
- the current Gateway chat path authenticates with the project Gateway API key; demo seed credentials are not used in AWS/prod-like environments

## EC2 Setup

From the EC2 instance, make sure Git, Docker Engine, and the Docker Compose plugin are installed:

```bash
git --version
docker version
docker compose version
```

If any of these are missing, install Git and Docker first. Caddy is only needed later for the HTTPS step.

Then clone the repo:

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
- `GATELM_CHAT_WEB_ORIGIN`
- `POSTGRES_PASSWORD`
- `CONTROL_PLANE_INTERNAL_SERVICE_TOKEN`
- `TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN`
- `TENANT_CHAT_WEB_SERVICE_TOKEN`
- `TENANT_CHAT_ACCESS_JWT_SECRET`
- `TENANT_CHAT_INTENT_SECRET`
- `GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN` (use the same value)
- `GATELM_GATEWAY_API_KEY`
- `GATEWAY_EXACT_CACHE_KEY_SECRET`
- `GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY`

Use simple generated values for secrets so the interpolated database URL stays valid:

```bash
openssl rand -hex 32
```

The AWS triage stack uses the same admin auth boundary as production. Configure SMTP and keep dev auto-verify disabled:

```bash
AUTH_EMAIL_TRANSPORT=smtp
CONTROL_PLANE_AUTH_DEV_AUTO_VERIFY=false
CONTROL_PLANE_AUTH_STATE_SECRET=<random-long-value>
CONTROL_PLANE_INTERNAL_SERVICE_TOKEN=<random-long-value>
GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN=<same-random-long-value>
TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN=<separate-random-long-value>
TENANT_CHAT_WEB_SERVICE_TOKEN=<separate-random-long-value>
TENANT_CHAT_ACCESS_JWT_SECRET=<separate-random-long-value>
TENANT_CHAT_INTENT_SECRET=<separate-random-long-value>
SMTP_HOST=<smtp-host>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_TLS_MODE=opportunistic
SMTP_USER=<smtp-user-if-required>
SMTP_PASSWORD=<smtp-password-if-required>
SMTP_FROM=<verified-sender>
```

`CONTROL_PLANE_AUTH_STATE_SECRET` signs the signup draft cookie. Generate a
long random value for each deployment and do not reuse the placeholder from
`.env.example`.

Do not deploy AWS triage with `AUTH_EMAIL_TRANSPORT=dev_memory` or `CONTROL_PLANE_AUTH_DEV_AUTO_VERIFY=true`; the Control Plane now refuses those values in production-like environments.

Provider credentials registered through the Web Console are encrypted before
being stored. Set a stable 32-byte encryption key before using the Provider
registration screen:

```bash
GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY=<openssl-rand-hex-32-output>
GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY_VERSION=v1
```

Do not change this key after storing provider credentials unless you also
rotate or re-register those credentials. The value is a server-only encryption
key, not a provider API key.

Do not leave `GATELM_GATEWAY_API_KEY` blank in AWS/prod-like environments. The Web Console does not fall back to a seeded demo key. Do not commit real project API keys or provider keys. Tenant Chat conversation execution is not part of this auth-shell slice, so the composer remains disabled until the follow-up model connection work lands.

Optional Google login for the main landing page uses the Web Console auth proxy and Control Plane OAuth handler. Configure these only after creating a Google Cloud OAuth client for the exact callback URL:

```bash
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://<ec2-public-ip>:3000/api/auth/google/callback
TENANT_CHAT_GOOGLE_REDIRECT_URI=http://<ec2-public-ip>:3002/auth/google/callback
```

For HTTPS, use `https://gatelm.co.kr/api/auth/google/callback` for the Console and `https://chat.gatelm.co.kr/auth/google/callback` for Chat, then set:

```bash
CONTROL_PLANE_AUTH_COOKIE_SECURE=true
```

## Security Group

For the first HTTP triage pass, keep EC2 Security Group sources restricted to your current IP.

Recommended public exposure:

- SSH `22`: your IP only
- Web `3000`: your IP only until HTTPS is ready
- Chat Web `3002`: your IP only until HTTPS is ready
- Chat API `3003`: Docker-network only; never publish it on the host or Security Group
- Control Plane `3001`: localhost-bound by default; do not expose publicly
- Gateway `8080`: localhost-bound by default; do not expose publicly

When HTTPS is enabled through a host-level reverse proxy such as Caddy, open `80` and `443`, keep `22` restricted to your IP, and prefer closing public `3000`/`3002` access. Keep `3001` and `8080` blocked from the public internet even with `CONTROL_PLANE_ADMIN_AUTH_MODE=session_cookie`.

The default `.env.example` binds host ports like this:

```bash
AWS_TRIAGE_WEB_BIND=0.0.0.0
AWS_TRIAGE_CHAT_WEB_BIND=0.0.0.0
AWS_TRIAGE_CONTROL_PLANE_BIND=127.0.0.1
AWS_TRIAGE_GATEWAY_BIND=127.0.0.1
```

After HTTPS is working through Caddy, set `AWS_TRIAGE_WEB_BIND=127.0.0.1` and `AWS_TRIAGE_CHAT_WEB_BIND=127.0.0.1`, then recreate Web and Chat Web.

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
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < ../../db/migrations/013_seed_openai_canonical_pricing_aliases.sql
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < ../../db/seeds/002_seed_dashboard_pricing_catalog.sql
```

Do not run the demo seed in AWS/prod-like environments. The Control Plane now refuses the demo seed path there; create the tenant, project, application, Gateway API key, provider connection, and published RuntimeSnapshot through the Console or admin API.

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

Then publish a new RuntimeSnapshot from the Console or admin API and recreate the runtime services:

```bash
docker compose --env-file .env up -d --force-recreate control-plane-api gateway-core web chat-api chat-web
```

## Start

```bash
docker compose --env-file .env up -d ai-service control-plane-api gateway-core web chat-api chat-web
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
sudo apt-get update
sudo apt-get install -y caddy
sudo cp Caddyfile.example /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

After HTTPS is active, update `.env`:

```bash
GATELM_PUBLIC_DOMAIN=gatelm.co.kr
GATELM_PUBLIC_BASE_URL=https://gatelm.co.kr
GATELM_CHAT_WEB_ORIGIN=https://chat.gatelm.co.kr
GOOGLE_OAUTH_REDIRECT_URI=https://gatelm.co.kr/api/auth/google/callback
TENANT_CHAT_GOOGLE_REDIRECT_URI=https://chat.gatelm.co.kr/auth/google/callback
CONTROL_PLANE_AUTH_COOKIE_SECURE=true
AWS_TRIAGE_WEB_BIND=127.0.0.1
AWS_TRIAGE_CHAT_WEB_BIND=127.0.0.1
```

Then recreate Control Plane, Web Console, Chat API, and Chat Web:

```bash
docker compose --env-file .env up -d --force-recreate control-plane-api web chat-api chat-web
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
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < ../../db/migrations/013_seed_openai_canonical_pricing_aliases.sql
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < ../../db/seeds/002_seed_dashboard_pricing_catalog.sql
docker compose --env-file .env up -d --force-recreate ai-service control-plane-api gateway-core web chat-api chat-web
docker compose --env-file .env ps
```

If Provider registration shows `Provider credential encryption backend is not configured`, set
`GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY` and recreate `control-plane-api`
before registering credentials. If Gateway returns a sanitized runtime config
error, confirm the selected project/application is active and has a published
RuntimeSnapshot before debugging provider credentials.

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
- demo seed is blocked in AWS/prod-like environments; use real tenant/project/application setup
- Gateway success can come from mock fallback; inspect Gateway metadata when testing live providers
- Chat authentication state is authoritative in PostgreSQL; Redis is not a session store
- Chat API is private-only and must not be added to Caddy or a public Security Group rule
- this path has no managed backup, centralized logs, or multi-instance availability
- HTTPS/domain support is host-level triage configuration, not a production ALB/ACM deployment
