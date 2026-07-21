from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from typing import Any, Sequence

from .encoder_runtime import (
    DEFAULT_ARTIFACT_ROOT,
    REPO_ROOT,
    E5EncoderRuntime,
    install_network_guard,
    load_runtime,
    write_json,
)
from .semantic_heads import train_and_evaluate_semantic_heads
from .canonical_dataset import (
    CANONICAL_DATASET,
    CANONICAL_ENCODER_MANIFEST,
    CANONICAL_MANIFEST,
    experiment_manifest,
    require_canonical_dataset,
)


TOOL_DIR = Path(__file__).resolve().parents[1]


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train the offline fixed four-head semantic difficulty artifact."
    )
    parser.add_argument("--dataset", type=Path, default=CANONICAL_DATASET)
    parser.add_argument("--manifest", type=Path, default=CANONICAL_MANIFEST)
    parser.add_argument("--artifact-root", type=Path, default=DEFAULT_ARTIFACT_ROOT)
    parser.add_argument("--encoder-manifest", type=Path, default=CANONICAL_ENCODER_MANIFEST)
    parser.add_argument("--artifact-version", required=True)
    parser.add_argument("--artifact-output", type=Path, required=True)
    parser.add_argument("--report-output", type=Path, required=True)
    parser.add_argument("--calibration-bins", type=int, default=10)
    parser.add_argument("--go", default=os.environ.get("GATELM_GO_EXECUTABLE", "go"))
    return parser.parse_args(argv)


def load_training_input(
    dataset: Path, manifest: Path, go_executable: str
) -> dict[str, Any]:
    canonical_manifest = require_canonical_dataset(dataset, manifest)
    command = [
        go_executable,
        "run",
        "./apps/gateway-core/cmd/difficulty-semantic-head-training-export",
        "-dataset",
        str(dataset.resolve()),
        "-manifest",
        str(manifest.resolve()),
    ]
    environment = dict(os.environ)
    environment.update(
        {
            "GOTELEMETRY": "off",
            "GOPROXY": "off",
            "GOSUMDB": "off",
        }
    )
    environment.setdefault("GOCACHE", str(REPO_ROOT / ".gocache"))
    completed = subprocess.run(
        command,
        cwd=REPO_ROOT,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
    )
    if completed.returncode != 0:
        detail = [line.strip() for line in completed.stderr.splitlines() if line.strip()]
        reason = next(
            (line for line in detail if not line.startswith("exit status ")),
            detail[-1] if detail else "exporter failed without a diagnostic",
        )
        raise ValueError(f"semantic head exporter rejected the dataset: {reason}")
    value = json.loads(completed.stdout)
    if value.get("schemaVersion") != "gatelm.difficulty-semantic-head-training-input.v1":
        raise ValueError("offline semantic head exporter returned an unsupported schema")
    identity = experiment_manifest(canonical_manifest)
    value.update(
        {
            "datasetVersion": identity["datasetVersion"],
            "datasetSha256": identity["datasetSha256"],
            "splitPolicyVersion": identity["splitPolicyVersion"],
            "splitSeed": identity["splitSeed"],
        }
    )
    return value


def load_selected_runtime(args: argparse.Namespace) -> tuple[E5EncoderRuntime, dict[str, Any]]:
    return load_runtime(
        manifest_path=args.encoder_manifest,
        artifact_root=args.artifact_root,
    )


def run(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    exported_input = load_training_input(args.dataset, args.manifest, args.go)
    install_network_guard()
    runtime, manifest = load_selected_runtime(args)
    artifact, report = train_and_evaluate_semantic_heads(
        exported_input,
        runtime.encode_one,
        artifact_version=args.artifact_version,
        encoder_version=manifest["bundleVersion"],
        encoder_hash=manifest["bundleSha256"],
        pooling_version=manifest["pooling"]["version"],
        calibration_bins=args.calibration_bins,
    )
    write_json(args.artifact_output, artifact)
    write_json(args.report_output, report)
    return artifact, report


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    run(args)
    print(f"wrote semantic head artifact to {args.artifact_output}")
    print(f"wrote aggregate semantic head report to {args.report_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
