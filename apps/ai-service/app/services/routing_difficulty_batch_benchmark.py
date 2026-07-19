from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from app.api.dependencies import create_routing_difficulty_service
from app.core.config import load_settings
from app.domain.routing_difficulty.runtime import RoutingDifficultyPrediction
from app.schemas.routing_difficulty import MODEL_CONTENT_HASH, MODEL_VERSION


SCHEMA_VERSION = "gatelm.routing-difficulty-batch-benchmark.v1"


@dataclass(frozen=True)
class _BenchmarkRecord:
    instruction_text: str
    rule_vector: tuple[float, ...]
    expected_difficulty: str


def main() -> None:
    args = _parse_args()
    records, dataset_hash, vector_hash = _load_records(
        args.dataset,
        args.vector_export,
        args.split,
    )
    service = create_routing_difficulty_service(load_settings())
    service.warmup()
    batch_sizes = _parse_batch_sizes(args.batch_sizes)
    baseline_predictions = _predict(service, records, 1)[0]
    results = []
    for batch_size in batch_sizes:
        service.classify_many(
            [record.instruction_text for record in records[:batch_size]],
            [record.rule_vector for record in records[:batch_size]],
        )
        elapsed_total = 0.0
        cpu_total = 0.0
        batch_latencies_ms: list[float] = []
        candidate_predictions: list[RoutingDifficultyPrediction] | None = None
        for _ in range(args.repetitions):
            predictions, elapsed, cpu_elapsed, latencies = _predict(
                service,
                records,
                batch_size,
            )
            if candidate_predictions is None:
                candidate_predictions = predictions
            elif [item.difficulty for item in predictions] != [
                item.difficulty for item in candidate_predictions
            ]:
                raise RuntimeError("batch benchmark predictions are not deterministic")
            elapsed_total += elapsed
            cpu_total += cpu_elapsed
            batch_latencies_ms.extend(latencies)
        assert candidate_predictions is not None
        results.append(
            _summarize(
                records=records,
                baseline=baseline_predictions,
                candidate=candidate_predictions,
                batch_size=batch_size,
                repetitions=args.repetitions,
                elapsed_total=elapsed_total,
                cpu_total=cpu_total,
                batch_latencies_ms=batch_latencies_ms,
            )
        )
    print(
        json.dumps(
            {
                "schemaVersion": SCHEMA_VERSION,
                "status": "completed",
                "modelVersion": MODEL_VERSION,
                "modelContentHash": MODEL_CONTENT_HASH,
                "datasetSha256": dataset_hash,
                "vectorExportSha256": vector_hash,
                "split": args.split,
                "sampleCount": len(records),
                "repetitions": args.repetitions,
                "results": results,
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare batch execution against canonical batch=1 inference."
    )
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--vector-export", type=Path, required=True)
    parser.add_argument("--split", choices=("train", "calibration", "holdout", "all"), default="holdout")
    parser.add_argument("--batch-sizes", default="1,2,4,8")
    parser.add_argument("--repetitions", type=int, default=3)
    args = parser.parse_args()
    if not 1 <= args.repetitions <= 20:
        parser.error("--repetitions must be between 1 and 20")
    return args


def _parse_batch_sizes(raw: str) -> tuple[int, ...]:
    try:
        values = tuple(int(value.strip()) for value in raw.split(","))
    except ValueError as exc:
        raise ValueError("batch sizes must be comma-separated integers") from exc
    if not values or values[0] != 1 or any(value < 1 or value > 64 for value in values):
        raise ValueError("batch sizes must start with 1 and stay between 1 and 64")
    if len(set(values)) != len(values):
        raise ValueError("batch sizes must be unique")
    return values


def _load_records(
    dataset_path: Path,
    vector_export_path: Path,
    split: str,
) -> tuple[list[_BenchmarkRecord], str, str]:
    dataset_bytes = dataset_path.read_bytes()
    vector_bytes = vector_export_path.read_bytes()
    prompts: dict[str, tuple[str, str]] = {}
    for line in dataset_bytes.splitlines():
        if not line.strip():
            continue
        decoded = json.loads(line)
        sample_id = decoded.get("sampleId")
        prompt = decoded.get("redactedPrompt")
        expected = decoded.get("expectedDifficulty")
        if (
            not isinstance(sample_id, str)
            or not isinstance(prompt, str)
            or expected not in {"simple", "complex"}
        ):
            raise ValueError("difficulty dataset record is invalid")
        prompts[sample_id] = (prompt, expected)
    vector_export = json.loads(vector_bytes)
    samples = vector_export.get("samples")
    if not isinstance(samples, list):
        raise ValueError("difficulty vector export is invalid")
    records: list[_BenchmarkRecord] = []
    for sample in samples:
        if not isinstance(sample, dict) or sample.get("modelPath") is not True:
            continue
        if split != "all" and sample.get("split") != split:
            continue
        sample_id = sample.get("sampleId")
        vector = sample.get("vector")
        if not isinstance(sample_id, str) or sample_id not in prompts:
            raise ValueError("difficulty vector sample identity is invalid")
        if not isinstance(vector, list) or len(vector) != 42:
            raise ValueError("difficulty rule vector is invalid")
        numeric_vector = tuple(float(value) for value in vector)
        if any(not math.isfinite(value) for value in numeric_vector):
            raise ValueError("difficulty rule vector must be finite")
        prompt, expected = prompts[sample_id]
        records.append(
            _BenchmarkRecord(
                instruction_text=prompt,
                rule_vector=numeric_vector,
                expected_difficulty=expected,
            )
        )
    if not records:
        raise ValueError("difficulty benchmark selection is empty")
    return (
        records,
        hashlib.sha256(dataset_bytes).hexdigest(),
        hashlib.sha256(vector_bytes).hexdigest(),
    )


def _predict(
    service: object,
    records: Sequence[_BenchmarkRecord],
    batch_size: int,
) -> tuple[list[RoutingDifficultyPrediction], float, float, list[float]]:
    predictions: list[RoutingDifficultyPrediction] = []
    latencies_ms: list[float] = []
    cpu_started = time.process_time()
    started = time.perf_counter()
    for start in range(0, len(records), batch_size):
        batch = records[start : start + batch_size]
        batch_started = time.perf_counter()
        predictions.extend(
            service.classify_many(
                [record.instruction_text for record in batch],
                [record.rule_vector for record in batch],
            )
        )
        latencies_ms.append((time.perf_counter() - batch_started) * 1000.0)
    return (
        predictions,
        time.perf_counter() - started,
        time.process_time() - cpu_started,
        latencies_ms,
    )


def _summarize(
    *,
    records: Sequence[_BenchmarkRecord],
    baseline: Sequence[RoutingDifficultyPrediction],
    candidate: Sequence[RoutingDifficultyPrediction],
    batch_size: int,
    repetitions: int,
    elapsed_total: float,
    cpu_total: float,
    batch_latencies_ms: Sequence[float],
) -> dict[str, object]:
    if len(baseline) != len(candidate) or len(candidate) != len(records):
        raise RuntimeError("difficulty benchmark output shape is invalid")
    deltas = [
        abs(candidate[index].calibrated_score - baseline[index].calibrated_score)
        for index in range(len(records))
    ]
    label_flips = sum(
        item.difficulty != baseline[index].difficulty
        for index, item in enumerate(candidate)
    )
    complex_to_simple = sum(
        baseline[index].difficulty == "complex" and item.difficulty == "simple"
        for index, item in enumerate(candidate)
    )
    confusion = _confusion(records, candidate)
    total_items = len(records) * repetitions
    return {
        "batchSize": batch_size,
        "throughputItemsPerSecond": round(total_items / elapsed_total, 3),
        "cpuMsPerItem": round(cpu_total * 1000.0 / total_items, 3),
        "batchLatencyP50Ms": round(statistics.median(batch_latencies_ms), 3),
        "batchLatencyP95Ms": round(_percentile(batch_latencies_ms, 0.95), 3),
        "labelFlipCountVsBatch1": label_flips,
        "complexToSimpleFlipCountVsBatch1": complex_to_simple,
        "meanAbsoluteScoreDeltaVsBatch1": round(statistics.fmean(deltas), 9),
        "maximumAbsoluteScoreDeltaVsBatch1": round(max(deltas), 9),
        **confusion,
    }


def _confusion(
    records: Sequence[_BenchmarkRecord],
    predictions: Sequence[RoutingDifficultyPrediction],
) -> dict[str, object]:
    true_positive = false_positive = true_negative = false_negative = 0
    for record, prediction in zip(records, predictions, strict=True):
        if record.expected_difficulty == "complex":
            if prediction.difficulty == "complex":
                true_positive += 1
            else:
                false_negative += 1
        elif prediction.difficulty == "complex":
            false_positive += 1
        else:
            true_negative += 1
    total = len(records)
    precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 0.0
    recall = true_positive / (true_positive + false_negative) if true_positive + false_negative else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "accuracy": round((true_positive + true_negative) / total, 6),
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "f1": round(f1, 6),
        "confusion": {
            "truePositive": true_positive,
            "falsePositive": false_positive,
            "trueNegative": true_negative,
            "falseNegative": false_negative,
        },
    }


def _percentile(values: Sequence[float], quantile: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    rank = max(0, math.ceil(len(ordered) * quantile) - 1)
    return ordered[rank]


if __name__ == "__main__":
    main()
