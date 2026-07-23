#!/usr/bin/env bash
#
# Start Tenant Chat from the current checkout while preserving the existing
# local PostgreSQL/Redis volumes and encrypted Provider data.
#
# This script intentionally does not use pnpm dev, prisma migrate dev/reset,
# docker compose down, or any volume-removal command.

set -Eeuo pipefail

PROJECT="gatelm-cache-manual"
SKIP_BUILD=false
CHAT_WEB_ORIGIN="http://chat.localhost:3002"

usage() {
  printf '%s\n' \
    'Usage: bash scripts/dev/tenant-chat-local-run.sh [options]' \
    '' \
    "Build and start Tenant Chat at $CHAT_WEB_ORIGIN using the existing" \
    'local Compose project and data volumes.' \
    '' \
    'Options:' \
    '  --project <name>  Existing Compose project. Default: gatelm-cache-manual' \
    '  --no-build        Recreate services from existing images.' \
    '  -h, --help        Show this help.' \
    '' \
    'Safety:' \
    '  - applies only prisma migrate deploy' \
    '  - never runs migrate dev/reset, down, or volume deletion' \
    '  - preserves the encryption key from the existing Control Plane container'
}

die() {
  printf 'tenant-chat local run: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

container_env() {
  local container="$1" name="$2" value
  value="$(
    docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" |
      awk -F= -v key="$name" '
        $1 == key {
          sub(/^[^=]*=/, "")
          print
          exit
        }
      '
  )"
  [[ -n "$value" ]] || die "missing existing local value: $container / $name"
  printf -v "$name" '%s' "$value"
  export "$name"
}

http_code() {
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --connect-timeout 3 --max-time 5 "$1" || true
}

wait_for_http_200() {
  local url="$1" label="$2" code=""
  for _ in {1..60}; do
    code="$(http_code "$url")"
    if [[ "$code" == "200" ]]; then
      return 0
    fi
    sleep 1
  done
  die "$label did not become ready (last HTTP status: ${code:-000})"
}

wait_for_chat_api() {
  for _ in {1..60}; do
    if "${compose[@]}" exec -T chat-api node -e \
      "fetch('http://127.0.0.1:3003/readyz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  die 'Chat API did not become ready'
}

wait_for_gateway() {
  for _ in {1..60}; do
    if "${compose[@]}" exec -T control-plane-api node -e \
      "fetch('http://gateway-core:8080/readyz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  die 'Gateway did not become ready'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      [[ $# -ge 2 ]] || die '--project requires a value'
      PROJECT="$2"
      shift 2
      ;;
    --no-build)
      SKIP_BUILD=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

for command in docker git curl awk; do
  require_command "$command"
done
docker info >/dev/null 2>&1 || die 'Docker Desktop is not ready'

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
WORKTREE="$(cd "$SCRIPT_DIR/../.." && git rev-parse --show-toplevel)" \
  || die 'cannot resolve the current Git worktree'
COMMON_GIT_DIR="$(git -C "$WORKTREE" rev-parse --path-format=absolute --git-common-dir)"
SHARED_ROOT="$(cd "$COMMON_GIT_DIR/.." && pwd)"

[[ -f "$SHARED_ROOT/.env" ]] || die "missing shared environment file: $SHARED_ROOT/.env"
[[ -d "$SHARED_ROOT/.secrets/tenant-chat" ]] \
  || die "missing shared Tenant Chat secrets: $SHARED_ROOT/.secrets/tenant-chat"
[[ -f "$WORKTREE/docker-compose.yml" ]] || die 'docker-compose.yml is missing'
[[ -f "$WORKTREE/scripts/dev/docker-compose.tenant-chat-execution.yml" ]] \
  || die 'Tenant Chat Compose overlay is missing'

CONTROL_PLANE_CONTAINER="${PROJECT}-control-plane-api-1"
docker inspect "$CONTROL_PLANE_CONTAINER" >/dev/null 2>&1 \
  || die "existing data project was not found: $CONTROL_PLANE_CONTAINER"

# Keep encrypted Provider rows decryptable after recreating the container.
container_env "$CONTROL_PLANE_CONTAINER" GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY
container_env "$CONTROL_PLANE_CONTAINER" GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY_VERSION
container_env "$CONTROL_PLANE_CONTAINER" TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN
export GATELM_TENANT_CHAT_LOCAL_SECRET_DIR="$SHARED_ROOT/.secrets/tenant-chat"

# The optional local E5 bundle is unrelated to Tenant Chat UI development.
if [[ ! -d "$WORKTREE/.tmp/gateway-e5-runtime-bundle" && -z "${GATELM_GATEWAY_DOCKERFILE:-}" ]]; then
  export GATELM_GATEWAY_DOCKERFILE=infra/docker/gateway-core.Dockerfile
  export GATELM_DIFFICULTY_E5_BUNDLE_DIR=apps/gateway-core
  export GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED=false
fi

compose=(
  docker compose -p "$PROJECT"
  --env-file "$SHARED_ROOT/.env"
  -f "$WORKTREE/docker-compose.yml"
  -f "$WORKTREE/scripts/dev/docker-compose.tenant-chat-execution.yml"
)

printf '[1/6] Validating the existing Compose project\n'
"${compose[@]}" config --quiet

printf '[2/6] Starting data services without recreating volumes\n'
"${compose[@]}" up -d postgres redis mock-provider

if [[ "$SKIP_BUILD" == false ]]; then
  printf '[3/6] Building Tenant Chat services from %s\n' "$WORKTREE"
  "${compose[@]}" build control-plane-api gateway-core chat-api chat-web
else
  printf '[3/6] Reusing existing images (--no-build)\n'
fi

printf '[4/6] Applying forward-only database migrations\n'
"${compose[@]}" run --rm --no-deps control-plane-api \
  node node_modules/prisma/build/index.js migrate deploy

printf '[5/6] Recreating application services without dependencies or data volumes\n'
"${compose[@]}" up -d --no-deps --force-recreate control-plane-api
wait_for_http_200 'http://127.0.0.1:3001/healthz' 'Control Plane'
"${compose[@]}" up -d --no-deps --force-recreate gateway-core
wait_for_gateway
"${compose[@]}" up -d --no-deps --force-recreate chat-api
wait_for_chat_api
"${compose[@]}" up -d --no-deps --force-recreate chat-web

printf '[6/6] Waiting for Tenant Chat Web\n'
wait_for_http_200 "$CHAT_WEB_ORIGIN" 'Tenant Chat Web'

printf '\nTenant Chat is ready: %s\n' "$CHAT_WEB_ORIGIN"
printf 'Existing PostgreSQL and Redis data were preserved.\n'
printf 'Logs: docker compose -p %s logs -f chat-web chat-api\n' "$PROJECT"
