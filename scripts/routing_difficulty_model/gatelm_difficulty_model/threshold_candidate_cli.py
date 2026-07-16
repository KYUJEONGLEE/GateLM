from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Sequence

from .encoder_runtime import REPO_ROOT, write_json
from .threshold_candidate import derive_threshold_candidate


TOOL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_ARTIFACT = (
    TOOL_DIR
    / "artifacts/candidates/difficulty-candidate-c-118d.owner-approved-500.v3.json"
)
DEFAULT_FEASIBILITY = (
    REPO_ROOT / "docs/testing/difficulty-v3-calibration-threshold-feasibility.json"
)
DEFAULT_ARTIFACT_OUTPUT = (
    TOOL_DIR
    / "artifacts/candidates/difficulty-candidate-c-118d.owner-approved-500.v4.json"
)
DEFAULT_EVIDENCE_OUTPUT = (
    REPO_ROOT / "docs/testing/difficulty-v4-threshold-selection-evidence.json"
)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Freeze a threshold-only v4 candidate from calibration feasibility evidence."
    )
    parser.add_argument("--source-artifact", type=Path, default=DEFAULT_SOURCE_ARTIFACT)
    parser.add_argument("--feasibility-report", type=Path, default=DEFAULT_FEASIBILITY)
    parser.add_argument("--artifact-output", type=Path, default=DEFAULT_ARTIFACT_OUTPUT)
    parser.add_argument("--evidence-output", type=Path, default=DEFAULT_EVIDENCE_OUTPUT)
    parser.add_argument(
        "--artifact-version",
        default=(
            "difficulty-offline.owner-approved-500.single-request.2026-07-15."
            "42d-rule-vector-v1-plus-projection-plus-semantic-head-probabilities.v4"
        ),
    )
    parser.add_argument(
        "--bundle-version",
        default="difficulty-feature-bundle.owner-approved-500.single-request.2026-07-15.v4",
    )
    parser.add_argument("--threshold-policy-version", default="difficulty-threshold-v2")
    return parser.parse_args(argv)


def validate_output_paths(
    source_artifact: Path,
    artifact_output: Path,
    evidence_output: Path,
) -> None:
    source = source_artifact.resolve()
    artifact = artifact_output.resolve()
    evidence = evidence_output.resolve()
    if source in {artifact, evidence}:
        raise ValueError("threshold candidate outputs must not overwrite the v3 source artifact")
    if artifact == evidence:
        raise ValueError("threshold candidate artifact and evidence outputs must differ")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(args: argparse.Namespace) -> tuple[dict, dict]:
    validate_output_paths(args.source_artifact, args.artifact_output, args.evidence_output)
    source = json.loads(args.source_artifact.read_text(encoding="utf-8"))
    feasibility = json.loads(args.feasibility_report.read_text(encoding="utf-8"))
    candidate, evidence = derive_threshold_candidate(
        source,
        feasibility,
        artifact_version=args.artifact_version,
        bundle_version=args.bundle_version,
        threshold_policy_version=args.threshold_policy_version,
    )
    write_json(args.artifact_output, candidate)
    evidence["sourceArtifact"]["artifactFileSha256"] = _sha256(args.source_artifact)
    evidence["calibration"]["feasibilityReportFileSha256"] = _sha256(
        args.feasibility_report
    )
    evidence["candidateArtifact"]["artifactFileSha256"] = _sha256(args.artifact_output)
    write_json(args.evidence_output, evidence)
    return candidate, evidence


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    candidate, _ = run(args)
    print(
        f"wrote threshold-only candidate {candidate['artifactVersion']} "
        f"at threshold {candidate['threshold']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
