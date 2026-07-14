#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/perf-distributed-lib.sh
source "${SCRIPT_DIR}/perf-distributed-lib.sh"

output_path="${GATELM_LOADGEN_ENV_FILE:-${AWS_TRIAGE_DIR}/.env.loadgen}"
[[ ! -e "${output_path}" ]] || perf_fail "${output_path} already exists and was not overwritten."

dist_load_env
dist_validate_env

umask 077
cat > "${output_path}" <<EOF
GATELM_LOADGEN_GATEWAY_BASE_URL=$(dist_gateway_base_url)
GATELM_PERF_TOPOLOGY_ID=${GATELM_PERF_TOPOLOGY_ID}
GATELM_DEMO_API_KEY=${GATELM_DEMO_API_KEY}
GATELM_DEMO_APP_TOKEN=${GATELM_DEMO_APP_TOKEN}
EOF
chmod 600 "${output_path}"
perf_log "Created restricted load-generator environment at ${output_path}."
perf_log "Only the private Gateway URL, topology ID, and isolated synthetic credentials were written."
