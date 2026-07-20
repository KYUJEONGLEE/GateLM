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
    PrivacyFilterAdapter,
)


MODEL_SHA256 = "8a5cb146e84d413910a423d304e662a6aba9f69e83db129f5061d007a6de9381"
TARGET_TYPES = frozenset(
    {
        "email",
        "organization_name",
        "person_name",
        "phone_number",
        "postal_address",
        "resident_registration_number",
    }
)
THRESHOLDS = {
    "email": 0.99,
    "organization_name": 0.90,
    "person_name": 0.90,
    "phone_number": 0.99,
    "postal_address": 0.90,
    "resident_registration_number": 0.99,
}


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
        min_confidence_by_detector_type=THRESHOLDS,
        allowed_detector_types=TARGET_TYPES,
    )
    cases = (
        ("email", "문의 이메일은 demo.user@example.com입니다.", "email", "demo.user@example.com"),
        ("organization", "소속 기관은 네오테크솔루션입니다.", "organization_name", "네오테크솔루션"),
        ("person", "담당자 이름은 김민수입니다.", "person_name", "김민수"),
        ("phone", "연락처는 010-1234-5678입니다.", "phone_number", "010-1234-5678"),
        (
            "postal_address",
            "배송지는 서울특별시 강남구 테헤란로 123입니다.",
            "postal_address",
            "서울특별시 강남구 테헤란로 123",
        ),
        (
            "resident_registration_number",
            "확인용 주민등록번호는 900101-1234567입니다.",
            "resident_registration_number",
            "900101-1234567",
        ),
    )
    results: list[dict[str, object]] = []
    for case_id, text, expected_type, expected_value in cases:
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

    negative_text = "너의이름은?"
    negative_detections = adapter.detect(negative_text)
    negative_passed = all(
        item.detector_type != "person_name" for item in negative_detections
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
        "singleSyllablePersonRegressionPassed": negative_passed,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True))
    raise SystemExit(0 if passed else 1)


if __name__ == "__main__":
    main()
