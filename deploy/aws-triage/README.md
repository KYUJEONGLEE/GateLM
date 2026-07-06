# GateLM AWS Triage Compose

This is a source-build deployment path for one EC2 instance. It is not a production self-host bundle. Use it to expose packaging, migration, seed, runtime, and provider-key gaps quickly while keeping AWS costs small.

It differs from `deploy/selfhost` on purpose:

- app images are built from the current repo on the EC2 instance
- no ECR, ECS, RDS, ElastiCache, ALB, Route53, or Secrets Manager is required
- PostgreSQL, Redis, mock provider, AI service, Control Plane, Gateway, and Web run on one Docker network
- PostgreSQL, Redis, mock provider, and AI service are not published to the EC2 host
- the customer application runs on port 3002 so Web Console application/chat links do not fall back to localhost
- the default provider mode is mock

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
- `NEXT_PUBLIC_GATELM_APPLICATION_BASE_URL`
- `POSTGRES_PASSWORD`
- `GATEWAY_EXACT_CACHE_KEY_SECRET`
- `GATELM_DEMO_API_KEY`
- `GATELM_DEMO_APP_TOKEN`

Use simple generated values for secrets so the interpolated database URL stays valid:

```bash
openssl rand -hex 32
```

Optional Google login for the main landing page uses the Web Console auth proxy and Control Plane OAuth handler. Configure these only after creating a Google Cloud OAuth client for the exact callback URL:

```bash
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://<ec2-public-ip>:3000/api/auth/google/callback
```

## Build

```bash
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
docker compose --env-file .env run --rm --no-deps control-plane-api ./node_modules/.bin/prisma migrate deploy
```

Apply Gateway runtime tables:

```bash
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < migrations/001_gateway_runtime_tables.sql
```

Seed the current MVP demo tenant, project, application, credentials, provider, and active RuntimeSnapshot:

```bash
docker compose --env-file .env run --rm --no-deps control-plane-api node dist/prisma/seed.js
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

Browser checks from your machine:

```text
http://<ec2-public-ip>:3000
http://<ec2-public-ip>:3002
http://<ec2-public-ip>:3001/healthz
http://<ec2-public-ip>:8080/healthz
```

Keep the EC2 Security Group sources restricted to your current IP.

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
- this path has no TLS, domain, managed backup, centralized logs, or multi-instance availability
