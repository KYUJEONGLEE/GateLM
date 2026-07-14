from __future__ import annotations

import argparse
import json
import math
import os
import platform
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Sequence

from .encoder_artifacts import (
    DEFAULT_ARTIFACT_ROOT,
    DEFAULT_CONFIG,
    artifact_for_role,
    candidate_by_id,
    load_and_verify_manifest,
    load_candidate_config,
    write_json,
)
from .encoder_runtime import (
    LocalEncoderRuntime,
    ProjectionArtifact,
    fit_projection,
    install_network_guard,
    latency_bucket_texts,
)


PROCESS_STARTED_NS = time.perf_counter_ns()
TOOL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = TOOL_DIR.parents[1]


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run one isolated local semantic encoder benchmark worker.")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--artifact-root", type=Path, default=DEFAULT_ARTIFACT_ROOT)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--variant", choices=("fp32", "dynamic_qint8"), required=True)
    parser.add_argument("--phase", choices=("selection", "final"), required=True)
    parser.add_argument("--projection-dimension", type=int)
    parser.add_argument("--projection-output", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--go", default=os.environ.get("GATELM_GO_EXECUTABLE", "go"))
    return parser.parse_args(argv)


def _offline_environment() -> dict[str, str]:
    environment = dict(os.environ)
    environment.update(
        {
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "HF_DATASETS_OFFLINE": "1",
            "GOTELEMETRY": "off",
            "GOPROXY": "off",
            "GOSUMDB": "off",
            "TOKENIZERS_PARALLELISM": "false",
            "OMP_NUM_THREADS": "4",
            "MKL_NUM_THREADS": "4",
            "OPENBLAS_NUM_THREADS": "4",
        }
    )
    environment.setdefault("GOCACHE", str(REPO_ROOT / ".gocache"))
    return environment


def load_benchmark_input(go_executable: str) -> dict[str, Any]:
    command = [
        go_executable,
        "run",
        "./apps/gateway-core/cmd/difficulty-semantic-benchmark-export",
    ]
    completed = subprocess.run(
        command,
        cwd=REPO_ROOT,
        env=_offline_environment(),
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
    )
    value = json.loads(completed.stdout)
    if value.get("schemaVersion") != "gatelm.difficulty-semantic-benchmark-input.v1":
        raise ValueError("offline semantic input exporter returned an unsupported schema")
    return value


def nearest_rank(values: Sequence[float], percentile: float) -> float:
    if not values:
        raise ValueError("cannot calculate a percentile from an empty sequence")
    ordered = sorted(float(value) for value in values)
    rank = max(1, math.ceil(percentile * len(ordered)))
    return ordered[rank - 1]


def rounded(value: float, digits: int = 6) -> float:
    return round(float(value), digits)


def _accuracy(labels: Sequence[int], predictions: Sequence[int]) -> dict[str, Any]:
    if len(labels) != len(predictions) or not labels:
        raise ValueError("quality metrics require aligned non-empty labels and predictions")
    correct = sum(int(label == prediction) for label, prediction in zip(labels, predictions))
    complex_expected = sum(int(label == 1) for label in labels)
    complex_to_simple = sum(
        int(label == 1 and prediction == 0) for label, prediction in zip(labels, predictions)
    )
    simple_expected = len(labels) - complex_expected
    simple_to_complex = sum(
        int(label == 0 and prediction == 1) for label, prediction in zip(labels, predictions)
    )
    return {
        "total": len(labels),
        "correct": correct,
        "incorrect": len(labels) - correct,
        "accuracy": rounded(correct / len(labels)),
        "complexExpected": complex_expected,
        "complexToSimpleCount": complex_to_simple,
        "complexToSimpleRate": rounded(complex_to_simple / complex_expected)
        if complex_expected
        else 0.0,
        "simpleExpected": simple_expected,
        "simpleToComplexCount": simple_to_complex,
        "simpleToComplexRate": rounded(simple_to_complex / simple_expected)
        if simple_expected
        else 0.0,
    }


def _length_bucket(token_count: int) -> str:
    if token_count <= 32:
        return "short"
    if token_count <= 96:
        return "medium"
    if token_count <= 126:
        return "near_max"
    return "over_max_head_tail_truncated"


def aggregate_quality(
    samples: Sequence[dict[str, Any]], predictions: Sequence[int], token_counts: Sequence[int]
) -> dict[str, Any]:
    labels = [int(sample["label"]) for sample in samples]
    result = {"overall": _accuracy(labels, predictions)}
    for output_name, field in (
        ("byCategory", "expectedCategory"),
        ("byLanguage", "language"),
    ):
        groups: dict[str, Any] = {}
        for value in sorted({str(sample[field]) for sample in samples}):
            indices = [index for index, sample in enumerate(samples) if sample[field] == value]
            groups[value] = _accuracy(
                [labels[index] for index in indices],
                [predictions[index] for index in indices],
            )
        result[output_name] = groups
    length_groups: dict[str, Any] = {}
    for bucket in ("short", "medium", "near_max", "over_max_head_tail_truncated"):
        indices = [index for index, count in enumerate(token_counts) if _length_bucket(count) == bucket]
        if indices:
            length_groups[bucket] = _accuracy(
                [labels[index] for index in indices],
                [predictions[index] for index in indices],
            )
    result["byLength"] = length_groups
    result["minimumLanguageAccuracy"] = min(
        item["accuracy"] for item in result["byLanguage"].values()
    )
    return result


def fit_probe(
    projection: ProjectionArtifact,
    train_values: Any,
    train_labels: Any,
    evaluation_values: Any,
) -> Any:
    from sklearn.linear_model import LogisticRegression

    train_projected = projection.transform(train_values)
    evaluation_projected = projection.transform(evaluation_values)
    classifier = LogisticRegression(
        solver="liblinear",
        penalty="l2",
        C=1.0,
        max_iter=1000,
        random_state=20260714,
    )
    classifier.fit(train_projected, train_labels)
    return classifier.predict(evaluation_projected)


def current_rss() -> tuple[int, int, str]:
    import psutil

    process = psutil.Process()
    info = process.memory_info()
    rss = int(info.rss)
    peak = int(getattr(info, "peak_wset", rss))
    method = "psutil.memory_info.rss+peak_wset" if hasattr(info, "peak_wset") else "psutil.memory_info.rss_snapshot"
    return rss, peak, method


def runtime_artifact_size(manifest: dict[str, Any], variant: str) -> int:
    model_role = "encoder_onnx_fp32" if variant == "fp32" else "encoder_onnx_dynamic_qint8"
    supporting_roles = {
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
    return sum(
        int(item["sizeBytes"])
        for item in manifest["artifacts"]
        if item["role"] == model_role or item["role"] in supporting_roles
    )


def measure_latency(
    runtime: LocalEncoderRuntime,
    projection: ProjectionArtifact,
    protocol: dict[str, Any],
) -> dict[str, Any]:
    buckets = latency_bucket_texts(runtime)
    warmups = int(protocol["warmupIterations"])
    measured = int(protocol["measuredIterations"])
    repetitions = int(protocol["repetitions"])
    all_values: list[float] = []
    bucket_results: dict[str, Any] = {}
    for name, text, content_tokens, truncated in buckets:
        repetition_p95: list[float] = []
        bucket_values: list[float] = []
        for _ in range(repetitions):
            for _ in range(warmups):
                runtime.encode(text, projection)
            values: list[float] = []
            for _ in range(measured):
                started = time.perf_counter_ns()
                runtime.encode(text, projection)
                values.append((time.perf_counter_ns() - started) / 1_000_000)
            bucket_values.extend(values)
            repetition_p95.append(nearest_rank(values, 0.95))
        all_values.extend(bucket_values)
        mean_p95 = sum(repetition_p95) / len(repetition_p95)
        variance = sum((value - mean_p95) ** 2 for value in repetition_p95) / len(repetition_p95)
        bucket_results[name] = {
            "contentTokenCount": content_tokens,
            "truncated": truncated,
            "measurements": len(bucket_values),
            "p50Millis": rounded(nearest_rank(bucket_values, 0.50)),
            "p95Millis": rounded(nearest_rank(bucket_values, 0.95)),
            "repetitionP95Millis": [rounded(value) for value in repetition_p95],
            "repetitionP95CoefficientOfVariation": rounded(
                math.sqrt(variance) / mean_p95 if mean_p95 else 0.0
            ),
        }
    return {
        "method": "perf_counter_ns_end_to_end_tokenizer_encoder_pooling_projection_l2",
        "percentileMethod": "nearest_rank",
        "measurements": len(all_values),
        "p50Millis": rounded(nearest_rank(all_values, 0.50)),
        "p95Millis": rounded(nearest_rank(all_values, 0.95)),
        "byLengthBucket": bucket_results,
    }


def run_worker(args: argparse.Namespace) -> dict[str, Any]:
    os.environ.update(_offline_environment())
    install_network_guard()
    try:
        import socket

        socket.create_connection(("127.0.0.1", 9), timeout=0.01)
    except RuntimeError:
        network_guard_verified = True
    else:
        raise ValueError("network guard did not reject a socket connection")

    config = load_candidate_config(args.config)
    candidate = candidate_by_id(config, args.candidate)
    protocol = config["benchmarkProtocol"]
    manifest, directory = load_and_verify_manifest(candidate, args.artifact_root, args.config)
    before_hash = manifest["artifactSetSha256"]
    model_role = "encoder_onnx_fp32" if args.variant == "fp32" else "encoder_onnx_dynamic_qint8"
    model_path = artifact_for_role(manifest, directory, model_role)

    load_started = time.perf_counter_ns()
    runtime = LocalEncoderRuntime(
        candidate,
        directory,
        model_path,
        int(protocol["intraOpThreads"]),
        int(protocol["interOpThreads"]),
    )
    model_load_millis = (time.perf_counter_ns() - load_started) / 1_000_000
    process_start_to_ready_millis = (time.perf_counter_ns() - PROCESS_STARTED_NS) / 1_000_000
    load_rss, load_peak, memory_method = current_rss()

    benchmark_input = load_benchmark_input(args.go)
    samples = sorted(benchmark_input["samples"], key=lambda item: item["sampleId"])
    train = [sample for sample in samples if sample["split"] == "train"]
    evaluation_split = "calibration" if args.phase == "selection" else "holdout"
    evaluation = [sample for sample in samples if sample["split"] == evaluation_split]
    if not train or not evaluation:
        raise ValueError("benchmark input is missing the required family-disjoint split")

    import numpy as np

    train_values = np.asarray(
        [runtime.encode_raw(sample["instructionText"]) for sample in train], dtype=np.float32
    )
    evaluation_values = np.asarray(
        [runtime.encode_raw(sample["instructionText"]) for sample in evaluation], dtype=np.float32
    )
    train_labels = np.asarray([sample["label"] for sample in train], dtype=np.int64)
    evaluation_token_counts = [
        runtime.content_token_count(sample["instructionText"]) for sample in evaluation
    ]
    dimensions = [candidate["nativeDimension"], 256, 128, 64]
    dimensions = list(dict.fromkeys(value for value in dimensions if value <= candidate["nativeDimension"]))
    if args.phase == "final":
        if args.projection_dimension not in dimensions or args.projection_output is None:
            raise ValueError("final worker requires a supported selected projection and output path")
        dimensions = [args.projection_dimension]

    evaluations: list[dict[str, Any]] = []
    selected_projection: ProjectionArtifact | None = None
    for dimension in dimensions:
        projection = fit_projection(train_values, dimension)
        predictions = fit_probe(
            projection,
            train_values,
            train_labels,
            evaluation_values,
        )
        quality = aggregate_quality(
            evaluation,
            [int(value) for value in predictions],
            evaluation_token_counts,
        )
        first_text = "Verify deterministic replay for the local encoder. 로컬 인코더 재현성을 확인하세요."
        first = runtime.encode(first_text, projection)
        second = runtime.encode(first_text, projection)
        if not np.array_equal(first, second):
            raise ValueError("same input and artifact did not replay deterministically")
        latency = measure_latency(runtime, projection, protocol)
        steady_rss, peak_rss, _ = current_rss()
        evaluations.append(
            {
                "projectionVersion": projection.version,
                "projectionDimension": dimension,
                "projectionSha256": projection.sha256,
                "projectionArtifactSizeBytes": len(projection.serialize()),
                "quality": quality,
                "latency": latency,
                "memory": {
                    "loadRssBytes": load_rss,
                    "steadyStateRssBytes": steady_rss,
                    "peakRssBytes": max(load_peak, peak_rss),
                    "measurementMethod": memory_method,
                },
                "deterministicReplay": True,
            }
        )
        selected_projection = projection

    projection_artifact: dict[str, Any] | None = None
    baseline: dict[str, Any] | None = None
    if args.phase == "final":
        if selected_projection is None:
            raise ValueError("final projection was not fitted")
        artifact_bytes = selected_projection.serialize()
        args.projection_output.parent.mkdir(parents=True, exist_ok=True)
        args.projection_output.write_bytes(artifact_bytes)
        if len(artifact_bytes) != len(selected_projection.serialize()):
            raise ValueError("projection artifact replay changed its shape")
        projection_artifact = {
            "relativePath": args.projection_output.relative_to(REPO_ROOT).as_posix(),
            "sha256": selected_projection.sha256,
            "sizeBytes": len(artifact_bytes),
        }
        rule_predictions = [1 if sample["ruleDifficulty"] == "complex" else 0 for sample in evaluation]
        baseline = aggregate_quality(evaluation, rule_predictions, evaluation_token_counts)

    after_manifest, _ = load_and_verify_manifest(candidate, args.artifact_root, args.config)
    if before_hash != after_manifest["artifactSetSha256"]:
        raise ValueError("encoder artifact set changed during frozen inference")
    result = {
        "schemaVersion": "gatelm.difficulty-semantic-encoder-worker-result.v1",
        "phase": args.phase,
        "candidateId": candidate["candidateId"],
        "sourceModelId": candidate["sourceModelId"],
        "sourceRevision": candidate["sourceRevision"],
        "variant": args.variant,
        "artifactSetSha256": before_hash,
        "artifactManifestSha256": manifest["manifestSha256"],
        "runtimeArtifactSizeBytes": runtime_artifact_size(manifest, args.variant),
        "modelLoadMillis": rounded(model_load_millis),
        "processStartToReadyMillis": rounded(process_start_to_ready_millis),
        "networkDisabled": network_guard_verified,
        "encoderFrozen": True,
        "gradientComputation": "not_available_in_onnxruntime_inference_session",
        "optimizerContainsEncoderParameters": False,
        "evaluationMode": True,
        "dropout": "disabled_by_onnx_inference_graph",
        "split": evaluation_split,
        "trainFamilies": len({sample["familyId"] for sample in train}),
        "trainSamples": len(train),
        "evaluationFamilies": len({sample["familyId"] for sample in evaluation}),
        "evaluationSamples": len(evaluation),
        "projectionEvaluations": evaluations,
        "projectionArtifact": projection_artifact,
        "ruleBaseline": baseline,
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "processAffinity": __import__("psutil").Process().cpu_affinity(),
            "intraOpThreads": protocol["intraOpThreads"],
            "interOpThreads": protocol["interOpThreads"],
        },
    }
    write_json(args.output, result)
    return result


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    run_worker(args)
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"semantic encoder worker failed: {error}", file=sys.stderr)
        raise
