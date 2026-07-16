"""Run three explicitly synthetic PII examples without printing input text."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle-root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    root = args.bundle_root.resolve()
    ai_service = root / "ai-service"
    models = root / "models"
    if not ai_service.is_dir():
        ai_service = root / "apps" / "ai-service"
        models = ai_service / ".cache" / "onnx"
    sys.path.insert(0, str(ai_service))

    from app.services.ai_safety_detector import AiSafetyDetectorService
    from app.schemas.safety import AiSafetyDetectRequest

    service = AiSafetyDetectorService(
        model_id=str(models / "openai--privacy-filter"),
        additional_model_ids=(
            str(models / "amoeba04--koelectra-small-v3-privacy-ner-quantized"),
        ),
        detector_runtime="onnx",
    )
    cases = (
        ("synthetic_email", "이메일: contact@synthetic.test", "email", "contact@synthetic.test"),
        ("synthetic_korean_name", "고객명: 홍길동에게 안내해줘", "person_name", "홍길동"),
        (
            "synthetic_organization",
            "회사명: Quorivex Research",
            "organization_name",
            "Quorivex Research",
        ),
    )
    results = []
    for case_id, text, expected_type, marker in cases:
        response = service.detect(
            AiSafetyDetectRequest(
                contractVersion="ai-safety-detector.v1",
                input={"promptText": text, "locale": "ko-KR"},
            )
        )
        categories = response.detector_summary.detector_categories
        results.append(
            {
                "caseId": case_id,
                "expectedDetectorType": expected_type,
                "actualDetectorTypes": categories,
                "detected": expected_type in categories,
                "redactionApplied": marker not in response.redacted_prompt,
            }
        )
    output = {
        "syntheticOnly": True,
        "rawPromptStored": False,
        "passed": all(item["detected"] and item["redactionApplied"] for item in results),
        "cases": results,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    raise SystemExit(0 if output["passed"] else 1)


if __name__ == "__main__":
    main()
