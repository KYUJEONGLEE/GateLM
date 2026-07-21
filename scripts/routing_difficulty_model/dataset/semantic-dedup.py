"""Offline multilingual-E5 semantic-duplicate audit for routing prompts.

Embeddings and prompt text remain process-local.  The persisted audit contains
only aggregate metrics, stable sample identifiers, and cluster membership.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer


MODEL_ID = "intfloat/multilingual-e5-small"
MODEL_REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
MODEL_RELATIVE_PATH = "generated/model.dynamic-qint8-matmul.onnx"
MODEL_SHA256 = "a374ca7b87cdafc3c2a4b8b3c7db4a6500803ced02c750351d5fa80f60e94a94"
INPUT_PREFIX = "query: "
MAX_LENGTH = 128
EMBEDDING_DIMENSION = 384
DEFAULT_THRESHOLD = 0.985


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_number}: JSON object required")
            rows.append(value)
    if not rows:
        raise ValueError("semantic dedup requires a non-empty JSONL dataset")
    return rows


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def encode_prompts(
    prompts: list[str], model_directory: Path, *, batch_size: int, threads: int
) -> np.ndarray:
    model_path = model_directory / MODEL_RELATIVE_PATH
    if not model_directory.is_dir() or not model_path.is_file():
        raise FileNotFoundError(f"pinned E5 artifacts not found under {model_directory}")
    if sha256_file(model_path) != MODEL_SHA256:
        raise ValueError("pinned E5 QInt8 model hash mismatch")

    tokenizer = AutoTokenizer.from_pretrained(
        model_directory,
        local_files_only=True,
        trust_remote_code=False,
        use_fast=True,
    )
    tokenizer.truncation_side = "right"
    tokenizer.padding_side = "right"
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = ort.InferenceSession(
        str(model_path), sess_options=options, providers=["CPUExecutionProvider"]
    )
    input_names = {value.name for value in session.get_inputs()}
    if not {"input_ids", "attention_mask"}.issubset(input_names):
        raise ValueError("E5 ONNX model is missing required inputs")

    embeddings = np.empty((len(prompts), EMBEDDING_DIMENSION), dtype=np.float32)
    for start in range(0, len(prompts), batch_size):
        batch = [INPUT_PREFIX + prompt for prompt in prompts[start : start + batch_size]]
        encoded = tokenizer(
            batch,
            add_special_tokens=True,
            padding=True,
            truncation=True,
            max_length=MAX_LENGTH,
            return_attention_mask=True,
            return_token_type_ids=True,
            return_tensors="np",
        )
        input_ids = np.asarray(encoded["input_ids"], dtype=np.int64)
        attention_mask = np.asarray(encoded["attention_mask"], dtype=np.int64)
        token_type_ids = np.asarray(
            encoded.get("token_type_ids", np.zeros_like(input_ids)), dtype=np.int64
        )
        inputs = {
            name: {
                "input_ids": input_ids,
                "attention_mask": attention_mask,
                "token_type_ids": token_type_ids,
            }[name]
            for name in input_names
        }
        hidden = np.asarray(session.run(["last_hidden_state"], inputs)[0], dtype=np.float32)
        mask = attention_mask.astype(np.float32)
        pooled = (hidden * mask[:, :, None]).sum(axis=1) / mask.sum(axis=1, keepdims=True)
        norms = np.linalg.norm(pooled, axis=1, keepdims=True)
        if not np.all(np.isfinite(pooled)) or np.any(norms <= 1e-12):
            raise ValueError("E5 produced invalid or degenerate embeddings")
        embeddings[start : start + len(batch)] = pooled / norms
    return embeddings


def pair_scores(embeddings: np.ndarray, pairs: Iterable[tuple[int, int]]) -> np.ndarray:
    pair_list = list(pairs)
    if not pair_list:
        return np.empty(0, dtype=np.float32)
    left = np.fromiter((pair[0] for pair in pair_list), dtype=np.int64)
    right = np.fromiter((pair[1] for pair in pair_list), dtype=np.int64)
    return np.einsum("ij,ij->i", embeddings[left], embeddings[right], dtype=np.float32)


def calibration_pairs(rows: list[dict[str, Any]]) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    groups: dict[str, list[int]] = defaultdict(list)
    buckets: dict[tuple[str, str, str], list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        groups[str(row["group_id"])].append(index)
        buckets[(str(row["task_type"]), str(row["service_domain"]), str(row["label"]))].append(index)

    positives: list[tuple[int, int]] = []
    for indexes in groups.values():
        for left_offset, left in enumerate(indexes):
            for right in indexes[left_offset + 1 :]:
                positives.append((left, right))

    negatives: list[tuple[int, int]] = []
    seen: set[tuple[int, int]] = set()
    for index, row in enumerate(rows):
        bucket = buckets[(str(row["task_type"]), str(row["service_domain"]), str(row["label"]))]
        if len(bucket) < 2:
            continue
        digest = hashlib.sha256(str(row["sample_id"]).encode("utf-8")).digest()
        start = int.from_bytes(digest[:8], "big") % len(bucket)
        for offset in range(len(bucket)):
            other = bucket[(start + offset) % len(bucket)]
            if other == index or rows[other]["group_id"] == row["group_id"]:
                continue
            pair = (min(index, other), max(index, other))
            if pair not in seen:
                seen.add(pair)
                negatives.append(pair)
            break
        if len(negatives) >= len(positives):
            break
    return positives, negatives


class UnionFind:
    def __init__(self, size: int) -> None:
        self.parent = list(range(size))

    def find(self, value: int) -> int:
        while self.parent[value] != value:
            self.parent[value] = self.parent[self.parent[value]]
            value = self.parent[value]
        return value

    def union(self, left: int, right: int) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root != right_root:
            self.parent[right_root] = left_root


def semantic_candidates(
    rows: list[dict[str, Any]],
    embeddings: np.ndarray,
    *,
    threshold: float,
    block_size: int,
    maximum_pairs: int,
) -> tuple[list[dict[str, Any]], int, float]:
    candidates: list[dict[str, Any]] = []
    total_candidates = 0
    maximum_cross_group_similarity = -1.0
    size = len(rows)
    for start in range(0, size, block_size):
        end = min(size, start + block_size)
        scores = embeddings[start:end] @ embeddings.T
        for local_index, row_scores in enumerate(scores):
            left = start + local_index
            row_scores[: left + 1] = -1.0
            if left + 1 < size:
                different_groups = np.fromiter(
                    (rows[right]["group_id"] != rows[left]["group_id"] for right in range(left + 1, size)),
                    dtype=bool,
                )
                if np.any(different_groups):
                    maximum_cross_group_similarity = max(
                        maximum_cross_group_similarity,
                        float(np.max(row_scores[left + 1 :][different_groups])),
                    )
            for right in np.flatnonzero(row_scores >= threshold):
                if rows[left]["group_id"] == rows[right]["group_id"]:
                    continue
                total_candidates += 1
                if len(candidates) < maximum_pairs:
                    candidates.append(
                        {
                            "left_sample_id": rows[left]["sample_id"],
                            "right_sample_id": rows[right]["sample_id"],
                            "similarity": round(float(row_scores[right]), 6),
                            "same_label": rows[left]["label"] == rows[right]["label"],
                            "same_task_type": rows[left]["task_type"] == rows[right]["task_type"],
                            "same_service_domain": rows[left]["service_domain"] == rows[right]["service_domain"],
                            "same_split": rows[left]["split"] == rows[right]["split"],
                        }
                    )
    return candidates, total_candidates, maximum_cross_group_similarity


def build_clusters(rows: list[dict[str, Any]], pairs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    indexes = {str(row["sample_id"]): index for index, row in enumerate(rows)}
    union_find = UnionFind(len(rows))
    for pair in pairs:
        union_find.union(indexes[pair["left_sample_id"]], indexes[pair["right_sample_id"]])
    members: dict[int, list[int]] = defaultdict(list)
    for sample_id in {pair["left_sample_id"] for pair in pairs} | {pair["right_sample_id"] for pair in pairs}:
        index = indexes[sample_id]
        members[union_find.find(index)].append(index)
    clusters = []
    for cluster_indexes in members.values():
        unique_indexes = sorted(set(cluster_indexes), key=lambda index: str(rows[index]["sample_id"]))
        clusters.append(
            {
                "sample_ids": [rows[index]["sample_id"] for index in unique_indexes],
                "group_ids": sorted({str(rows[index]["group_id"]) for index in unique_indexes}),
                "splits": sorted({str(rows[index]["split"]) for index in unique_indexes}),
            }
        )
    return sorted(clusters, key=lambda cluster: cluster["sample_ids"][0])


def is_duplicate_candidate(pair: dict[str, Any]) -> bool:
    return bool(
        pair["same_label"]
        and pair["same_task_type"]
        and pair["same_service_domain"]
    )


def build_remediation(
    rows: list[dict[str, Any]],
    audit: dict[str, Any],
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    by_sample_id = {str(row["sample_id"]): row for row in rows}
    duplicate_pairs = [pair for pair in audit.get("pairs", []) if is_duplicate_candidate(pair)]
    clusters = build_clusters(rows, duplicate_pairs)
    excluded_public: set[str] = set((existing or {}).get("excluded_public_sample_ids", []))
    diversified_enterprise: set[str] = set(
        (existing or {}).get("diversified_enterprise_sample_ids", [])
    )
    alternative_enterprise: set[str] = set(
        (existing or {}).get("alternative_enterprise_sample_ids", [])
    )
    for cluster in clusters:
        sample_ids = [str(sample_id) for sample_id in cluster["sample_ids"]]
        public_ids = [
            sample_id for sample_id in sample_ids if by_sample_id[sample_id]["source"] == "public"
        ]
        enterprise_ids = [
            sample_id for sample_id in sample_ids if by_sample_id[sample_id]["source"] != "public"
        ]
        diversified_enterprise.update(enterprise_ids)
        if len(enterprise_ids) > 1:
            alternative_enterprise.update(sorted(enterprise_ids)[1:])
        if public_ids:
            keeper = sorted(
                public_ids,
                key=lambda sample_id: (
                    -int(bool(by_sample_id[sample_id].get("source_direct_human_authored"))),
                    -float(by_sample_id[sample_id].get("quality_score", 0.0)),
                    sample_id,
                ),
            )[0]
            excluded_public.update(sample_id for sample_id in public_ids if sample_id != keeper)
    return {
        "schema_version": "gatelm.routing-difficulty-semantic-dedup-remediation.v1",
        "based_on_dataset_sha256": audit["dataset"]["sha256"],
        "threshold": audit["calibration"]["threshold"],
        "policy": {
            "candidate_definition": "cosine_at_threshold_and_same_label_task_type_service_domain",
            "public": "keep_highest_quality_direct_human_candidate_then_exclude_other_cluster_members",
            "enterprise": "retain_balancing_metadata_and_add_record_specific_semantic_scope",
        },
        "excluded_public_sample_ids": sorted(excluded_public),
        "diversified_enterprise_sample_ids": sorted(diversified_enterprise),
        "alternative_enterprise_sample_ids": sorted(alternative_enterprise),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model-directory", type=Path)
    parser.add_argument("--existing-audit", type=Path)
    parser.add_argument("--existing-remediation", type=Path)
    parser.add_argument("--remediation-output", type=Path)
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--block-size", type=int, default=256)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--maximum-persisted-pairs", type=int, default=5000)
    args = parser.parse_args()
    if not 0.0 < args.threshold < 1.0:
        raise ValueError("threshold must be between zero and one")

    rows = read_jsonl(args.dataset)
    required = {
        "sample_id",
        "group_id",
        "redacted_prompt",
        "label",
        "task_type",
        "service_domain",
        "split",
    }
    for index, row in enumerate(rows):
        missing = required - row.keys()
        if missing:
            raise ValueError(f"record {index} missing fields: {sorted(missing)}")

    if args.existing_audit:
        audit = json.loads(args.existing_audit.read_text(encoding="utf-8"))
        if audit.get("dataset", {}).get("sha256") != sha256_file(args.dataset):
            raise ValueError("existing semantic audit does not match the dataset hash")
        if not args.remediation_output:
            raise ValueError("--existing-audit requires --remediation-output")
        existing_remediation = (
            json.loads(args.existing_remediation.read_text(encoding="utf-8"))
            if args.existing_remediation
            else None
        )
        remediation = build_remediation(rows, audit, existing_remediation)
        write_json(args.remediation_output, remediation)
        print(
            json.dumps(
                {
                    "excluded_public": len(remediation["excluded_public_sample_ids"]),
                    "diversified_enterprise": len(remediation["diversified_enterprise_sample_ids"]),
                    "alternative_enterprise": len(remediation["alternative_enterprise_sample_ids"]),
                },
                sort_keys=True,
            )
        )
        return 0

    if not args.model_directory:
        raise ValueError("--model-directory is required unless --existing-audit is used")

    embeddings = encode_prompts(
        [str(row["redacted_prompt"]) for row in rows],
        args.model_directory,
        batch_size=args.batch_size,
        threads=args.threads,
    )
    positives, negatives = calibration_pairs(rows)
    positive_scores = pair_scores(embeddings, positives)
    negative_scores = pair_scores(embeddings, negatives)
    true_positives = int(np.count_nonzero(positive_scores >= args.threshold))
    false_positives = int(np.count_nonzero(negative_scores >= args.threshold))
    precision = true_positives / (true_positives + false_positives) if true_positives + false_positives else 1.0
    recall = true_positives / len(positive_scores) if len(positive_scores) else 0.0
    pairs, observed_pair_count, maximum_similarity = semantic_candidates(
        rows,
        embeddings,
        threshold=args.threshold,
        block_size=args.block_size,
        maximum_pairs=args.maximum_persisted_pairs,
    )
    if observed_pair_count > len(pairs):
        raise ValueError(
            f"semantic candidate count {observed_pair_count} exceeds persisted-pair safety limit {len(pairs)}"
        )
    duplicate_pairs = [pair for pair in pairs if is_duplicate_candidate(pair)]
    clusters = build_clusters(rows, duplicate_pairs)
    audit = {
        "schema_version": "gatelm.routing-difficulty-semantic-dedup-audit.v1",
        "dataset": {
            "path": args.dataset.as_posix(),
            "sha256": sha256_file(args.dataset),
            "record_count": len(rows),
        },
        "encoder": {
            "model_id": MODEL_ID,
            "revision": MODEL_REVISION,
            "onnx_path": MODEL_RELATIVE_PATH,
            "onnx_sha256": MODEL_SHA256,
            "input_prefix": INPUT_PREFIX,
            "maximum_token_length": MAX_LENGTH,
            "pooling": "attention_masked_mean_then_l2_normalize",
            "embedding_dimension": EMBEDDING_DIMENSION,
        },
        "execution": {
            "network_access": "disabled_by_local_files_only",
            "embeddings_persisted": False,
            "prompt_text_persisted": False,
            "batch_size": args.batch_size,
            "similarity": "cosine_on_l2_normalized_native_e5_embeddings",
        },
        "calibration": {
            "reference_positive_definition": "same_group_id_derivation_or_boundary_variant",
            "reference_negative_definition": "different_group_id_same_label_task_and_domain_deterministic_sample",
            "positive_pairs": len(positive_scores),
            "negative_pairs": len(negative_scores),
            "threshold": args.threshold,
            "precision_at_threshold": round(precision, 6),
            "recall_at_threshold": round(recall, 6),
            "minimum_required_precision": 0.95,
            "precision_requirement_met": precision >= 0.95,
        },
        "result": {
            "observed_cross_group_pairs_at_or_above_threshold": observed_pair_count,
            "semantic_duplicate_candidate_pairs": len(duplicate_pairs),
            "domain_or_label_contrast_pairs": observed_pair_count - len(duplicate_pairs),
            "maximum_cross_group_similarity": round(maximum_similarity, 6),
            "clusters": len(clusters),
            "split_conflict_clusters": sum(1 for cluster in clusters if len(cluster["splits"]) > 1),
            "semantic_duplicate_guardrail_met": len(duplicate_pairs) == 0 and precision >= 0.95,
        },
        "pairs": pairs,
        "clusters": clusters,
    }
    if args.remediation_output:
        existing_remediation = (
            json.loads(args.existing_remediation.read_text(encoding="utf-8"))
            if args.existing_remediation
            else None
        )
        write_json(
            args.remediation_output,
            build_remediation(rows, audit, existing_remediation),
        )
    write_json(args.output, audit)
    print(
        json.dumps(
            {
                "records": len(rows),
                "threshold": args.threshold,
                "calibration_precision": round(precision, 6),
                "calibration_recall": round(recall, 6),
                "observed_cross_group_pairs": observed_pair_count,
                "semantic_duplicate_candidate_pairs": len(duplicate_pairs),
                "maximum_cross_group_similarity": round(maximum_similarity, 6),
            },
            sort_keys=True,
        )
    )
    return 0 if audit["result"]["semantic_duplicate_guardrail_met"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
