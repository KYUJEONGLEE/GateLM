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
- `TENANT_CHAT_WORKLOAD_ACTIVE_KID`
- `GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN` (use the same value)
- `GATEWAY_OBSERVABILITY_INTERNAL_TOKEN` (use a separate value)
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
GATEWAY_OBSERVABILITY_INTERNAL_TOKEN=<separate-random-long-value>
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

Generate the Tenant Chat workload signing, verification, content encryption,
cache, and usage receipt files once from `deploy/aws-triage`. The `kid` must exactly match
`TENANT_CHAT_WORKLOAD_ACTIVE_KID` in `.env`:

```bash
node ../../scripts/dev/generate-tenant-chat-local-secrets.mjs \
  --target=.secrets/tenant-chat \
  --kid=tenant-chat-production-1
chmod 700 .secrets/tenant-chat
chmod 600 .secrets/tenant-chat/*
id -u
id -g
```

The generated directory is gitignored. Never copy its private JWK, HMAC keys,
cache keys, or usage receipt token into `.env`, Git, logs, or deployment
evidence. The deployment preflight rejects missing, empty, or group/world-readable
secret files before building images. Set `TENANT_CHAT_RUNTIME_UID` and
`TENANT_CHAT_RUNTIME_GID` in `.env` to the numeric values printed by `id -u`
and `id -g`. Gateway and Chat API use that non-root identity so file-backed
Compose secrets remain readable without relaxing the `700` directory and `600`
file modes. The production deployment script verifies that all six files have
one non-root owner and passes the detected UID/GID to Compose automatically.

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
- Tenant Chat private Gateway `8081`: Docker-network only; never publish it on the host or Security Group

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

Compose requires the six files under `.secrets/tenant-chat` and an active
workload `kid` before it can start Gateway and Chat API. On a small instance,
the first build can be slow. Keep `AI_SERVICE_INSTALL_ML_DEPS=false` unless you
are intentionally testing the heavier AI safety path.

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
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < migrations/002_drop_legacy_selected_routing_columns.sql
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < migrations/003_add_p0_invocation_log_ttft.sql
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < migrations/004_add_p0_dashboard_rollup_indexes.sql
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

## Isolated Mock Performance Environment

Do not switch the normal `.env` or published RuntimeSnapshot to Mock for load
testing. The performance environment uses a separate Compose project, database,
Redis volume, network, ports, and generated test credentials:

```text
project:          gatelm-aws-perf
gateway:          http://127.0.0.1:18080
control plane:    http://127.0.0.1:13001
postgres volume:  gatelm-aws-perf-postgres-data
redis volume:     gatelm-aws-perf-redis-data
```

The performance override also uses the pinned Node-based concurrent Mock
Provider while preserving `MOCK_PROVIDER_DEFAULT_LATENCY_MS`. This avoids a
thread-per-request Python server becoming the measured bottleneck.

The performance override forces `OPENAI_API_KEY` and both Provider credential
maps to empty values. Its bootstrap fails unless the target PostgreSQL container
belongs to `gatelm-aws-perf` and mounts the expected isolated volume.
It also publishes a performance-only Mock RuntimeSnapshot with the Control
Plane ceiling of `100000` requests per 60 seconds. Normal and
actual-Provider RuntimeSnapshots keep their configured limits.

Create `.env.perf` once. The generated secret values are written with mode `600`
and are not printed:

```bash
cd /home/ubuntu/GateLM/deploy/aws-triage
bash scripts/perf-init.sh
```

On the first run after building or pulling new runtime source, build and start
the minimal performance stack. This applies the existing migrations only to the
isolated database, publishes a Mock RuntimeSnapshot, starts the runtime, and
runs the fail-closed routing preflight:

```bash
bash scripts/perf-up.sh --build
```

For later starts with already-current images, omit `--build`:

```bash
bash scripts/perf-up.sh
```

Run the safety preflight again before every k6 session:

```bash
bash scripts/perf-preflight.sh
```

The preflight requires all of the following before load is allowed:

- no live Provider credential in Control Plane or Gateway
- active RuntimeSnapshot rate limit matches the performance setting (default
  `100000` requests per 60 seconds)
- `selectedProvider=mock` and a Mock catalog model (`mock-*` suffix)
- published RuntimeSnapshot provenance
- successful Request Detail with `fallback=not_needed`

Point host-executed k6 only at `http://127.0.0.1:18080`. Host port `8080`
belongs to the normal stack and may call an actual Provider. The Docker runner
below uses the isolated performance network instead of either host port.

Run the simple cache-miss baseline with the pinned Docker k6 runner. k6 does
not need to be installed on the EC2 host:

```bash
cd /home/ubuntu/GateLM/deploy/aws-triage
GATELM_K6_TARGET_RPS=1 \
GATELM_K6_DURATION=2m \
bash scripts/perf-load.sh
```

The runner performs the Mock routing preflight first, joins only the
`gatelm-aws-perf-internal` Docker network, and targets `gateway-core:8080`
inside that network. It passes only the performance API Key and App Token to
the k6 container. The normal host port `8080` is never used.

Every run uses a dedicated run ID. After k6 exits, the runner waits for the
async log queue to drain and reconciles completed k6 iterations against the
matching `p0_llm_invocation_logs` rows. The run fails unless all of the
following are true:

- completed load iterations equal total and distinct Request Log rows
- every matched row is `success`, HTTP `200`, and has written logging outcomes
- k6 has no failed checks, HTTP failures, or dropped iterations
- async enqueue/drop/persist error deltas are zero and final queue depth is zero

The HTML dashboard export, safe k6 JSON summary, and combined reconciliation
report are written under `reports/perf/`. The combined report contains only
the synthetic run ID and aggregate values; it does not contain credentials,
raw prompts, or responses.

Before starting the runner, open an SSH tunnel from the operator machine:

```powershell
ssh -i "C:\path\to\gatelm.pem" -N `
  -L 5665:127.0.0.1:5665 `
  ubuntu@<ec2-public-ip>
```

Keep that terminal open and browse to:

```text
http://127.0.0.1:5665
```

Do not open port `5665` in the EC2 Security Group. The k6 dashboard is
published on EC2 loopback only. Close the dashboard browser tab after the test
finishes so k6 can exit and write the self-contained HTML report under
`reports/perf/`.

Optional runner settings:

| Variable | Default | Purpose |
|---|---:|---|
| `GATELM_K6_TARGET_RPS` | `1` | Scheduled cache-miss requests per second |
| `GATELM_K6_DURATION` | `2m` | Load duration |
| `GATELM_K6_PRE_ALLOCATED_VUS` | target RPS | VUs initialized before the test |
| `GATELM_K6_MAX_VUS` | target RPS x 2 | Maximum VUs k6 may allocate |
| `GATELM_K6_DASHBOARD_PORT` | `5665` | EC2 loopback dashboard port |
| `GATELM_K6_DASHBOARD_PERIOD` | `1s` | Live dashboard aggregation period |
| `GATELM_PERF_LOG_DRAIN_TIMEOUT_SECONDS` | `60` | Maximum Request Log reconciliation wait |
| `GATELM_PERF_RUNTIME_RATE_LIMIT_LIMIT` | `100000` | Isolated Mock RuntimeSnapshot limit per 60 seconds |

### Dedicated Load Generator Evidence (500 RPS)

The local runner above shares CPU, memory, disk, and Docker networking with the
Gateway. It is useful for regression checks, but it is not sufficient evidence
that one Gateway node sustains 500 RPS. Formal capacity evidence requires a
separate target host and load-generator host in the same private network.

On the target host, set the exact private IPv4 address in `.env.perf` and opt in
to remote load generation:

```dotenv
GATELM_PERF_REMOTE_LOADGEN_ENABLED=true
AWS_TRIAGE_GATEWAY_BIND=10.0.1.10
AWS_TRIAGE_GATEWAY_PORT=18080
AWS_TRIAGE_CONTROL_PLANE_BIND=127.0.0.1
```

`AWS_TRIAGE_GATEWAY_BIND=0.0.0.0` is rejected. In the target Security Group,
allow inbound TCP `18080` only from the load-generator Security Group or its
private `/32` address. Do not expose the Control Plane, PostgreSQL, Redis, Mock
Provider, or k6 dashboard. Recreate and verify the target runtime after the bind
change:

```bash
cd /home/ubuntu/GateLM/deploy/aws-triage
bash scripts/perf-up.sh --build
bash scripts/perf-preflight.sh
```

Use the same repository commit on the load-generator host. It needs Docker,
curl, and coreutils, but it does not need the target database or Provider
credentials. Create its restricted environment file:

```bash
cd /home/ubuntu/GateLM/deploy/aws-triage
cp loadgen.env.example .env.loadgen
chmod 600 .env.loadgen
```

Set `GATELM_LOADGEN_GATEWAY_BASE_URL` to the target's private Gateway endpoint.
Copy only `GATELM_DEMO_API_KEY` and `GATELM_DEMO_APP_TOKEN` from the isolated
target `.env.perf`. The runner rejects extra `.env.loadgen` keys, Provider
credentials, database credentials, internal service tokens, and files readable
by group or other users.

Run the default capacity profile from the load-generator host:

```bash
bash scripts/perf-loadgen-run.sh
```

This schedules `500 RPS` for `2m`, performs the Mock routing preflight, waits for
the async terminal-log queue to drain, and writes a self-contained bundle under
`reports/perf/loadgen/`. The bundle omits the target URL and credentials. Its
manifest deliberately keeps `capacityClaimEligible=false` because the
load-generator cannot query the target database.

Copy the complete bundle into the same path on the target host, then reconcile
it against the isolated PostgreSQL database:

```bash
cd /home/ubuntu/GateLM
scp -r ubuntu@<load-generator-private-ip>:/home/ubuntu/GateLM/reports/perf/loadgen/<bundle> \
  reports/perf/loadgen/
cd deploy/aws-triage
bash scripts/perf-loadgen-reconcile.sh \
  /home/ubuntu/GateLM/reports/perf/loadgen/<bundle>
```

The target writes `loadgen.evidence.json`. `capacityClaimEligible=true` is
possible only when all of these conditions hold:

- execution mode is `dedicated` and run-scoped machine hashes prove the two
  scripts ran on different hosts
- target remote-load mode is explicitly enabled without a wildcard bind
- target rate is exactly `500 RPS` and duration is at least `2m`
- k6 has no dropped iterations, failed checks, or HTTP failures
- completed iterations equal total and distinct Request Log rows
- every row is successful, HTTP `200`, and has written logging outcomes
- async enqueue, drop, persist-error, and persist-panic deltas are zero
- both captured and current terminal-log queue depth are zero

The raw machine ID is never written to the bundle. Each script hashes it with
the run ID, so the value cannot be correlated across runs.

### Four-Host Distributed Capacity Environment

The formal four-host path isolates the load generator, single Gateway node,
data services, and the 100ms Mock Provider. It does not reuse the public GateLM
VPC, instances, Security Groups, database, DNS, certificate, or SES resources.
Use `aws/perf-distributed.template.yml` to create a dedicated `10.77.0.0/16`
VPC in `ap-northeast-2`:

```text
10.77.1.10  load generator
10.77.1.20  gateway-core
10.77.1.30  PostgreSQL + Redis + control-plane-api
10.77.1.40  100ms Mock Provider
```

The template exposes only SSH from the supplied operator `/32`. Gateway port
`18080` accepts traffic only from the load-generator Security Group. The data
ports accept traffic only from the Gateway Security Group or the co-located
Control Plane, and Mock port `8090` accepts traffic only from the Gateway. No
GateLM service port is open to `0.0.0.0/0`.

From an authenticated AWS CloudShell, validate and create the stack:

```bash
aws cloudformation validate-template \
  --region ap-northeast-2 \
  --template-body file://deploy/aws-triage/aws/perf-distributed.template.yml

aws cloudformation deploy \
  --region ap-northeast-2 \
  --stack-name gatelm-perf-distributed \
  --template-file deploy/aws-triage/aws/perf-distributed.template.yml \
  --parameter-overrides \
    OperatorCidr=<trusted-public-ip>/32 \
    SshKeyName=<existing-key-pair-name> \
  --no-fail-on-empty-changeset
```

The default non-burstable instance types are `c7i.xlarge` for load generation,
`c7i.xlarge` for the single Gateway node, `m7i.large` for the data role, and
`c7i.large` for Mock. The instances use IMDSv2, termination protection, retained
encrypted gp3 root volumes, and `DoNotDelete=true` tags. Public IPv4 addresses
exist only for operator SSH and package/image installation; all measured
service traffic uses the fixed private addresses above.

Deploy exactly one clean Git commit to every host. A Git bundle is suitable
when EC2 must not receive GitHub credentials:

```bash
git bundle create gatelm-perf.bundle perf/distributed-load-test
```

Clone that same bundle as `/home/ubuntu/GateLM` on all four hosts. On one trusted
operator or data host, generate the isolated distributed environment once:

```bash
cd /home/ubuntu/GateLM/deploy/aws-triage
GATELM_PERF_LOADGEN_PRIVATE_IP=10.77.1.10 \
GATELM_PERF_GATEWAY_PRIVATE_IP=10.77.1.20 \
GATELM_PERF_DATA_PRIVATE_IP=10.77.1.30 \
GATELM_PERF_MOCK_PRIVATE_IP=10.77.1.40 \
bash scripts/perf-distributed-init.sh
bash scripts/perf-distributed-export-loadgen-env.sh
```

Copy `.env.perf.distributed` with mode `600` only to the data, Gateway, and Mock
hosts. Copy only the generated `.env.loadgen` to the load-generator host; it
contains the private Gateway URL, a non-secret topology ID, and isolated
synthetic credentials. Do not print either file or include it in an evidence
bundle.

Start roles in dependency order. `--bootstrap` is first-run only and modifies
only the dedicated `gatelm_perf` database:

```bash
# Mock host
bash scripts/perf-distributed-up.sh --role mock

# Data host
bash scripts/perf-distributed-up.sh --role data --build --bootstrap

# Gateway host
bash scripts/perf-distributed-up.sh --role gateway --build
```

Run every preflight before load:

```bash
# Respective service hosts
bash scripts/perf-distributed-preflight.sh --role mock
bash scripts/perf-distributed-preflight.sh --role data
bash scripts/perf-distributed-preflight.sh --role gateway

# Load-generator host
bash scripts/perf-distributed-loadgen-preflight.sh
```

Each successful preflight writes one safe file under
`reports/perf/distributed-attestations/`. Before reconciliation, copy the
`loadgen`, `data`, and `mock` attestation files into that directory on the
Gateway host without overwriting `gateway.attestation.env`. Reconciliation
requires all four files, the expected private IPs, one topology ID, one Git SHA,
and four distinct machine hashes. The files contain no raw machine ID or
credential.

For each stage, run the 1-second Linux host sampler on all four hosts for a
window that covers warm-up, load, and log drain:

```bash
bash scripts/perf-distributed-monitor.sh \
  --role <loadgen|gateway|data|mock> \
  --duration-seconds 150 \
  --interval-seconds 1 \
  --output-dir /home/ubuntu/GateLM/reports/perf/hosts/<run-id>
```

Run `250`, `300`, `400`, then `500 RPS`; do not advance after a failed stage.
Use a two-minute duration for the formal 500 RPS claim:

```bash
GATELM_K6_TARGET_RPS=500 \
GATELM_K6_DURATION=2m \
GATELM_K6_PRE_ALLOCATED_VUS=750 \
GATELM_K6_MAX_VUS=1000 \
bash scripts/perf-loadgen-run.sh
```

Transfer the resulting bundle to the identical path on the Gateway host and
run distributed target-side reconciliation there:

```bash
GATELM_PERF_DISTRIBUTED_ENV_FILE=/home/ubuntu/GateLM/deploy/aws-triage/.env.perf.distributed \
bash scripts/perf-loadgen-reconcile.sh \
  /home/ubuntu/GateLM/reports/perf/loadgen/<bundle>
```

Distributed reconciliation rechecks the active Mock-only RuntimeSnapshot,
compares the load-generator and target Git SHAs, proves separate machine IDs,
queries the remote PostgreSQL Request Logs, and evaluates async logging deltas.
Only a clean `500 RPS` run of at least two minutes can produce
`capacityClaimEligible=true`.

After testing, preserve volumes and configuration while stopping role
containers. Then stop all four EC2 instances rather than terminating them:

```bash
bash scripts/perf-distributed-down.sh --role <gateway|data|mock>
aws ec2 stop-instances --region ap-northeast-2 --instance-ids <four-instance-ids>
```

For script integration checks on one development machine, set the load-generator
URL to `http://gateway-core:8080` and run:

```bash
GATELM_LOADGEN_EXECUTION_MODE=local_validation \
GATELM_LOADGEN_DOCKER_NETWORK=gatelm-aws-perf-internal \
GATELM_K6_TARGET_RPS=500 \
GATELM_K6_DURATION=30s \
bash scripts/perf-loadgen-run.sh
```

Target-side reconciliation can pass in `local_validation` mode, but capacity
eligibility remains false by design.

Stop the performance containers without deleting their volumes:

```bash
bash scripts/perf-down.sh
```

This setup isolates data and Provider credentials, but it does not isolate EC2
CPU, memory, or disk I/O. Results on the shared host are suitable for relative
regression checks, not production capacity claims. Use a dedicated load-test
host and target environment for formal capacity evidence.

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
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < migrations/002_drop_legacy_selected_routing_columns.sql
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < migrations/003_add_p0_invocation_log_ttft.sql
docker compose --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < migrations/004_add_p0_dashboard_rollup_indexes.sql
docker compose --env-file .env up -d --force-recreate ai-service control-plane-api gateway-core web chat-api chat-web
docker compose --env-file .env ps
```

## GitHub Actions CD Through OIDC And SSM

The public AWS triage host can deploy an approved `main` SHA without storing the
EC2 PEM file or long-lived AWS access keys in GitHub. This remains a single-host
triage deployment, not a highly available production architecture.

The workflow is intentionally gated:

```text
main push -> ci passes -> production approval -> GitHub OIDC -> AWS SSM
-> database backup -> sequential image build -> migrations -> cutover
-> local/public health checks
```

Create the AWS resources with CloudFormation using
`aws/github-actions-cd.template.json`. Set:

- `DeploymentInstanceId`: the public GateLM EC2 instance
- `CreateGitHubOidcProvider`: `true` only when the account does not already
  contain `token.actions.githubusercontent.com`
- the default GitHub organization, repository, and environment values unless
  the repository has moved

The stack creates an EC2 Systems Manager instance profile and a GitHub OIDC
deployment role. CloudFormation cannot attach the new instance profile to an
already-running EC2 instance, so attach the `Ec2SsmInstanceProfileName` stack
output through **EC2 -> Actions -> Security -> Modify IAM role**. Restart the
Snap-packaged agent after the role is attached:

```bash
sudo systemctl restart snap.amazon-ssm-agent.amazon-ssm-agent.service
```

Wait until the instance appears as `Online` in Systems Manager. Then create the
GitHub `production` environment, allow only `main`, require a reviewer, and set
these environment variables from the stack outputs and deployment URLs:

```text
AWS_REGION=ap-northeast-2
AWS_ROLE_ARN=<GitHubDeployRoleArn stack output>
AWS_INSTANCE_ID=<DeploymentInstanceId stack output>
GATELM_PUBLIC_URL=https://gatelm.co.kr
GATELM_CHAT_URL=https://chat.gatelm.co.kr
```

`.github/workflows/deploy-production.yml` runs only after a successful `ci`
push on `main`, or from a manual dispatch made on `main`. It rejects a stale SHA
when `origin/main` has moved while approval was pending. The OIDC role can send
only `AWS-RunShellScript` to the configured EC2 instance and can read or cancel
only the resulting SSM command.

The remote `scripts/deploy-main.sh` command keeps the existing containers alive
while it builds each image sequentially. Before migrations it stores a custom
PostgreSQL dump, the protected `.env`, the previous SHA, and protected rollback image tags
under `/home/ubuntu/gatelm-deploy-backups`. A pre-cutover failure leaves the old
containers running. A failed post-cutover health check restores the previous
application image tags and recreates the previous containers. Temporary rollback
tags are removed only after a successful deployment or successful rollback.

Database migrations are forward-only. Application rollback does not reverse a
schema migration; use the recorded PostgreSQL dump for a deliberate database
restore. Deployment logs remain on the instance under
`/home/ubuntu/gatelm-deploy-logs`.

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
