from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

from .training import train_from_vector_export


TOOL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = TOOL_DIR.parents[1]
DEFAULT_DATASET = REPO_ROOT / "docs/v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl"
DEFAULT_MANIFEST = REPO_ROOT / "docs/v2.1.0/fixtures/difficulty-training-split-manifest.v1.json"
DEFAULT_POLICY = TOOL_DIR / "training-policy.v1.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train the offline GateLM global difficulty model.")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--split-manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY)
    parser.add_argument("--artifact-version", required=True)
    parser.add_argument("--artifact-output", type=Path, required=True)
    parser.add_argument("--report-output", type=Path, required=True)
    return parser.parse_args()


def load_vector_export(dataset: Path, manifest: Path) -> dict:
    command = [
        "go",
        "run",
        "./apps/gateway-core/cmd/difficulty-training-vector-export",
        "-dataset",
        str(dataset.resolve()),
        "-split-manifest",
        str(manifest.resolve()),
        "-category-source",
        "actual",
    ]
    completed = subprocess.run(
        command,
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return json.loads(completed.stdout)


def main() -> int:
    args = parse_args()
    policy = json.loads(args.policy.read_text(encoding="utf-8"))
    vector_export = load_vector_export(args.dataset, args.split_manifest)
    artifact, report = train_from_vector_export(vector_export, policy, args.artifact_version)
    args.artifact_output.parent.mkdir(parents=True, exist_ok=True)
    args.report_output.parent.mkdir(parents=True, exist_ok=True)
    args.artifact_output.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.report_output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote candidate artifact to {args.artifact_output}")
    print(f"wrote aggregate training report to {args.report_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
