from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Sequence

from app.domain.ai_safety_cold_start import (
    ColdStartEvidenceError,
    build_repeated_cold_evidence,
    scan_cold_start_output,
)
from app.domain.ai_safety_promotion import (
    EvidenceBindingError,
    binding_from_verified_artifact_evidence,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_OUTPUT = REPO_ROOT / "reports" / "ai-safety-lab" / "pii-repeated-cold-evidence.json"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run fresh-process PII model preload and fixed-probe measurements."
    )
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--child-timeout-ms", type=int, default=60000)
    provenance = parser.add_mutually_exclusive_group(required=True)
    provenance.add_argument(
        "--artifact-verification",
        type=Path,
        help="Successful aggregate artifact-verifier output used to bind this measurement.",
    )
    provenance.add_argument(
        "--evidence-binding",
        type=Path,
        help="Direct binding input for isolated tests/evidence work only.",
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    return parser


def run(
    argv: Sequence[str] | None = None,
    *,
    child_executor=None,
) -> int:
    args = build_parser().parse_args(argv)
    executor = child_executor or execute_fresh_child
    try:
        evidence = build_repeated_cold_evidence(
            runs=args.runs,
            child_timeout_ms=args.child_timeout_ms,
            execute_child=executor,
            evidence_binding=_read_provenance(
                artifact_verification=args.artifact_verification,
                evidence_binding=args.evidence_binding,
            ),
        )
        scan_cold_start_output(evidence)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(
            json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    except (OSError, UnicodeError, json.JSONDecodeError, ColdStartEvidenceError) as exc:
        print(
            f"FAIL: cold-start evidence could not be generated ({type(exc).__name__})",
            file=sys.stderr,
        )
        return 2

    print(
        "pii repeated cold evidence completed: "
        f"runs={evidence['runs']}, "
        f"successful={evidence['successfulRuns']}, "
        f"failed={evidence['failedRuns']}"
    )
    return 0 if evidence["successfulRuns"] > 0 else 1


def execute_fresh_child(timeout_ms: int) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            [sys.executable, "-m", "app.services.ai_safety_cold_start_worker"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            timeout=timeout_ms / 1000,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {}
    if completed.returncode != 0:
        return {}
    try:
        value = json.loads(completed.stdout)
    except (json.JSONDecodeError, TypeError):
        return {}
    return value if isinstance(value, dict) else {}


def _read_provenance(
    *,
    artifact_verification: Path | None,
    evidence_binding: Path | None,
) -> dict[str, Any]:
    path = artifact_verification or evidence_binding
    if path is None:
        raise ColdStartEvidenceError("provenance evidence is required")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ColdStartEvidenceError("provenance evidence must be a JSON object")
    if artifact_verification is None:
        return value
    try:
        return binding_from_verified_artifact_evidence(value)
    except EvidenceBindingError as exc:
        raise ColdStartEvidenceError("artifact verification evidence is invalid") from exc


def main() -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
