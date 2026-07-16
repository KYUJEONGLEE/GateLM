#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/selfhost/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

AZURE_PII_COMPOSE_FILE="${SELFHOST_DIR}/docker-compose.azure-pii.yml"

azure_pii_compose() {
  docker compose \
    --env-file "${SELFHOST_ENV_FILE}" \
    -f "${SELFHOST_COMPOSE_FILE}" \
    -f "${AZURE_PII_COMPOSE_FILE}" \
    "$@"
}

gatelm_log "Starting the Azure PII Korean coverage and latency smoke test."
gatelm_load_env
gatelm_check_docker
if ! azure_pii_compose config --quiet; then
  gatelm_fail "The combined self-host and Azure PII Compose configuration is invalid. No secret value was printed."
fi

target_p95_ms="${AZURE_PII_TARGET_P95_MS:-500}"
if [[ ! "${target_p95_ms}" =~ ^[1-9][0-9]*$ ]]; then
  gatelm_fail "AZURE_PII_TARGET_P95_MS must be a positive integer."
fi

gatelm_log "Checking model readiness, Korean entity coverage, masking, and warm p50/p95."
if ! azure_pii_compose exec -T \
  -e "AZURE_PII_TARGET_P95_MS=${target_p95_ms}" \
  ai-service python - <<'PY'
import json
import math
import os
import sys
import time
import urllib.request


MODEL_ID = "microsoft/azure-ai-language-pii"
MODEL_SOURCE = "azure_ai_language_pii"
EXPECTED = (
    ("person_name", "홍길동님이 상담을 요청했습니다."),
    ("organization_name", "담당 조직은 미래전자 주식회사입니다."),
    ("email", "연락 이메일은 privacy.probe@example.com입니다."),
)
ENDPOINT = "http://127.0.0.1:8001/internal/ai-safety/v1/detect/batch"


def post(payload):
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=5) as response:
        body = json.load(response)
    return body, max(0, round((time.perf_counter() - started) * 1000))


def percentile(values, ratio):
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * ratio) - 1)]


try:
    with urllib.request.urlopen("http://127.0.0.1:8001/readyz", timeout=5) as response:
        readiness = json.load(response)
    detector = readiness["dependencies"]["aiSafetyDetector"]
    primary = detector["primaryModel"]
    if readiness.get("status") != "ready" or detector.get("status") != "loaded":
        raise RuntimeError("detector_not_ready")
    if primary != {
        "modelId": MODEL_ID,
        "source": MODEL_SOURCE,
        "runtime": "azure_pii_container",
        "loadState": "loaded",
    }:
        raise RuntimeError("unexpected_model")
    if detector.get("additionalModels"):
        raise RuntimeError("unexpected_additional_model")

    payload = {
        "contractVersion": "ai-safety-detector-batch.v1",
        "mode": "enforce",
        "model": {"modelId": MODEL_ID, "runtime": "cpu_only"},
        "inputs": [
            {"itemIndex": index, "promptText": prompt, "locale": "ko-KR"}
            for index, (_, prompt) in enumerate(EXPECTED)
        ],
        "detectorConfig": {
            "detectorSet": "privacy-filter-default",
            "returnConfidence": False,
        },
    }
    body, _ = post(payload)
    summary = body.get("executionSummary", {})
    if body.get("model", {}).get("modelId") != MODEL_ID:
        raise RuntimeError("response_model_mismatch")
    if summary.get("executionMode") != "hybrid" or int(summary.get("modelInvocationCount", 0)) < 1:
        raise RuntimeError("model_not_invoked")

    serialized = json.dumps(body, ensure_ascii=False, sort_keys=True)
    results = body.get("results", [])
    if len(results) != len(EXPECTED):
        raise RuntimeError("invalid_result_count")
    missing = []
    for index, (expected_category, raw_probe) in enumerate(EXPECTED):
        item = results[index]
        model_categories = {
            detection.get("detectorType")
            for detection in item.get("detections", [])
            if detection.get("source") == MODEL_SOURCE
        }
        if expected_category not in model_categories:
            missing.append(expected_category)
        if raw_probe in serialized:
            raise RuntimeError("raw_probe_exposed")
    if missing:
        print(
            "Azure PII smoke failed: model coverage missing=" + ",".join(sorted(missing)),
            file=sys.stderr,
        )
        raise SystemExit(1)

    for _ in range(5):
        post(payload)
    latencies = [post(payload)[1] for _ in range(20)]
    p50_ms = percentile(latencies, 0.50)
    p95_ms = percentile(latencies, 0.95)
    target_ms = int(os.environ.get("AZURE_PII_TARGET_P95_MS", "500"))
    print(
        "Azure PII smoke result: "
        f"coverage=person_name,organization_name,email samples={len(latencies)} "
        f"p50_ms={p50_ms} p95_ms={p95_ms} target_p95_ms={target_ms}"
    )
    if p95_ms > target_ms:
        print("Azure PII smoke failed: warm p95 exceeded the deployment target.", file=sys.stderr)
        raise SystemExit(1)
except SystemExit:
    raise
except Exception:
    print(
        "Azure PII smoke failed; request text, response text, detected values, and credentials were not printed.",
        file=sys.stderr,
    )
    raise SystemExit(1) from None
PY
then
  gatelm_fail "Azure PII smoke failed. Do not enable production traffic until coverage and p95 pass."
fi

gatelm_log "Azure PII Korean coverage and latency smoke finished successfully."
