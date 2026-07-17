#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/selfhost/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

gatelm_log "Starting the optional PII model runtime smoke test."
gatelm_load_env

case "${AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED:-false}" in
  1|true|TRUE|yes|YES|on|ON) ;;
  *)
    gatelm_fail "PII model runtime is disabled. Enable and install the pinned models before running this smoke test."
    ;;
esac

gatelm_check_docker
gatelm_validate_compose

gatelm_log "Checking model readiness, one hybrid batch inference, and sanitized masking."
if ! gatelm_compose exec -T ai-service python - <<'PY'
import json
import sys
import urllib.request

try:
    with urllib.request.urlopen("http://127.0.0.1:8001/readyz", timeout=5) as response:
        readiness = json.load(response)
    if readiness.get("status") != "ready":
        raise RuntimeError
    detector = readiness["dependencies"]["aiSafetyDetector"]
    primary = detector["primaryModel"]
    additional = detector["additionalModels"]
    if detector.get("status") != "loaded" or detector.get("required") is not True:
        raise RuntimeError
    if detector.get("runtime") != "onnx":
        raise RuntimeError
    if detector.get("mlAllowedDetectorTypes") != ["phone_number", "secret"]:
        raise RuntimeError
    if primary != {
        "modelId": "openai/privacy-filter",
        "source": "openai_privacy_filter",
        "runtime": "onnx",
        "loadState": "loaded",
    }:
        raise RuntimeError
    if not isinstance(additional, list) or additional:
        raise RuntimeError

    probe_value = "runtime.probe@privacy.local"
    payload = {
        "contractVersion": "ai-safety-detector-batch.v1",
        "mode": "enforce",
        "inputs": [
            {
                "itemIndex": 0,
                "promptText": f"email: {probe_value}; secret reference alpha",
                "locale": "en-US",
            }
        ],
        "detectorConfig": {
            "detectorSet": "privacy-filter-default",
            "returnConfidence": False,
        },
    }
    request = urllib.request.Request(
        "http://127.0.0.1:8001/internal/ai-safety/v1/detect/batch",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)

    model = result.get("model", {})
    if (
        model.get("modelId") != "openai/privacy-filter"
        or model.get("runtime") != "cpu_only"
    ):
        raise RuntimeError
    summary = result["executionSummary"]
    if summary.get("executionMode") != "hybrid":
        raise RuntimeError
    if int(summary.get("modelInvocationCount", 0)) < 1:
        raise RuntimeError
    items = result.get("results", [])
    if len(items) != 1 or items[0].get("itemIndex") != 0:
        raise RuntimeError
    if probe_value in items[0].get("redactedPrompt", ""):
        raise RuntimeError
    if probe_value in items[0].get("logSafePrompt", ""):
        raise RuntimeError

    print(
        "PII model runtime smoke passed: "
        "models_loaded=1 model_set=openai_only "
        "ml_allowed=phone_number,secret execution_mode=hybrid masked=true"
    )
except Exception:
    print("PII model runtime smoke failed; no request or response content was printed.", file=sys.stderr)
    raise SystemExit(1) from None
PY
then
  gatelm_fail "PII model runtime smoke failed. Check ai-service readiness and sanitized service logs."
fi

gatelm_log "PII model runtime smoke finished successfully."
