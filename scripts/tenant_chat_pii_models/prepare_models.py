"""Download, export, quantize, and verify the pinned GateLM PII models."""

from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

OPENAI_REPO = "openai/privacy-filter"
OPENAI_REVISION = "7ffa9a043d54d1be65afb281eddf0ffbe629385b"
KOELECTRA_REPO = "amoeba04/koelectra-small-v3-privacy-ner"
KOELECTRA_REVISION = "9f4e2fd9e35b12bcdb5fc334ac31be4399cb4281"

OPENAI_FILES = {
    "config.json": "b2b26a4a4a000639ad30b0c264adbefe365bdb567fbd7bb27303b8c438375bd1",
    "tokenizer.json": "0614fe83cadab421296e664e1f48f4261fa8fef6e03e63bb75c20f38e37d07d3",
    "tokenizer_config.json": "6c14af9ce1a284d3c3c5146b26efe4cd589c68e1dd4e9d94455606ec911ba774",
    "viterbi_calibration.json": "bbc8611ef08a55ed72d64856cbbbb9a91db8dfa881f0a92e2afbad6e4bbc775a",
    "onnx/model_quantized.onnx": "a325fb5341567a73c94e91ec5e49060d38d9b16111f518ad34773039a0c9c098",
    "onnx/model_quantized.onnx_data": "50f4c8c7f3c27fbc1fe16d4f74f6f7c3b74ba8f18a262e8b6911854c64c33a6d",
}
KOELECTRA_FILES = {
    "config.json": "8595ec9b495ea716adda11730223257d3835377b9d12b5bbd7f1fe79fb850f36",
    "model.onnx": "77662411a461dd996f79bb42a6fbdf9a1eaa9d2480d82e4a128c3486ff4317e2",
    "special_tokens_map.json": "3c3507f36dff57bce437223db3b3081d1e2b52ec3e56ee55438193ecb2c94dd6",
    "tokenizer.json": "d5c7a9a8996aca4fee55a3664381b012bd7dbb3e190061b2591c02502b7171b6",
    "tokenizer_config.json": "35f88592880dee61248e34227481e5fa8fb143c67808f87f98965304056907b1",
    "vocab.txt": "6e886927dfcecd22029b1ba80c10a1374740259c1067fc3a28d964b7ae2d55a7",
}
KOELECTRA_SOURCE_FILES = (
    "config.json",
    "model.safetensors",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.txt",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify(directory: Path, expected: dict[str, str], label: str) -> None:
    failures: list[str] = []
    for relative, expected_hash in expected.items():
        path = directory / relative
        if not path.is_file():
            failures.append(f"missing:{relative}")
        elif sha256(path) != expected_hash:
            failures.append(f"sha256:{relative}")
    if failures:
        raise SystemExit(f"{label} verification failed: {', '.join(failures)}")


def download(repo: str, revision: str, files: tuple[str, ...], target: Path) -> None:
    from huggingface_hub import hf_hub_download

    for relative in files:
        downloaded = Path(
            hf_hub_download(repo_id=repo, revision=revision, filename=relative)
        )
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(downloaded, destination)


def prepare(runtime_root: Path, source_root: Path) -> None:
    openai_dir = runtime_root / "openai--privacy-filter"
    koelectra_dir = runtime_root / "amoeba04--koelectra-small-v3-privacy-ner-quantized"
    source_dir = source_root / "amoeba04--koelectra-small-v3-privacy-ner"

    download(OPENAI_REPO, OPENAI_REVISION, tuple(OPENAI_FILES), openai_dir)
    download(KOELECTRA_REPO, KOELECTRA_REVISION, KOELECTRA_SOURCE_FILES, source_dir)

    runtime_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="koelectra-export-", dir=runtime_root) as temp:
        exported = Path(temp) / "onnx"
        subprocess.run(
            [
                sys.executable,
                "-m",
                "optimum.exporters.onnx",
                "--model",
                str(source_dir),
                "--task",
                "token-classification",
                "--framework",
                "pt",
                str(exported),
            ],
            check=True,
        )
        from onnxruntime.quantization import QuantType, quantize_dynamic

        koelectra_dir.mkdir(parents=True, exist_ok=True)
        for name in KOELECTRA_FILES:
            if name != "model.onnx":
                shutil.copy2(exported / name, koelectra_dir / name)
        quantize_dynamic(
            str(exported / "model.onnx"),
            str(koelectra_dir / "model.onnx"),
            weight_type=QuantType.QInt8,
        )

    verify(openai_dir, OPENAI_FILES, OPENAI_REPO)
    verify(koelectra_dir, KOELECTRA_FILES, KOELECTRA_REPO)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-root", type=Path, default=Path(".cache/onnx"))
    parser.add_argument(
        "--source-root", type=Path, default=Path(".cache/huggingface/models")
    )
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    if not args.verify_only:
        prepare(args.runtime_root, args.source_root)
    verify(args.runtime_root / "openai--privacy-filter", OPENAI_FILES, OPENAI_REPO)
    verify(
        args.runtime_root / "amoeba04--koelectra-small-v3-privacy-ner-quantized",
        KOELECTRA_FILES,
        KOELECTRA_REPO,
    )
    print("PII model artifacts verified: 12 files")


if __name__ == "__main__":
    main()
