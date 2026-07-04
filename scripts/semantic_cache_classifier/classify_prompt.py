#!/usr/bin/env python3
"""Classify ad hoc prompts with a trained FastText cacheability model."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL_FILE = BASE_DIR / "build" / "artifacts" / "cacheability-cacheability-fasttext-synthetic-v2.bin"
LABEL_PREFIX = "__label__"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-file", type=Path, default=DEFAULT_MODEL_FILE, help="FastText .bin model artifact.")
    parser.add_argument("--text", help="Prompt text to classify. If omitted, starts interactive mode.")
    parser.add_argument("--top-k", type=int, default=4, help="Number of labels to print.")
    return parser.parse_args()


def import_fasttext() -> Any:
    try:
        import fasttext  # type: ignore
    except ImportError as exc:
        raise SystemExit(
            "Python package 'fasttext' is required. Use the verified Python 3.12 venv "
            "or install fasttext-wheel and numpy<2 in your local tooling environment."
        ) from exc
    return fasttext


def classify(model: Any, text: str, top_k: int) -> None:
    normalized = " ".join(text.split())
    if not normalized:
        return
    labels, probabilities = model.predict(normalized, k=top_k)
    print(f"text: {normalized}")
    print("top predictions:")
    for label, probability in zip(labels, probabilities):
        print(f"  {label.removeprefix(LABEL_PREFIX)}: {float(probability):.3f}")


def main() -> int:
    args = parse_args()
    model_file = args.model_file.resolve()
    if not model_file.exists():
        raise SystemExit(f"model file not found: {model_file}")
    if args.top_k < 1:
        raise SystemExit("--top-k must be at least 1")

    fasttext = import_fasttext()
    model = fasttext.load_model(str(model_file))

    if args.text is not None:
        classify(model, args.text, args.top_k)
        return 0

    print("Type prompt. Empty line exits.")
    while True:
        try:
            text = input("> ")
        except EOFError:
            break
        if not text.strip():
            break
        classify(model, text, args.top_k)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
