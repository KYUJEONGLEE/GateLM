#!/usr/bin/env python3
"""Validate the v1 safety eval corpus without requiring Gateway or AI service."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
AI_SERVICE_DIR = ROOT / "apps" / "ai-service"
V1_DOCS_DIR = ROOT / "docs" / "v1.0.0"
SCHEMA_PATH = V1_DOCS_DIR / "schemas" / "safety-eval-corpus.schema.json"
CORPUS_PATH = V1_DOCS_DIR / "fixtures" / "safety-eval-corpus.jsonl"

sys.path.insert(0, str(AI_SERVICE_DIR))

from app.domain.safety_eval.corpus import load_corpus  # noqa: E402
from app.domain.safety_eval.report import scan_path_for_forbidden_sensitive_values  # noqa: E402
from app.schemas.safety_eval import SafetyEvalError  # noqa: E402


def main() -> int:
    try:
        scan_path_for_forbidden_sensitive_values(SCHEMA_PATH)
        scan_path_for_forbidden_sensitive_values(CORPUS_PATH)
        cases = load_corpus(CORPUS_PATH, SCHEMA_PATH)
    except SafetyEvalError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    print(f"v1 safety eval corpus smoke passed: {len(cases)} cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
