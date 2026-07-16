from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path
from time import perf_counter
from typing import Any, Sequence

from app.domain.ai_safety_training.koelectra_training import (
    BIO_LABELS,
    TRAINING_REPORT_VERSION,
    align_bio_label_ids,
    entity_chunks,
    label_maps,
    load_and_verify_dataset,
    sha256_file,
    span_metric_report,
)


DEFAULT_BASE_MODEL = "monologg/koelectra-small-v3-discriminator"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Fine-tune KoELECTRA-small for GateLM PII NER.")
    parser.add_argument("--dataset-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--base-model", default=DEFAULT_BASE_MODEL)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--learning-rate", type=float, default=5e-5)
    parser.add_argument("--seed", type=int, default=20260716)
    parser.add_argument("--cpu-threads", type=int, default=4)
    parser.add_argument("--local-files-only", action="store_true")
    return parser


def run(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if (
        args.epochs < 1
        or args.batch_size < 1
        or args.max_length < 16
        or args.learning_rate <= 0
        or args.cpu_threads < 1
    ):
        print("FAIL: invalid PII NER training parameters", file=sys.stderr)
        return 2
    try:
        import torch
        from torch.optim import AdamW
        from torch.utils.data import DataLoader, Dataset
        from transformers import AutoModelForTokenClassification, AutoTokenizer
    except ImportError as exc:
        print("FAIL: PII NER training dependencies are not installed", file=sys.stderr)
        return 2

    try:
        records_by_split, manifest = load_and_verify_dataset(args.dataset_dir)
        label_to_id, id_to_label = label_maps()
        random.seed(args.seed)
        torch.manual_seed(args.seed)
        torch.set_num_threads(args.cpu_threads)
        tokenizer = AutoTokenizer.from_pretrained(
            args.base_model,
            use_fast=True,
            local_files_only=args.local_files_only,
        )
        if not getattr(tokenizer, "is_fast", False):
            raise ValueError("PII NER training requires a fast tokenizer")
        model = AutoModelForTokenClassification.from_pretrained(
            args.base_model,
            num_labels=len(BIO_LABELS),
            id2label=id_to_label,
            label2id=label_to_id,
            ignore_mismatched_sizes=True,
            local_files_only=args.local_files_only,
        )

        class EncodedDataset(Dataset):
            def __init__(self, records: list[dict[str, Any]]) -> None:
                self.features = [
                    encode_record(tokenizer, record, label_to_id, args.max_length)
                    for record in records
                ]

            def __len__(self) -> int:
                return len(self.features)

            def __getitem__(self, index: int) -> dict[str, list[int]]:
                return self.features[index]

        def collate(features: list[dict[str, list[int]]]) -> dict[str, Any]:
            labels = [feature["labels"] for feature in features]
            model_features = [
                {key: value for key, value in feature.items() if key != "labels"}
                for feature in features
            ]
            batch = tokenizer.pad(model_features, padding=True, return_tensors="pt")
            max_length = int(batch["input_ids"].shape[1])
            batch["labels"] = torch.tensor(
                [
                    label_ids + [-100] * (max_length - len(label_ids))
                    for label_ids in labels
                ],
                dtype=torch.long,
            )
            return batch

        train_dataset = EncodedDataset(records_by_split["train"])
        validation_dataset = EncodedDataset(records_by_split["validation"])
        generator = torch.Generator().manual_seed(args.seed)
        train_loader = DataLoader(
            train_dataset,
            batch_size=args.batch_size,
            shuffle=True,
            collate_fn=collate,
            generator=generator,
        )
        validation_loader = DataLoader(
            validation_dataset,
            batch_size=args.batch_size,
            shuffle=False,
            collate_fn=collate,
        )
        optimizer = AdamW(model.parameters(), lr=args.learning_rate)
        started = perf_counter()
        epochs: list[dict[str, Any]] = []
        for epoch_index in range(args.epochs):
            model.train()
            losses: list[float] = []
            for batch in train_loader:
                optimizer.zero_grad(set_to_none=True)
                output = model(**batch)
                output.loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                optimizer.step()
                losses.append(float(output.loss.detach().cpu()))
            validation = evaluate_model(model, validation_loader, id_to_label, torch)
            epochs.append(
                {
                    "epoch": epoch_index + 1,
                    "meanTrainingLoss": round(sum(losses) / len(losses), 6),
                    "validation": validation,
                }
            )

        args.out.mkdir(parents=True, exist_ok=True)
        model.save_pretrained(args.out, safe_serialization=True)
        tokenizer.save_pretrained(args.out)
        manifest_digest = sha256_file(args.dataset_dir / "manifest.json")
        report = {
            "reportVersion": TRAINING_REPORT_VERSION,
            "status": "complete",
            "syntheticOnly": True,
            "customerPromptUsed": False,
            "rawTrainingTextIncluded": False,
            "baseModel": args.base_model,
            "baseModelRevision": getattr(model.config, "_commit_hash", None),
            "datasetManifestSha256": manifest_digest,
            "datasetSourceCorpusSha256": manifest["sourceCorpus"]["sha256"],
            "labelContract": list(BIO_LABELS),
            "parameters": {
                "epochs": args.epochs,
                "batchSize": args.batch_size,
                "maxLength": args.max_length,
                "learningRate": args.learning_rate,
                "seed": args.seed,
                "cpuThreads": args.cpu_threads,
            },
            "durationSeconds": round(perf_counter() - started, 3),
            "epochs": epochs,
            "holdoutOpened": False,
        }
        report_path = args.out / "training-report.json"
        report_path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    except (OSError, UnicodeError, ValueError, RuntimeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2

    final_f1 = epochs[-1]["validation"]["spanMetrics"]["micro"]["f1"]
    print(
        "PII NER training completed: "
        f"epochs={args.epochs}, validationF1={final_f1}, report={report_path}"
    )
    return 0


def encode_record(
    tokenizer: Any,
    record: dict[str, Any],
    label_to_id: dict[str, int],
    max_length: int,
) -> dict[str, list[int]]:
    encoded = tokenizer(
        record["text"],
        truncation=True,
        max_length=max_length,
        return_offsets_mapping=True,
    )
    offsets = encoded.pop("offset_mapping")
    visible_end = max((int(offset[1]) for offset in offsets), default=0)
    expected_end = max((int(span["end"]) for span in record["spans"]), default=0)
    if visible_end < expected_end:
        raise ValueError(f"{record['caseId']}: max length truncates a labeled span")
    encoded["labels"] = align_bio_label_ids(offsets, record["spans"], label_to_id)
    return {key: [int(item) for item in value] for key, value in encoded.items()}


def evaluate_model(model: Any, loader: Any, id_to_label: dict[int, str], torch: Any) -> dict[str, Any]:
    model.eval()
    losses: list[float] = []
    expected_chunks: list[set[tuple[str, int, int]]] = []
    actual_chunks: list[set[tuple[str, int, int]]] = []
    with torch.no_grad():
        for batch in loader:
            output = model(**batch)
            losses.append(float(output.loss.detach().cpu()))
            predictions = output.logits.argmax(dim=-1).detach().cpu().tolist()
            labels = batch["labels"].detach().cpu().tolist()
            for predicted_row, expected_row in zip(predictions, labels, strict=True):
                valid = [index for index, value in enumerate(expected_row) if value != -100]
                expected_valid = [expected_row[index] for index in valid]
                actual_valid = [predicted_row[index] for index in valid]
                expected_chunks.append(entity_chunks(expected_valid, id_to_label))
                actual_chunks.append(entity_chunks(actual_valid, id_to_label))
    return {
        "meanLoss": round(sum(losses) / len(losses), 6),
        "spanMetrics": span_metric_report(expected_chunks, actual_chunks),
    }


def main() -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())

