from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from typing import Any, Sequence

from .encoder_artifacts import (
    DEFAULT_ARTIFACT_ROOT,
    DEFAULT_CONFIG,
    REPO_ROOT,
    artifact_for_role,
    load_and_verify_manifest,
    load_candidate_config,
    read_json,
    sha256_file,
    write_json,
)
from .encoder_runtime import LocalEncoderRuntime, install_network_guard
from .semantic_heads import train_and_evaluate_semantic_heads


TOOL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ENCODER_LOCK = TOOL_DIR / "evidence/selected-encoder.provisional-v1.lock.json"


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train the offline fixed four-head semantic difficulty artifact."
    )
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--artifact-root", type=Path, default=DEFAULT_ARTIFACT_ROOT)
    parser.add_argument("--encoder-lock", type=Path, default=DEFAULT_ENCODER_LOCK)
    parser.add_argument("--artifact-version", required=True)
    parser.add_argument("--artifact-output", type=Path, required=True)
    parser.add_argument("--report-output", type=Path, required=True)
    parser.add_argument("--calibration-bins", type=int, default=10)
    parser.add_argument("--go", default=os.environ.get("GATELM_GO_EXECUTABLE", "go"))
    return parser.parse_args(argv)


def load_training_input(
    dataset: Path, manifest: Path, go_executable: str
) -> dict[str, Any]:
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
    return value


def _selected_candidate(config: dict[str, Any], lock: dict[str, Any]) -> dict[str, Any]:
    matches = [
        candidate
        for candidate in config["candidates"]
        if candidate["sourceModelId"] == lock.get("sourceModelId")
        and candidate["sourceRevision"] == lock.get("sourceRevision")
    ]
    if len(matches) != 1:
        raise ValueError("selected encoder lock does not identify one immutable candidate")
    return matches[0]


def load_selected_runtime(args: argparse.Namespace) -> tuple[LocalEncoderRuntime, dict[str, Any]]:
    lock = read_json(args.encoder_lock)
    if lock.get("schemaVersion") != "gatelm.difficulty-semantic-encoder-lock.v1":
        raise ValueError("unsupported selected semantic encoder lock schema")
    if lock.get("status") != "not_active_not_production_ready":
        raise ValueError("semantic encoder lock must remain offline and non-active")
    config = load_candidate_config(args.config)
    candidate = _selected_candidate(config, lock)
    variant = lock.get("quantization", {}).get("selectedVariant")
    if variant not in ("fp32", "dynamic_qint8"):
        raise ValueError("selected encoder lock has an unsupported runtime variant")
    model_role = "encoder_onnx_fp32" if variant == "fp32" else "encoder_onnx_dynamic_qint8"
    artifact_manifest, directory = load_and_verify_manifest(candidate, args.artifact_root, args.config)
    model_path = artifact_for_role(artifact_manifest, directory, model_role)
    expected_hash = lock.get("encoderSha256")
    if expected_hash != sha256_file(model_path):
        raise ValueError("selected encoder artifact does not match the immutable lock")
    cpu_profile = lock.get("supportedCpuProfile", {})
    runtime = LocalEncoderRuntime(
        candidate,
        directory,
        model_path,
        int(cpu_profile.get("intraOpThreads", 0)),
        int(cpu_profile.get("interOpThreads", 0)),
    )
    if runtime.native_dimension != int(lock.get("projection", {}).get("inputDimension", 0)):
        raise ValueError("selected encoder native output dimension does not match its lock")
    return runtime, lock


def run(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    exported_input = load_training_input(args.dataset, args.manifest, args.go)
    install_network_guard()
    runtime, lock = load_selected_runtime(args)
    encoder_hash = str(lock["encoderSha256"]).removeprefix("sha256:")
    artifact, report = train_and_evaluate_semantic_heads(
        exported_input,
        runtime.encode_raw,
        artifact_version=args.artifact_version,
        encoder_version=lock["encoderVersion"],
        encoder_hash=encoder_hash,
        pooling_version=lock["poolingVersion"],
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
