from __future__ import annotations

import argparse
import json
import math
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter, sleep
from typing import Any, Sequence

from app.adapters.safety.privacy_filter_adapter import PrivacyFilterAdapter
from app.domain.ai_safety_eval.master_corpus import load_master_eval_corpus
from app.domain.ai_safety_training.koelectra_training import (
    exact_span_metric_report,
    load_and_verify_dataset,
    sha256_file,
)
from app.domain.safety_eval.report import scan_text_for_forbidden_sensitive_values
from app.schemas.safety_eval import SafetyEvalError
from app.services.ai_safety_detector import AiSafetyDetectorService
from app.services.ai_safety_master_eval_runner import (
    ACTUAL_SOURCE_RULES_ONLY,
    DEFAULT_CORPUS_PATH,
    build_detector_service,
    build_master_detector_config,
    evaluate_master_corpus,
    force_load_detector_models,
    load_screening_subset,
)
from app.services.ai_safety_model_ablation_runner import (
    DEFAULT_SUBSET_MANIFEST_PATH,
    compare_profile_reports,
)


REPORT_VERSION = "gatelm.pii-ner-candidate-evaluation.v1"
TARGET_TYPES = (
    "email",
    "organization_name",
    "person_name",
    "phone_number",
    "postal_address",
    "resident_registration_number",
)
TRAINING_TO_DETECTOR = {
    "ADDR": "postal_address",
    "EMA": "email",
    "ORG": "organization_name",
    "PER": "person_name",
    "PHN": "phone_number",
    "RRN": "resident_registration_number",
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Evaluate a GateLM KoELECTRA PII NER candidate without storing raw text."
    )
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--dataset-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS_PATH)
    parser.add_argument(
        "--subset-manifest",
        type=Path,
        default=DEFAULT_SUBSET_MANIFEST_PATH,
    )
    parser.add_argument("--min-confidence", type=float, default=0.5)
    parser.add_argument("--warmup-iterations", type=int, default=5)
    parser.add_argument("--latency-iterations", type=int, default=3)
    parser.add_argument("--max-warm-p95-ms", type=float, default=50.0)
    parser.add_argument("--max-peak-rss-mib", type=float, default=512.0)
    parser.add_argument("--min-holdout-micro-f1", type=float, default=0.85)
    parser.add_argument("--min-holdout-type-recall", type=float, default=0.5)
    parser.add_argument("--no-fail-on-gate", action="store_true")
    return parser


def run(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if (
        not 0 <= args.min_confidence <= 1
        or args.warmup_iterations < 1
        or args.latency_iterations < 1
        or args.max_warm_p95_ms <= 0
        or args.max_peak_rss_mib <= 0
        or not 0 <= args.min_holdout_micro_f1 <= 1
        or not 0 <= args.min_holdout_type_recall <= 1
    ):
        print("FAIL: invalid PII NER candidate evaluation parameters", file=sys.stderr)
        return 2
    try:
        validate_runtime_artifact(args.model_dir)
        holdout_by_split, dataset_manifest = load_and_verify_dataset(
            args.dataset_dir,
            include_splits=("holdout",),
        )
        records = holdout_by_split["holdout"]
        sampler = PeakRssSampler()
        sampler.start()
        adapter = PrivacyFilterAdapter(
            model_name=str(args.model_dir),
            runtime="onnx",
            min_confidence=args.min_confidence,
            min_confidence_by_detector_type={
                detector_type: args.min_confidence for detector_type in TARGET_TYPES
            },
        )
        adapter.warmup()
        holdout = evaluate_holdout(records, adapter)
        latency = evaluate_latency(
            records,
            adapter,
            warmup_iterations=args.warmup_iterations,
            measured_iterations=args.latency_iterations,
        )
        screening = evaluate_screening(
            adapter=adapter,
            corpus_path=args.corpus,
            subset_manifest_path=args.subset_manifest,
        )
        peak_rss_mib = sampler.stop()
        gates = evaluate_candidate_gates(
            holdout=holdout,
            latency=latency,
            screening=screening,
            peak_rss_mib=peak_rss_mib,
            max_warm_p95_ms=args.max_warm_p95_ms,
            max_peak_rss_mib=args.max_peak_rss_mib,
            min_holdout_micro_f1=args.min_holdout_micro_f1,
            min_holdout_type_recall=args.min_holdout_type_recall,
        )
        report = {
            "reportVersion": REPORT_VERSION,
            "generatedAt": datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z"),
            "status": "complete",
            "screeningOnly": True,
            "productionPromotionEvidence": False,
            "syntheticOnly": True,
            "customerPromptUsed": False,
            "rawTextIncluded": False,
            "detectedValueIncluded": False,
            "spanOrOffsetIncluded": False,
            "artifact": {
                "modelSha256": sha256_file(args.model_dir / "model.onnx"),
                "modelSizeBytes": (args.model_dir / "model.onnx").stat().st_size,
                "exportReportSha256": sha256_file(args.model_dir / "export-report.json"),
                "datasetManifestSha256": sha256_file(args.dataset_dir / "manifest.json"),
                "sourceCorpusSha256": dataset_manifest["sourceCorpus"]["sha256"],
            },
            "configuration": {
                "minConfidence": args.min_confidence,
                "targetDetectorTypes": list(TARGET_TYPES),
            },
            "holdout": holdout,
            "latency": latency,
            "resources": {
                "peakProcessRssMiB": peak_rss_mib,
                "measurementIncludesRuntimeAndEvaluation": True,
            },
            "screening": screening,
            "candidateGate": gates,
        }
        json_text = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        markdown_text = render_markdown(report)
        scan_text_for_forbidden_sensitive_values(json_text, "PII NER candidate JSON report")
        scan_text_for_forbidden_sensitive_values(markdown_text, "PII NER candidate Markdown report")
        args.out.mkdir(parents=True, exist_ok=True)
        json_path = args.out / "pii-ner-candidate-evaluation.json"
        markdown_path = args.out / "pii-ner-candidate-evaluation.md"
        json_path.write_text(json_text, encoding="utf-8")
        markdown_path.write_text(markdown_text, encoding="utf-8")
    except (
        ImportError,
        OSError,
        UnicodeError,
        ValueError,
        RuntimeError,
        SafetyEvalError,
    ) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2

    print(
        "PII NER candidate evaluation completed: "
        f"decision={gates['decision']}, failedChecks={len(gates['failedChecks'])}, "
        f"json={json_path}, markdown={markdown_path}"
    )
    if gates["decision"] == "pass" or args.no_fail_on_gate:
        return 0
    return 1


def validate_runtime_artifact(model_dir: Path) -> None:
    missing = [
        name
        for name in ("config.json", "tokenizer.json", "model.onnx", "export-report.json")
        if not (model_dir / name).is_file()
    ]
    if missing:
        raise ValueError(f"PII NER runtime artifact is missing files: {missing!r}")
    export_report = json.loads((model_dir / "export-report.json").read_text(encoding="utf-8"))
    if export_report.get("status") != "complete":
        raise ValueError("PII NER export report is incomplete")
    if export_report.get("model", {}).get("sha256") != sha256_file(model_dir / "model.onnx"):
        raise ValueError("PII NER model checksum does not match its export report")


def evaluate_holdout(
    records: list[dict[str, Any]],
    adapter: PrivacyFilterAdapter,
) -> dict[str, Any]:
    expected_rows: list[set[tuple[str, int, int]]] = []
    actual_rows: list[set[tuple[str, int, int]]] = []
    false_positive_case_ids: list[str] = []
    mismatch_case_ids: list[str] = []
    for record in records:
        expected = {
            (
                TRAINING_TO_DETECTOR[str(span["label"])],
                int(span["start"]),
                int(span["end"]),
            )
            for span in record["spans"]
        }
        actual = {
            (detection.detector_type, detection.start, detection.end)
            for detection in adapter.detect(record["text"])
            if detection.detector_type in TARGET_TYPES
        }
        expected_rows.append(expected)
        actual_rows.append(actual)
        if not expected and actual:
            false_positive_case_ids.append(record["caseId"])
        if expected != actual:
            mismatch_case_ids.append(record["caseId"])
    metrics = exact_span_metric_report(
        expected_rows,
        actual_rows,
        entity_types=TARGET_TYPES,
    )
    return {
        "recordCount": len(records),
        "positiveRecordCount": sum(bool(row) for row in expected_rows),
        "negativeRecordCount": sum(not row for row in expected_rows),
        "exactMatchRecordCount": sum(
            expected == actual
            for expected, actual in zip(expected_rows, actual_rows, strict=True)
        ),
        "negativeFalsePositiveCaseCount": len(false_positive_case_ids),
        "negativeFalsePositiveCaseIds": false_positive_case_ids,
        "mismatchCaseIds": mismatch_case_ids,
        "spanMetrics": metrics,
    }


def evaluate_latency(
    records: list[dict[str, Any]],
    adapter: PrivacyFilterAdapter,
    *,
    warmup_iterations: int,
    measured_iterations: int,
) -> dict[str, Any]:
    texts = [record["text"] for record in records]
    for index in range(warmup_iterations):
        adapter.detect(texts[index % len(texts)])
    samples: list[float] = []
    for _ in range(measured_iterations):
        for text in texts:
            started = perf_counter()
            adapter.detect(text)
            samples.append((perf_counter() - started) * 1000)
    return {
        "runtime": "onnx-cpu-dynamic-qint8",
        "warmupIterations": warmup_iterations,
        "measuredIterationsPerRecord": measured_iterations,
        "sampleCount": len(samples),
        "p50Ms": round(nearest_rank(samples, 0.50), 3),
        "p95Ms": round(nearest_rank(samples, 0.95), 3),
        "maxMs": round(max(samples), 3),
    }


def evaluate_screening(
    *,
    adapter: PrivacyFilterAdapter,
    corpus_path: Path,
    subset_manifest_path: Path,
) -> dict[str, Any]:
    all_cases = load_master_eval_corpus(corpus_path)
    cases, subset_metadata = load_screening_subset(
        subset_manifest_path,
        corpus_path=corpus_path,
        cases=all_cases,
    )
    baseline_service = build_detector_service(ACTUAL_SOURCE_RULES_ONLY)
    candidate_service = AiSafetyDetectorService(
        adapter=adapter,
        detectors=build_master_detector_config(),
    )
    force_load_detector_models(candidate_service)
    baseline = evaluate_master_corpus(
        cases,
        service=baseline_service,
        corpus_path=corpus_path,
        actual_source="rules-only",
        screening_subset=subset_metadata,
    )
    candidate = evaluate_master_corpus(
        cases,
        service=candidate_service,
        corpus_path=corpus_path,
        actual_source="rules-gatelm-koelectra-candidate",
        screening_subset=subset_metadata,
    )
    comparison = compare_profile_reports(baseline, candidate)
    candidate_adapter_stats = candidate["actualSource"]["adapterStats"][0]
    return {
        "caseCount": subset_metadata["caseCount"],
        "sourceCorpusSha256": subset_metadata["sourceCorpusSha256"],
        "baselineSummary": baseline["summary"],
        "candidateSummary": candidate["summary"],
        "candidateModelExecution": candidate["modelExecution"],
        "candidateAdapterStats": candidate_adapter_stats,
        "comparison": comparison,
    }


def evaluate_candidate_gates(
    *,
    holdout: dict[str, Any],
    latency: dict[str, Any],
    screening: dict[str, Any],
    peak_rss_mib: float,
    max_warm_p95_ms: float,
    max_peak_rss_mib: float,
    min_holdout_micro_f1: float,
    min_holdout_type_recall: float,
) -> dict[str, Any]:
    comparison = screening["comparison"]
    by_type = holdout["spanMetrics"]["byEntity"]
    populated_type_recall_pass = all(
        metrics["falseNegative"] == 0
        or (
            metrics["recall"] is not None
            and metrics["recall"] >= min_holdout_type_recall
        )
        for metrics in by_type.values()
        if metrics["truePositive"] + metrics["falseNegative"] > 0
    )
    new_hard_negative_false_positives = sum(
        values["newHardNegativeFalsePositiveCases"]
        for values in comparison["byDetectorType"].values()
    )
    semantic_target_rescues = sum(
        comparison["byDetectorType"][detector_type]["rescuedTruePositiveCases"]
        for detector_type in ("person_name", "organization_name", "postal_address")
    )
    checks = {
        "holdoutMicroF1": {
            "pass": (holdout["spanMetrics"]["micro"]["f1"] or 0)
            >= min_holdout_micro_f1,
            "actual": holdout["spanMetrics"]["micro"]["f1"],
            "minimum": min_holdout_micro_f1,
        },
        "holdoutPerTypeRecall": {
            "pass": populated_type_recall_pass,
            "minimum": min_holdout_type_recall,
        },
        "holdoutNegativeFalsePositive": {
            "pass": holdout["negativeFalsePositiveCaseCount"] == 0,
            "actual": holdout["negativeFalsePositiveCaseCount"],
            "maximum": 0,
        },
        "screeningExactPassDelta": {
            "pass": comparison["summaryDelta"]["passedCases"] > 0,
            "actual": comparison["summaryDelta"]["passedCases"],
            "minimumExclusive": 0,
        },
        "screeningNewFalsePositive": {
            "pass": len(comparison["newFalsePositiveCaseIds"]) == 0,
            "actual": len(comparison["newFalsePositiveCaseIds"]),
            "maximum": 0,
        },
        "screeningNewHardNegativeFalsePositive": {
            "pass": new_hard_negative_false_positives == 0,
            "actual": new_hard_negative_false_positives,
            "maximum": 0,
        },
        "semanticTypeContribution": {
            "pass": semantic_target_rescues >= 1,
            "actual": semantic_target_rescues,
            "minimum": 1,
        },
        "warmP95Latency": {
            "pass": latency["p95Ms"] <= max_warm_p95_ms,
            "actualMs": latency["p95Ms"],
            "maximumMs": max_warm_p95_ms,
        },
        "peakProcessRss": {
            "pass": peak_rss_mib <= max_peak_rss_mib,
            "actualMiB": peak_rss_mib,
            "maximumMiB": max_peak_rss_mib,
        },
    }
    failed_checks = [name for name, result in checks.items() if not result["pass"]]
    return {
        "decision": "pass" if not failed_checks else "fail",
        "failedChecks": failed_checks,
        "checks": checks,
        "stage6DeploymentAllowed": not failed_checks,
    }


class PeakRssSampler:
    def __init__(self) -> None:
        self._stop = threading.Event()
        self._samples: list[int] = []
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        try:
            import psutil
        except ImportError as exc:
            raise RuntimeError("candidate resource gate requires psutil") from exc
        process = psutil.Process()

        def sample() -> None:
            while not self._stop.is_set():
                self._samples.append(int(process.memory_info().rss))
                sleep(0.005)
            self._samples.append(int(process.memory_info().rss))

        self._thread = threading.Thread(target=sample, daemon=True)
        self._thread.start()

    def stop(self) -> float:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1)
        if not self._samples:
            raise RuntimeError("peak RSS sampler did not collect a sample")
        return round(max(self._samples) / (1024 * 1024), 3)


def nearest_rank(values: Sequence[float], percentile: float) -> float:
    if not values:
        raise ValueError("percentile requires at least one sample")
    ordered = sorted(float(value) for value in values)
    rank = max(1, math.ceil(percentile * len(ordered)))
    return ordered[rank - 1]


def render_markdown(report: dict[str, Any]) -> str:
    holdout = report["holdout"]
    screening = report["screening"]
    gate = report["candidateGate"]
    lines = [
        "# GateLM KoELECTRA PII NER 후보 평가",
        "",
        "> 합성 데이터 기반 engineering screening이며 production 승격 증거가 아닙니다.",
        "",
        f"- 후보 판정: `{gate['decision']}`",
        f"- 실패 gate: `{', '.join(gate['failedChecks']) or '없음'}`",
        f"- holdout record: `{holdout['recordCount']}`",
        f"- holdout micro F1: `{holdout['spanMetrics']['micro']['f1']}`",
        f"- direct warm p95: `{report['latency']['p95Ms']} ms`",
        f"- peak process RSS: `{report['resources']['peakProcessRssMiB']} MiB`",
        f"- screening exact pass 변화: `{screening['comparison']['summaryDelta']['passedCases']}`",
        f"- screening 신규 FP 사례: `{len(screening['comparison']['newFalsePositiveCaseIds'])}`",
        "",
        "## 유형별 holdout span 지표",
        "",
        "| 유형 | TP | FP | FN | Precision | Recall | F1 |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for detector_type, metrics in holdout["spanMetrics"]["byEntity"].items():
        lines.append(
            f"| {detector_type} | {metrics['truePositive']} | {metrics['falsePositive']} | "
            f"{metrics['falseNegative']} | {metrics['precision']} | {metrics['recall']} | {metrics['f1']} |"
        )
    lines.extend(
        [
            "",
            "## Gate",
            "",
            "| Gate | 결과 |",
            "|---|---|",
        ]
    )
    for name, result in gate["checks"].items():
        lines.append(f"| {name} | {'pass' if result['pass'] else 'fail'} |")
    lines.extend(
        [
            "",
            "원문, 탐지 값, span, offset은 이 보고서에 저장하지 않습니다.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
