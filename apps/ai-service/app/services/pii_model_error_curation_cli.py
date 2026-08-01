from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

from app.adapters.safety.privacy_filter_adapter import (
    GATELM_KOELECTRA_PII_NER_LABEL_MAP,
    GATELM_KOELECTRA_PII_NER_SOURCE,
    PrivacyFilterAdapter,
)
from app.domain.ai_safety_eval.master_corpus import load_master_eval_corpus
from app.domain.ai_safety_training.pii_error_curation import (
    CURATION_REPORT_VERSION,
    MODEL_SHA256,
    MODEL_VERSION,
    TARGET_THRESHOLDS,
    TARGET_TYPES,
    build_review_template,
    evaluate_regression_guards,
    evaluate_screening_candidates,
    load_regression_guard_fixture,
    sha256_file,
)
from app.domain.safety_eval.report import scan_text_for_forbidden_sensitive_values
from app.services.ai_safety_master_eval_runner import (
    DEFAULT_CORPUS_PATH,
    load_screening_subset,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_SUBSET_PATH = (
    REPO_ROOT / "docs" / "ai-safety-lab" / "fixtures" / "pii-model-screening-subset-v1.json"
)
DEFAULT_GUARDS_PATH = (
    REPO_ROOT
    / "docs"
    / "ai-safety-lab"
    / "fixtures"
    / "pii-v0.1.1-regression-guards-v1.json"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Curate canonical v0.1.1 PII model mismatch candidates safely."
    )
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS_PATH)
    parser.add_argument("--subset-manifest", type=Path, default=DEFAULT_SUBSET_PATH)
    parser.add_argument("--regression-guards", type=Path, default=DEFAULT_GUARDS_PATH)
    parser.add_argument("--out", type=Path, required=True)
    return parser


def run(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        model_path = args.model_dir / "model.onnx"
        if not model_path.is_file() or sha256_file(model_path) != MODEL_SHA256:
            raise ValueError("canonical v0.1.1 model checksum mismatch")
        fixture = load_regression_guard_fixture(args.regression_guards)
        all_cases = load_master_eval_corpus(args.corpus)
        cases, subset_metadata = load_screening_subset(
            args.subset_manifest,
            corpus_path=args.corpus,
            cases=all_cases,
        )
        adapter = PrivacyFilterAdapter(
            model_name=str(args.model_dir),
            source=GATELM_KOELECTRA_PII_NER_SOURCE,
            label_map=GATELM_KOELECTRA_PII_NER_LABEL_MAP,
            runtime="onnx",
            min_confidence=0.90,
            min_confidence_by_detector_type=TARGET_THRESHOLDS,
            allowed_detector_types=TARGET_TYPES,
        )
        adapter.warmup()
        guards = evaluate_regression_guards(adapter, fixture)
        screening = evaluate_screening_candidates(adapter, cases)
        report = {
            "reportVersion": CURATION_REPORT_VERSION,
            "generatedAt": datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z"),
            "status": "review_required",
            "syntheticOnly": True,
            "productionPromotionEvidence": False,
            "model": {
                "version": MODEL_VERSION,
                "sha256": MODEL_SHA256,
                "thresholds": TARGET_THRESHOLDS,
            },
            "source": {
                "corpusSha256": subset_metadata["sourceCorpusSha256"],
                "subsetManifestSha256": sha256_file(args.subset_manifest),
                "caseCount": subset_metadata["caseCount"],
            },
            "regressionGuards": guards,
            "screening": screening,
            "humanReview": {
                "required": True,
                "status": "pending",
                "trainingEligible": False,
            },
            "contentSafety": {
                "rawTextIncluded": False,
                "detectedValueIncluded": False,
                "spanOrOffsetIncluded": False,
                "absoluteLocalPathIncluded": False,
            },
        }
        report_text = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        scan_text_for_forbidden_sensitive_values(report_text, "PII error curation report")
        report_sha256 = hashlib.sha256(report_text.encode("utf-8")).hexdigest()
        review = build_review_template(
            curation_report_sha256=report_sha256,
            screening=screening,
            corpus_sha256=subset_metadata["sourceCorpusSha256"],
            subset_manifest_sha256=sha256_file(args.subset_manifest),
        )
        review_text = json.dumps(review, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        scan_text_for_forbidden_sensitive_values(review_text, "PII error review template")
        args.out.mkdir(parents=True, exist_ok=True)
        report_path = args.out / "pii-v0.1.1-error-curation.json"
        review_path = args.out / "pii-v0.1.1-error-review.json"
        report_path.write_text(report_text, encoding="utf-8")
        review_path.write_text(review_text, encoding="utf-8")
    except (ImportError, OSError, UnicodeError, ValueError, RuntimeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2

    print(
        "PII error curation completed: "
        f"guardsPassed={guards['passed']}, "
        f"mismatchCandidates={screening['mismatchCandidateCount']}, "
        "humanReview=pending"
    )
    return 0 if guards["passed"] else 1


def main() -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
