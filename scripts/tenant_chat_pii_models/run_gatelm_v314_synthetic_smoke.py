"""Load the pinned GateLM v3.14 ONNX model and run sanitized synthetic probes."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
AI_SERVICE_ROOT = REPOSITORY_ROOT / "apps" / "ai-service"
sys.path.insert(0, str(AI_SERVICE_ROOT))

from app.adapters.safety.privacy_filter_adapter import (  # noqa: E402
    GATELM_KOELECTRA_PII_NER_MODEL,
    GATELM_KOELECTRA_PII_NER_LABEL_MAP,
    PrivacyFilterAdapter,
)
from app.domain.ai_safety_training.pii_error_curation import (  # noqa: E402
    TARGET_THRESHOLDS,
    TARGET_TYPES,
    load_regression_guard_fixture,
)


MODEL_SHA256 = "8a5cb146e84d413910a423d304e662a6aba9f69e83db129f5061d007a6de9381"
REGRESSION_GUARD_FIXTURE = (
    REPOSITORY_ROOT
    / "docs"
    / "ai-safety-lab"
    / "fixtures"
    / "pii-v0.1.1-regression-guards-v1.json"
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, required=True)
    args = parser.parse_args()
    model_dir = args.model_dir.resolve()
    model_path = model_dir / "model.onnx"
    if not model_path.is_file() or sha256(model_path) != MODEL_SHA256:
        raise SystemExit("v3.14 synthetic smoke failed: model checksum mismatch")

    adapter = PrivacyFilterAdapter(
        model_name=str(model_dir),
        source="gatelm_koelectra_pii_ner",
        label_map=GATELM_KOELECTRA_PII_NER_LABEL_MAP,
        min_confidence_by_detector_type=TARGET_THRESHOLDS,
        allowed_detector_types=TARGET_TYPES,
    )
    fixture = load_regression_guard_fixture(REGRESSION_GUARD_FIXTURE)
    results: list[dict[str, object]] = []
    for case in fixture["positiveCases"]:
        case_id = case["caseId"]
        text = case["text"]
        expected_type = case["expectedDetectorType"]
        expected_value = case["expectedValue"]
        detections = adapter.detect(text)
        matched = any(
            item.detector_type == expected_type
            and text[item.start:item.end] == expected_value
            for item in detections
        )
        results.append(
            {
                "caseId": case_id,
                "expectedDetectorType": expected_type,
                "actualDetectorTypes": sorted(
                    {item.detector_type for item in detections}
                ),
                "exactBoundaryDetected": matched,
            }
        )

    negative_results = []
    for case in fixture["negativeCases"]:
        case_id = case["caseId"]
        text = case["text"]
        forbidden_types = set(case["forbiddenDetectorTypes"])
        detections = adapter.detect(text)
        negative_results.append(
            {
                "caseId": case_id,
                "personNameDetected": any(
                    item.detector_type in forbidden_types for item in detections
                ),
            }
        )
    negative_passed = all(
        not item["personNameDetected"] for item in negative_results
    )
    passed = all(item["exactBoundaryDetected"] for item in results) and negative_passed
    output = {
        "reportVersion": "gatelm.pii-ner-v314-synthetic-smoke.v1",
        "modelId": GATELM_KOELECTRA_PII_NER_MODEL,
        "syntheticOnly": True,
        "rawPromptIncluded": False,
        "detectedValueIncluded": False,
        "passed": passed,
        "cases": results,
        "personNameFalsePositiveRegressions": negative_results,
        "singleSyllablePersonRegressionPassed": negative_passed,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True))
    raise SystemExit(0 if passed else 1)


if __name__ == "__main__":
    main()
