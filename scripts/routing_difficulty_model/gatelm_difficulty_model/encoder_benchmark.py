from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import platform
import subprocess
import sys
from pathlib import Path
from typing import Any, Sequence

from .encoder_artifacts import (
    DEFAULT_ARTIFACT_ROOT,
    DEFAULT_CONFIG,
    IMMUTABLE_REVISION,
    TOOL_DIR,
    canonical_hash,
    candidate_by_id,
    load_and_verify_manifest,
    load_candidate_config,
    prepare_all,
    read_json,
    sha256_file,
    write_json,
)


REPO_ROOT = TOOL_DIR.parents[1]
DEFAULT_EVIDENCE_DIR = TOOL_DIR / "evidence"
DEFAULT_REPORT = DEFAULT_EVIDENCE_DIR / "difficulty-semantic-encoder-benchmark.windows-2026-07-14.json"
DEFAULT_LOCK = DEFAULT_EVIDENCE_DIR / "selected-encoder.provisional-v1.lock.json"
DEFAULT_PROJECTION = DEFAULT_EVIDENCE_DIR / "difficulty-projection.provisional-v1.bin"
DEFAULT_WORK_DIR = REPO_ROOT / ".tmp/difficulty-semantic-encoder-benchmark"
FORBIDDEN_REPORT_KEYS = {
    "instructionText",
    "redactedPrompt",
    "payloadText",
    "rawPrompt",
    "rawResponse",
    "embedding",
    "embeddings",
    "projectedEmbedding",
    "semanticHeads",
    "semanticHeadProbabilities",
    "headOutput",
    "assembledVector",
    "featureVector",
    "intermediateVector",
    "rawScore",
    "calibratedValue",
    "samples",
}


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare, run, or verify the offline semantic encoder benchmark.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "run", "verify"):
        child = subparsers.add_parser(name)
        child.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
        child.add_argument("--artifact-root", type=Path, default=DEFAULT_ARTIFACT_ROOT)
        if name in ("run", "verify"):
            child.add_argument("--report", type=Path, default=DEFAULT_REPORT)
            child.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
            child.add_argument("--projection", type=Path, default=DEFAULT_PROJECTION)
        if name == "run":
            child.add_argument("--work-dir", type=Path, default=DEFAULT_WORK_DIR)
            child.add_argument("--go", default=os.environ.get("GATELM_GO_EXECUTABLE", "go"))
    return parser.parse_args(argv)


def _command(args: Sequence[str]) -> str:
    completed = subprocess.run(
        list(args), cwd=REPO_ROOT, check=True, capture_output=True, text=True, encoding="utf-8"
    )
    return completed.stdout.strip()


def _worker_environment() -> dict[str, str]:
    environment = dict(os.environ)
    paths = [str(TOOL_DIR)]
    if environment.get("PYTHONPATH"):
        paths.append(environment["PYTHONPATH"])
    environment.update(
        {
            "PYTHONPATH": os.pathsep.join(paths),
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "HF_DATASETS_OFFLINE": "1",
            "TOKENIZERS_PARALLELISM": "false",
            "GOTELEMETRY": "off",
            "GOPROXY": "off",
            "GOSUMDB": "off",
            "OMP_NUM_THREADS": "4",
            "MKL_NUM_THREADS": "4",
            "OPENBLAS_NUM_THREADS": "4",
        }
    )
    environment.setdefault("GOCACHE", str(REPO_ROOT / ".gocache"))
    return environment


def _run_worker(
    config: Path,
    artifact_root: Path,
    work_dir: Path,
    candidate_id: str,
    variant: str,
    phase: str,
    go_executable: str,
    projection_dimension: int | None = None,
    projection_output: Path | None = None,
) -> dict[str, Any]:
    output = work_dir / f"{candidate_id}.{variant}.{phase}.json"
    command = [
        sys.executable,
        "-m",
        "gatelm_difficulty_model.encoder_worker",
        "--config",
        str(config.resolve()),
        "--artifact-root",
        str(artifact_root.resolve()),
        "--candidate",
        candidate_id,
        "--variant",
        variant,
        "--phase",
        phase,
        "--output",
        str(output.resolve()),
        "--go",
        go_executable,
    ]
    if projection_dimension is not None and projection_output is not None:
        command.extend(
            [
                "--projection-dimension",
                str(projection_dimension),
                "--projection-output",
                str(projection_output.resolve()),
            ]
        )
    completed = subprocess.run(
        command,
        cwd=REPO_ROOT,
        env=_worker_environment(),
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=1800,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            f"isolated worker failed for {candidate_id}/{variant}/{phase}: "
            f"{completed.stdout}{completed.stderr}"
        )
    return read_json(output)


def _dimension_evaluation(worker: dict[str, Any], dimension: int) -> dict[str, Any]:
    matches = [
        item
        for item in worker["projectionEvaluations"]
        if item["projectionDimension"] == dimension
    ]
    if len(matches) != 1:
        raise ValueError("projection dimension must resolve exactly once in worker evidence")
    return matches[0]


def choose_projection(fp32_worker: dict[str, Any], tolerance: float) -> dict[str, Any]:
    values = fp32_worker["projectionEvaluations"]
    lowest_regression = min(item["quality"]["overall"]["complexToSimpleCount"] for item in values)
    safety_eligible = [
        item
        for item in values
        if item["quality"]["overall"]["complexToSimpleCount"] == lowest_regression
    ]
    best_accuracy = max(item["quality"]["overall"]["accuracy"] for item in safety_eligible)
    accuracy_eligible = [
        item
        for item in safety_eligible
        if item["quality"]["overall"]["accuracy"] >= best_accuracy - tolerance
    ]
    return min(accuracy_eligible, key=lambda item: item["projectionDimension"])


def quantization_decision(
    fp32: dict[str, Any], quantized: dict[str, Any], policy: dict[str, Any]
) -> dict[str, Any]:
    fp_quality = fp32["quality"]
    q_quality = quantized["quality"]
    accuracy_drop = fp_quality["overall"]["accuracy"] - q_quality["overall"]["accuracy"]
    language_drop = fp_quality["minimumLanguageAccuracy"] - q_quality["minimumLanguageAccuracy"]
    regression_increase = (
        q_quality["overall"]["complexToSimpleCount"]
        - fp_quality["overall"]["complexToSimpleCount"]
    )
    p95_improvement = 1 - quantized["latency"]["p95Millis"] / fp32["latency"]["p95Millis"]
    rss_improvement = 1 - quantized["memory"]["steadyStateRssBytes"] / fp32["memory"]["steadyStateRssBytes"]
    size_improvement = 1 - quantized["runtimeArtifactSizeBytes"] / fp32["runtimeArtifactSizeBytes"]
    quality_passed = (
        accuracy_drop <= policy["maximumAccuracyDrop"]
        and language_drop <= policy["maximumMinimumLanguageAccuracyDrop"]
        and regression_increase <= policy["maximumComplexToSimpleCountIncrease"]
    )
    resource_passed = (
        p95_improvement >= policy["minimumP95LatencyImprovementRatio"]
        or rss_improvement >= policy["minimumSteadyRssReductionRatio"]
        or size_improvement >= policy["minimumArtifactSizeReductionRatio"]
    )
    return {
        "selected": bool(quality_passed and resource_passed),
        "qualityGatePassed": bool(quality_passed),
        "resourceGatePassed": bool(resource_passed),
        "accuracyDrop": round(accuracy_drop, 6),
        "minimumLanguageAccuracyDrop": round(language_drop, 6),
        "complexToSimpleCountIncrease": regression_increase,
        "p95LatencyImprovementRatio": round(p95_improvement, 6),
        "steadyRssReductionRatio": round(rss_improvement, 6),
        "artifactSizeReductionRatio": round(size_improvement, 6),
        "rule": "use_dynamic_qint8_only_when_quality_and_one_resource_gate_pass",
    }


def _runtime_artifacts(
    manifest: dict[str, Any], variant: str, projection: dict[str, Any]
) -> list[dict[str, Any]]:
    model_role = "encoder_onnx_fp32" if variant == "fp32" else "encoder_onnx_dynamic_qint8"
    roles = {
        model_role,
        "model_config",
        "sentence_transformer_config",
        "pooling_config",
        "dense_config",
        "dense_weights",
        "tokenizer_json",
        "tokenizer_config",
        "special_tokens",
        "tokenizer_model",
        "tokenizer_vocabulary",
    }
    artifacts = [
        {
            "role": item["role"],
            "relativePath": item["relativePath"],
            "sha256": item["sha256"],
            "sizeBytes": item["sizeBytes"],
        }
        for item in manifest["artifacts"]
        if item["role"] in roles
    ]
    artifacts.append(
        {
            "role": "projection",
            "relativePath": projection["relativePath"],
            "sha256": projection["sha256"],
            "sizeBytes": projection["sizeBytes"],
        }
    )
    return sorted(artifacts, key=lambda item: (item["role"], item["relativePath"]))


def _find_artifact(manifest: dict[str, Any], role: str) -> dict[str, Any]:
    matches = [item for item in manifest["artifacts"] if item["role"] == role]
    if len(matches) != 1:
        raise ValueError(f"artifact role {role!r} must occur exactly once")
    return matches[0]


def _git_provenance() -> dict[str, Any]:
    return {
        "sourceCommit": _command(["git", "rev-parse", "HEAD"]),
        "originDev": _command(["git", "rev-parse", "origin/dev"]),
        "branch": _command(["git", "branch", "--show-current"]),
        "workingTreeDirty": _command(["git", "status", "--porcelain"]) != "",
    }


def _forbidden_key_paths(value: Any, path: str = "$") -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            child = f"{path}.{key}"
            if key in FORBIDDEN_REPORT_KEYS:
                found.append(child)
            found.extend(_forbidden_key_paths(item, child))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found.extend(_forbidden_key_paths(item, f"{path}[{index}]"))
    return found


def projection_selection(evaluation: dict[str, Any]) -> dict[str, Any]:
    """Describe the projection produced by the selected runtime variant."""
    return {
        "selectedDimension": evaluation["projectionDimension"],
        "selectedProjectionVersion": evaluation["projectionVersion"],
        "selectedProjectionSha256": evaluation["projectionSha256"],
        "selectionSplit": "calibration",
    }


def run_benchmark(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    config = load_candidate_config(args.config)
    args.work_dir.mkdir(parents=True, exist_ok=True)
    manifests: dict[str, dict[str, Any]] = {}
    workers: dict[tuple[str, str], dict[str, Any]] = {}
    for candidate in config["candidates"]:
        candidate_id = candidate["candidateId"]
        manifest, _ = load_and_verify_manifest(candidate, args.artifact_root, args.config)
        manifests[candidate_id] = manifest
        for variant in ("fp32", "dynamic_qint8"):
            workers[(candidate_id, variant)] = _run_worker(
                args.config,
                args.artifact_root,
                args.work_dir,
                candidate_id,
                variant,
                "selection",
                args.go,
            )

    protocol = config["benchmarkProtocol"]
    candidate_decisions: list[dict[str, Any]] = []
    for candidate in config["candidates"]:
        candidate_id = candidate["candidateId"]
        fp_worker = workers[(candidate_id, "fp32")]
        q_worker = workers[(candidate_id, "dynamic_qint8")]
        chosen_projection = choose_projection(
            fp_worker, protocol["projection"]["dimensionAccuracyTolerance"]
        )
        dimension = chosen_projection["projectionDimension"]
        fp_evaluation = _dimension_evaluation(fp_worker, dimension)
        q_evaluation = _dimension_evaluation(q_worker, dimension)
        fp_evaluation = {**fp_evaluation, "runtimeArtifactSizeBytes": fp_worker["runtimeArtifactSizeBytes"]}
        q_evaluation = {**q_evaluation, "runtimeArtifactSizeBytes": q_worker["runtimeArtifactSizeBytes"]}
        quant = quantization_decision(fp_evaluation, q_evaluation, protocol["quantization"])
        selected_variant = "dynamic_qint8" if quant["selected"] else "fp32"
        selected_evaluation = q_evaluation if quant["selected"] else fp_evaluation
        candidate_decisions.append(
            {
                "candidateId": candidate_id,
                "sourceModelId": candidate["sourceModelId"],
                "sourceRevision": candidate["sourceRevision"],
                "nativeDimension": candidate["nativeDimension"],
                "projectionSelection": projection_selection(selected_evaluation),
                "quantizationDecision": quant,
                "selectedVariant": selected_variant,
                "selectedCalibration": selected_evaluation,
                "allProjectionAggregates": {
                    "fp32": fp_worker["projectionEvaluations"],
                    "dynamicQint8": q_worker["projectionEvaluations"],
                },
                "artifactManifests": {
                    "artifactSetSha256": manifests[candidate_id]["artifactSetSha256"],
                    "manifestSha256": manifests[candidate_id]["manifestSha256"],
                },
            }
        )

    def selection_key(item: dict[str, Any]) -> tuple[Any, ...]:
        value = item["selectedCalibration"]
        return (
            value["quality"]["overall"]["complexToSimpleCount"],
            -value["quality"]["overall"]["accuracy"],
            -value["quality"]["minimumLanguageAccuracy"],
            value["latency"]["p95Millis"],
            value["memory"]["peakRssBytes"],
            value["runtimeArtifactSizeBytes"],
            item["candidateId"],
        )

    selected = min(candidate_decisions, key=selection_key)
    selected_id = selected["candidateId"]
    selected_variant = selected["selectedVariant"]
    selected_dimension = selected["projectionSelection"]["selectedDimension"]
    final = _run_worker(
        args.config,
        args.artifact_root,
        args.work_dir,
        selected_id,
        selected_variant,
        "final",
        args.go,
        selected_dimension,
        args.projection,
    )
    final_evaluation = _dimension_evaluation(final, selected_dimension)
    if final_evaluation["projectionSha256"] != selected["projectionSelection"]["selectedProjectionSha256"]:
        raise ValueError("selected projection did not replay to the same artifact hash")
    if final["projectionArtifact"]["sha256"] != final_evaluation["projectionSha256"]:
        raise ValueError("written projection artifact hash does not match final evaluation")
    baseline = final["ruleBaseline"]
    holdout = final_evaluation["quality"]
    holdout_gate = (
        holdout["overall"]["complexToSimpleCount"]
        <= baseline["overall"]["complexToSimpleCount"]
    )
    measured_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    provenance = _git_provenance()
    selected_candidate = candidate_by_id(config, selected_id)
    selected_manifest = manifests[selected_id]
    report: dict[str, Any] = {
        "schemaVersion": "gatelm.difficulty-semantic-encoder-benchmark-report.v1",
        "reportId": "difficulty-semantic-encoder-benchmark-2026-07-14-windows-cpu-v1",
        "status": "provisional_offline_selection",
        "measuredAt": measured_at,
        "featureProposal": "difficulty-feature-vector.v2",
        "activeRuntimeChanged": False,
        "gatewayHotPathChanged": False,
        "externalEmbeddingApiUsed": False,
        "provenance": provenance,
        "dataset": config["dataset"],
        "benchmarkProtocol": protocol,
        "candidateAggregates": candidate_decisions,
        "selected": {
            "candidateId": selected_id,
            "sourceModelId": selected_candidate["sourceModelId"],
            "sourceRevision": selected_candidate["sourceRevision"],
            "variant": selected_variant,
            "projectionDimension": selected_dimension,
            "selectionBasis": "calibration_only_before_single_holdout_evaluation",
        },
        "holdout": {
            "evaluatedOnceAfterSelection": True,
            "families": final["evaluationFamilies"],
            "records": final["evaluationSamples"],
            "selectedCandidate": holdout,
            "currentRuleBaseline": baseline,
            "complexToSimpleSafetyGatePassed": holdout_gate,
            "promotionEligible": False,
        },
        "runtimeEnvironment": {
            **final["environment"],
            "dependencyVersions": selected_manifest["dependencyVersions"],
            "onnxExecutionProvider": "CPUExecutionProvider",
            "networkDisabled": final["networkDisabled"],
        },
        "limitations": [
            "The 500-record corpus is synthetic training-tooling smoke with trainingEligible=false.",
            "There are zero approved human-reviewed prompt families.",
            "The selected encoder is provisional offline evidence only and cannot change the active routing contract.",
            "The Windows CPU measurements apply only to the recorded hardware, thread, affinity, and library profile.",
            "A clean committed source tree was not required; the exact HEAD and dirty-worktree state are recorded.",
        ],
        "requiredBeforeGatewayIntegration": [
            "Approve minimum human-reviewed family coverage and create an eligible family-disjoint dataset.",
            "Repeat candidate selection and untouched holdout evaluation on that approved dataset.",
            "Approve a separate active routing contract change and runtime implementation review.",
            "Re-run platform CPU compatibility and supply-chain review for the intended deployment targets.",
        ],
    }
    forbidden = _forbidden_key_paths(report)
    if forbidden:
        raise ValueError(f"benchmark report contains forbidden data fields: {forbidden}")
    report["reportSha256"] = canonical_hash(report)
    write_json(args.report, report)

    runtime_files = _runtime_artifacts(
        selected_manifest, selected_variant, final["projectionArtifact"]
    )
    tokenizer_files = [item for item in runtime_files if item["role"].startswith("tokenizer") or item["role"] == "special_tokens"]
    encoder_role = "encoder_onnx_fp32" if selected_variant == "fp32" else "encoder_onnx_dynamic_qint8"
    encoder_file = next(item for item in runtime_files if item["role"] == encoder_role)
    pooling_material = {
        "version": protocol["pooling"]["version"],
        "config": protocol["pooling"],
        "declaredCandidatePooling": selected_candidate["poolingKind"],
        "dense": selected_candidate.get("dense"),
    }
    lock: dict[str, Any] = {
        "schemaVersion": "gatelm.difficulty-semantic-encoder-lock.v1",
        "selection": "provisional_offline_selection",
        "status": "not_active_not_production_ready",
        "featureProposal": "difficulty-feature-vector.v2",
        "sourceModelId": selected_candidate["sourceModelId"],
        "sourceRevision": selected_candidate["sourceRevision"],
        "architecture": selected_candidate["architecture"],
        "weightVersion": selected_candidate["weightVersion"],
        "tokenizerVersion": selected_candidate["tokenizerVersion"],
        "tokenizerArtifactSetSha256": canonical_hash(tokenizer_files),
        "encoderVersion": selected_candidate["encoderVersion"],
        "encoderSha256": encoder_file["sha256"],
        "runtimeArtifactFiles": runtime_files,
        "canonicalArtifactSetSha256": canonical_hash(runtime_files),
        "canonicalSerialization": "UTF-8 JSON, keys sorted lexicographically, compact separators, finite numbers, hash field omitted from its own digest",
        "poolingVersion": protocol["pooling"]["version"],
        "poolingSha256": canonical_hash(pooling_material),
        "pooling": pooling_material,
        "maximumTokenLength": protocol["maximumTokenLength"],
        "truncation": protocol["truncation"],
        "l2Normalization": protocol["normalization"],
        "projection": {
            "version": final_evaluation["projectionVersion"],
            "dimension": selected_dimension,
            "inputDimension": selected_candidate["nativeDimension"],
            "sha256": final["projectionArtifact"]["sha256"],
            "relativePath": final["projectionArtifact"]["relativePath"],
            "sizeBytes": final["projectionArtifact"]["sizeBytes"],
            "fitSplit": "train",
            "seed": protocol["randomSeed"],
            "dtype": "float32",
        },
        "quantization": {
            **protocol["quantization"],
            "selected": selected_variant == "dynamic_qint8",
            "selectedVariant": selected_variant,
            "artifactSha256": encoder_file["sha256"] if selected_variant == "dynamic_qint8" else None,
        },
        "inferenceDtype": selected_candidate["inferenceDtype"],
        "localInferenceRuntime": {
            "name": "onnxruntime",
            "version": selected_manifest["dependencyVersions"]["onnxruntime"],
            "executionProvider": "CPUExecutionProvider",
            "libraryVersions": selected_manifest["dependencyVersions"],
        },
        "outputDimension": selected_dimension,
        "outputDtype": "float32",
        "supportedCpuProfile": {
            "os": final["environment"]["platform"],
            "architecture": final["environment"]["machine"],
            "processor": final["environment"]["processor"],
            "processAffinity": final["environment"]["processAffinity"],
            "intraOpThreads": protocol["intraOpThreads"],
            "interOpThreads": protocol["interOpThreads"],
            "affinityPolicy": protocol["affinityPolicy"],
        },
        "benchmarkReportId": report["reportId"],
        "benchmarkReportSha256": report["reportSha256"],
        "license": selected_candidate["license"],
        "weightProvenance": selected_candidate["weightProvenance"],
        "modelCard": selected_candidate["modelCard"],
        "createdAt": measured_at,
        "sourceCommit": provenance["sourceCommit"],
        "sourceTreeDirty": provenance["workingTreeDirty"],
        "promotionEligible": False,
    }
    lock["bundleSha256"] = canonical_hash(lock)
    write_json(args.lock, lock)
    verify_evidence(args.config, args.artifact_root, args.report, args.lock, args.projection)
    return report, lock


def verify_evidence(
    config_path: Path,
    artifact_root: Path,
    report_path: Path,
    lock_path: Path,
    projection_path: Path,
) -> None:
    config = load_candidate_config(config_path)
    report = read_json(report_path)
    lock = read_json(lock_path)
    if report.get("schemaVersion") != "gatelm.difficulty-semantic-encoder-benchmark-report.v1":
        raise ValueError("unsupported semantic encoder report schema")
    expected_report_hash = report.pop("reportSha256", None)
    actual_report_hash = canonical_hash(report)
    report["reportSha256"] = expected_report_hash
    if expected_report_hash != actual_report_hash:
        raise ValueError("semantic encoder benchmark report hash mismatch")
    forbidden = _forbidden_key_paths(report)
    if forbidden:
        raise ValueError(f"semantic encoder report contains forbidden fields: {forbidden}")
    if lock.get("schemaVersion") != "gatelm.difficulty-semantic-encoder-lock.v1":
        raise ValueError("unsupported semantic encoder lock schema")
    expected_bundle_hash = lock.pop("bundleSha256", None)
    actual_bundle_hash = canonical_hash(lock)
    lock["bundleSha256"] = expected_bundle_hash
    if expected_bundle_hash != actual_bundle_hash:
        raise ValueError("semantic encoder bundle hash mismatch")
    if not IMMUTABLE_REVISION.fullmatch(lock.get("sourceRevision", "")):
        raise ValueError("semantic encoder lock contains a mutable revision")
    if lock.get("benchmarkReportSha256") != expected_report_hash:
        raise ValueError("semantic encoder lock points to the wrong benchmark report")
    candidate = candidate_by_id(config, report["selected"]["candidateId"])
    if candidate["sourceRevision"] != lock["sourceRevision"]:
        raise ValueError("semantic encoder lock revision differs from candidate config")
    manifest, _ = load_and_verify_manifest(candidate, artifact_root, config_path)
    manifest_hashes = {
        (item["role"], item["relativePath"]): (item["sha256"], item["sizeBytes"])
        for item in manifest["artifacts"]
    }
    for item in lock["runtimeArtifactFiles"]:
        if item["role"] == "projection":
            continue
        if manifest_hashes.get((item["role"], item["relativePath"])) != (
            item["sha256"],
            item["sizeBytes"],
        ):
            raise ValueError("semantic encoder lock contains an unknown or mismatched artifact")
    if not projection_path.is_file() or sha256_file(projection_path) != lock["projection"]["sha256"]:
        raise ValueError("semantic encoder projection artifact hash mismatch")
    runtime_files = lock["runtimeArtifactFiles"]
    if canonical_hash(runtime_files) != lock["canonicalArtifactSetSha256"]:
        raise ValueError("semantic encoder canonical artifact set hash mismatch")
    if lock["selection"] != "provisional_offline_selection" or lock["promotionEligible"] is not False:
        raise ValueError("semantic encoder evidence must remain provisional and not promotion eligible")


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command == "prepare":
        manifests = prepare_all(args.config, args.artifact_root)
        for manifest in manifests:
            print(
                f"prepared {manifest['candidateId']} {manifest['sourceRevision']} "
                f"{manifest['artifactSetSha256']}"
            )
        return 0
    if args.command == "run":
        report, lock = run_benchmark(args)
        print(f"selected {lock['sourceModelId']} at {lock['sourceRevision']}")
        print(f"report {report['reportSha256']}")
        print(f"bundle {lock['bundleSha256']}")
        return 0
    verify_evidence(args.config, args.artifact_root, args.report, args.lock, args.projection)
    print("semantic encoder evidence verification passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
