#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

export GATELM_TRAFFIC_PRESET=three-project-demo
export GATELM_TRAFFIC_REPORT_INTERVAL="${GATELM_TRAFFIC_REPORT_INTERVAL:-1}"
export GATELM_TRAFFIC_DURATION_SECONDS="${GATELM_TRAFFIC_DURATION_SECONDS:-60}"

exec bash "${SCRIPT_DIR}/run-analytics-live-mock-traffic.sh"
