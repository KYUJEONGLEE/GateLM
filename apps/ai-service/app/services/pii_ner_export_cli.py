from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any, Sequence

from app.domain.ai_safety_training.koelectra_training import sha256_file


EXPORT_REPORT_VERSION = "gatelm.pii-ner-onnx-export.v1"
DEFAULT_MAX_MODEL_BYTES = 32 * 1024 * 1024


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Export a trained GateLM KoELECTRA PII NER model to dynamic-QInt8 ONNX."
    )
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--max-model-bytes", type=int, default=DEFAULT_MAX_MODEL_BYTES)
    return parser


def run(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.max_model_bytes < 1:
        print("FAIL: max model bytes must be positive", file=sys.stderr)
        return 2
    try:
        validate_training_artifact(args.model_dir)
        import torch
        from onnxruntime import InferenceSession
        from onnxruntime.quantization import QuantType, quantize_dynamic
        from transformers import AutoModelForTokenClassification, AutoTokenizer

        args.out.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(
            prefix=".gatelm-pii-ner-onnx-",
            dir=args.out.parent,
        ) as temp_dir:
            fp32_dir = Path(temp_dir)
            fp32_model = fp32_dir / "model.onnx"
            export_fp32_graph(
                model_dir=args.model_dir,
                output_path=fp32_model,
                torch=torch,
                model_loader=AutoModelForTokenClassification,
                tokenizer_loader=AutoTokenizer,
            )
            output_model = args.out / "model.onnx"
            previous_temp_dir = tempfile.tempdir
            tempfile.tempdir = str(args.out.parent)
            try:
                quantize_dynamic(
                    str(fp32_model),
                    str(output_model),
                    weight_type=QuantType.QInt8,
                )
            finally:
                tempfile.tempdir = previous_temp_dir

        copy_runtime_files(args.model_dir, args.out)
        session = InferenceSession(
            str(args.out / "model.onnx"),
            providers=["CPUExecutionProvider"],
        )
        input_names = sorted(item.name for item in session.get_inputs())
        if "input_ids" not in input_names or "attention_mask" not in input_names:
            raise ValueError("exported ONNX model input contract mismatch")
        report = build_export_report(
            model_dir=args.model_dir,
            output_dir=args.out,
            input_names=input_names,
            max_model_bytes=args.max_model_bytes,
        )
        report_path = args.out / "export-report.json"
        report_path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    except (ImportError, OSError, UnicodeError, ValueError, RuntimeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2

    print(
        "PII NER ONNX export completed: "
        f"sizeBytes={report['model']['sizeBytes']}, "
        f"sizeGate={report['model']['sizeGate']}, report={report_path}"
    )
    return 0 if report["model"]["sizeGate"] == "pass" else 1


def validate_training_artifact(model_dir: Path) -> None:
    required = (
        "config.json",
        "tokenizer.json",
        "training-report.json",
    )
    missing = [name for name in required if not (model_dir / name).is_file()]
    if missing:
        raise ValueError(f"trained PII NER artifact is missing required files: {missing!r}")
    report = json.loads((model_dir / "training-report.json").read_text(encoding="utf-8"))
    if (
        report.get("status") != "complete"
        or report.get("syntheticOnly") is not True
        or report.get("customerPromptUsed") is not False
        or report.get("holdoutOpened") is not False
    ):
        raise ValueError("trained PII NER artifact provenance contract mismatch")


def find_exported_model(output_dir: Path) -> Path:
    candidates = sorted(output_dir.rglob("*.onnx"))
    if len(candidates) != 1:
        raise ValueError("ONNX export must create exactly one graph")
    return candidates[0]


def export_fp32_graph(
    *,
    model_dir: Path,
    output_path: Path,
    torch: Any,
    model_loader: Any,
    tokenizer_loader: Any,
) -> None:
    model = model_loader.from_pretrained(model_dir, local_files_only=True)
    tokenizer = tokenizer_loader.from_pretrained(
        model_dir,
        local_files_only=True,
        use_fast=True,
    )
    encoded = tokenizer(
        "GateLM synthetic privacy detector export.",
        return_tensors="pt",
    )
    input_names = tuple(
        name
        for name in ("input_ids", "attention_mask", "token_type_ids")
        if name in encoded
    )
    if "input_ids" not in input_names or "attention_mask" not in input_names:
        raise ValueError("tokenizer ONNX input contract mismatch")

    class LogitsOnly(torch.nn.Module):
        def __init__(self, wrapped: Any, names: tuple[str, ...]) -> None:
            super().__init__()
            self.wrapped = wrapped
            self.names = names

        def forward(self, *values: Any) -> Any:
            kwargs = dict(zip(self.names, values, strict=True))
            return self.wrapped(**kwargs).logits

    wrapped = LogitsOnly(model.eval(), input_names)
    dynamic_axes = {
        name: {0: "batch", 1: "sequence"}
        for name in input_names
    }
    dynamic_axes["logits"] = {0: "batch", 1: "sequence"}
    torch.onnx.export(
        wrapped,
        tuple(encoded[name] for name in input_names),
        str(output_path),
        input_names=list(input_names),
        output_names=["logits"],
        dynamic_axes=dynamic_axes,
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )


def copy_runtime_files(model_dir: Path, output_dir: Path) -> None:
    for name in (
        "config.json",
        "special_tokens_map.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "vocab.txt",
    ):
        source = model_dir / name
        if source.is_file():
            shutil.copy2(source, output_dir / name)


def build_export_report(
    *,
    model_dir: Path,
    output_dir: Path,
    input_names: list[str],
    max_model_bytes: int,
) -> dict[str, Any]:
    model_path = output_dir / "model.onnx"
    size_bytes = model_path.stat().st_size
    runtime_files = [
        path
        for path in sorted(output_dir.iterdir())
        if path.is_file() and path.name != "export-report.json"
    ]
    return {
        "reportVersion": EXPORT_REPORT_VERSION,
        "status": "complete",
        "customerPromptUsed": False,
        "rawTextIncluded": False,
        "spanOrOffsetIncluded": False,
        "quantization": "dynamic-qint8",
        "trainingReportSha256": sha256_file(model_dir / "training-report.json"),
        "model": {
            "fileName": "model.onnx",
            "sha256": sha256_file(model_path),
            "sizeBytes": size_bytes,
            "maxSizeBytes": max_model_bytes,
            "sizeGate": "pass" if size_bytes <= max_model_bytes else "fail",
            "inputNames": input_names,
        },
        "runtimeFiles": [
            {
                "fileName": path.name,
                "sha256": sha256_file(path),
                "sizeBytes": path.stat().st_size,
            }
            for path in runtime_files
        ],
    }


def main() -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
