#!/usr/bin/env bash

set -Eeuo pipefail

GATEWAY_URL="${GATELM_TRAFFIC_GATEWAY_URL:-http://127.0.0.1:8800}"
MOCK_PROVIDER_URL="${GATELM_TRAFFIC_MOCK_PROVIDER_URL:-http://127.0.0.1:8090}"
MODEL="${GATELM_TRAFFIC_MODEL:-auto}"
REPORT_INTERVAL="${GATELM_TRAFFIC_REPORT_INTERVAL:-2}"
DURATION_SECONDS="${GATELM_TRAFFIC_DURATION_SECONDS:-0}"
MAX_PROJECTS=10
MAX_TOTAL_RPS=100

declare -a PROJECT_NAMES=()
declare -a API_KEYS=()
declare -a PROJECT_RATES=()

STATUS_FILE="$(mktemp "${TMPDIR:-/tmp}/gatelm-live-traffic.XXXXXX")"
STARTED_AT="$(date +%s)"
STOP_REQUESTED=false

log() {
  printf '[live-traffic] %s\n' "$*"
}

die() {
  printf '[live-traffic] ERROR: %s\n' "$*" >&2
  exit 1
}

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

cleanup() {
  if [[ "$STOP_REQUESTED" == "true" ]]; then
    return
  fi
  STOP_REQUESTED=true
  trap - EXIT INT TERM

  local child_pids
  child_pids="$(jobs -pr || true)"
  if [[ -n "$child_pids" ]]; then
    while IFS= read -r pid; do
      kill "$pid" >/dev/null 2>&1 || true
    done <<<"$child_pids"
    wait >/dev/null 2>&1 || true
  fi

  printf '\n'
  print_summary
  rm -f "$STATUS_FILE"
}

handle_signal() {
  cleanup
  exit 130
}

read_secret() {
  local prompt="$1"
  local result_variable="$2"
  local value
  read -r -s -p "$prompt" value
  printf '\n'
  [[ -n "$value" ]] || die "${prompt%: } is required."
  printf -v "$result_variable" '%s' "$value"
}

configure_projects() {
  if [[ -n "${GATELM_TRAFFIC_API_KEY:-}" ]]; then
    [[ -n "${GATELM_TRAFFIC_API_KEY:-}" ]] || die "GATELM_TRAFFIC_API_KEY is required."
    local configured_rate="${GATELM_TRAFFIC_RPS:-8}"
    is_positive_integer "$configured_rate" || die "GATELM_TRAFFIC_RPS must be a positive integer."
    PROJECT_NAMES+=("${GATELM_TRAFFIC_PROJECT_NAME:-Project 1}")
    API_KEYS+=("$GATELM_TRAFFIC_API_KEY")
    PROJECT_RATES+=("$configured_rate")
    return
  fi

  local project_count
  read -r -p "요청을 보낼 프로젝트 수 [1]: " project_count
  project_count="${project_count:-1}"
  is_positive_integer "$project_count" || die "프로젝트 수는 양의 정수여야 합니다."
  ((project_count <= MAX_PROJECTS)) || die "프로젝트는 최대 ${MAX_PROJECTS}개까지 실행할 수 있습니다."

  local index
  for ((index = 1; index <= project_count; index += 1)); do
    local default_name="Project ${index}"
    local name
    local api_key
    local default_rate
    local rate

    if ((index == 1)); then
      default_name="AskLake"
      default_rate=8
    else
      default_rate=2
    fi

    read -r -p "${index}번 프로젝트 이름 [${default_name}]: " name
    name="${name:-$default_name}"
    read_secret "${name} GateLM 통합 API Key: " api_key
    read -r -p "${name} 목표 RPS [${default_rate}]: " rate
    rate="${rate:-$default_rate}"
    is_positive_integer "$rate" || die "${name} RPS는 양의 정수여야 합니다."

    PROJECT_NAMES+=("$name")
    API_KEYS+=("$api_key")
    PROJECT_RATES+=("$rate")
  done
}

validate_configuration() {
  is_positive_integer "$REPORT_INTERVAL" || die "GATELM_TRAFFIC_REPORT_INTERVAL must be a positive integer."
  [[ "$DURATION_SECONDS" =~ ^[0-9]+$ ]] || die "GATELM_TRAFFIC_DURATION_SECONDS must be zero or a positive integer."

  local total_rps=0
  local rate
  for rate in "${PROJECT_RATES[@]}"; do
    total_rps=$((total_rps + rate))
  done
  ((total_rps <= MAX_TOTAL_RPS)) || die "전체 목표 RPS는 ${MAX_TOTAL_RPS}를 넘을 수 없습니다."
}

check_services() {
  curl --fail --silent --show-error --max-time 3 "${GATEWAY_URL}/healthz" >/dev/null \
    || die "Gateway가 ${GATEWAY_URL}에서 응답하지 않습니다. 서버 실행 스크립트를 먼저 실행하세요."
  curl --fail --silent --show-error --max-time 3 "${MOCK_PROVIDER_URL}/healthz" >/dev/null \
    || die "Mock provider가 ${MOCK_PROVIDER_URL}에서 응답하지 않습니다."
}

send_request() {
  local project_index="$1"
  local sequence="$2"
  local api_key="${API_KEYS[$project_index]}"
  local payload
  local status

  payload="$(
    printf '{"model":"%s","messages":[{"role":"user","content":"analytics live traffic %s-%s"}],"stream":false}' \
      "$MODEL" "$project_index" "$sequence"
  )"

  status="$(
    {
      printf 'header = "Authorization: Bearer %s"\n' "$api_key"
      printf 'header = "X-GateLM-Feature-Id: analytics-live-traffic"\n'
      printf 'header = "Content-Type: application/json"\n'
    } | curl \
      --config - \
      --silent \
      --show-error \
      --max-time 20 \
      --output /dev/null \
      --write-out '%{http_code}' \
      --data-binary "$payload" \
      "${GATEWAY_URL}/v1/chat/completions" \
      2>/dev/null
  )" || status="000"

  printf '%s|%s\n' "$project_index" "$status" >>"$STATUS_FILE"
}

print_summary() {
  local total
  total="$(wc -l <"$STATUS_FILE" | tr -d ' ')"
  log "누적 요청 ${total}건"

  local index
  for ((index = 0; index < ${#PROJECT_NAMES[@]}; index += 1)); do
    local counts
    counts="$(
      awk -F'|' -v target="$index" '
        $1 == target {
          total += 1
          if ($2 == "200") ok += 1
          else if ($2 == "429") limited += 1
          else failed += 1
        }
        END {
          printf "완료 %d · 200 %d · 429 %d · 기타 %d", total, ok, limited, failed
        }
      ' "$STATUS_FILE"
    )"
    log "${PROJECT_NAMES[$index]}: 목표 ${PROJECT_RATES[$index]} RPS · ${counts}"
  done
}

run_traffic() {
  local tick=0
  local sequence=0

  log "Gateway ${GATEWAY_URL}"
  log "Mock provider ${MOCK_PROVIDER_URL}"
  log "Ctrl+C로 종료합니다. 비밀값은 파일이나 출력에 기록하지 않습니다."
  printf '\n'

  while true; do
    local tick_started_at
    tick_started_at="$(date +%s)"
    local index

    for ((index = 0; index < ${#PROJECT_NAMES[@]}; index += 1)); do
      local request_index
      for ((request_index = 0; request_index < PROJECT_RATES[index]; request_index += 1)); do
        sequence=$((sequence + 1))
        send_request "$index" "$sequence" &
      done
    done

    tick=$((tick + 1))
    if ((tick % REPORT_INTERVAL == 0)); then
      print_summary
      printf '\n'
    fi

    if ((DURATION_SECONDS > 0)) && (( $(date +%s) - STARTED_AT >= DURATION_SECONDS )); then
      break
    fi

    local elapsed
    elapsed=$(( $(date +%s) - tick_started_at ))
    if ((elapsed < 1)); then
      sleep 1
    fi
  done

  wait >/dev/null 2>&1 || true
}

trap cleanup EXIT
trap handle_signal INT TERM
configure_projects
validate_configuration
check_services
run_traffic
