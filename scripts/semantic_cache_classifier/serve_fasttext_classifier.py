#!/usr/bin/env python3
"""Serve a trained FastText cacheability classifier over HTTP."""

from __future__ import annotations

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL_FILE = BASE_DIR / "build" / "artifacts" / "cacheability-cacheability-fasttext-synthetic-v1.bin"
DEFAULT_MODEL_VERSION = "cacheability-fasttext-synthetic-v1"
LABEL_PREFIX = "__label__"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-file", type=Path, default=DEFAULT_MODEL_FILE, help="FastText .bin model artifact.")
    parser.add_argument("--model-version", default=DEFAULT_MODEL_VERSION, help="modelVersion returned to Gateway.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    return parser.parse_args()


def import_fasttext() -> Any:
    try:
        import fasttext  # type: ignore
    except ImportError as exc:
        raise SystemExit(
            "Python package 'fasttext' is required for the runtime sidecar. "
            "Install it in the sidecar environment before starting this server."
        ) from exc
    return fasttext


def make_handler(model: Any, model_version: str) -> type[BaseHTTPRequestHandler]:
    class FastTextClassifierHandler(BaseHTTPRequestHandler):
        server_version = "GateLMFastTextClassifier/1.0"

        def do_GET(self) -> None:
            if self.path == "/healthz":
                self._write_json(HTTPStatus.OK, {"status": "ok", "modelVersion": model_version})
                return
            self._write_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

        def do_POST(self) -> None:
            if self.path not in ("/classify", "/"):
                self._write_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._write_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_content_length"})
                return
            if length <= 0 or length > 16 * 1024:
                self._write_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_body"})
                return
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                self._write_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
                return

            text = " ".join(str(payload.get("text", "")).split())
            if not text:
                self._write_json(
                    HTTPStatus.OK,
                    {
                        "label": "unsafe_or_unknown",
                        "confidence": 0.0,
                        "reasonCode": "empty_input",
                        "modelVersion": model_version,
                    },
                )
                return

            labels, probabilities = model.predict(text, k=1)
            label = labels[0].removeprefix(LABEL_PREFIX) if labels else "unsafe_or_unknown"
            confidence = float(probabilities[0]) if len(probabilities) else 0.0
            self._write_json(
                HTTPStatus.OK,
                {
                    "label": label,
                    "confidence": confidence,
                    "reasonCode": "fasttext_sidecar",
                    "modelVersion": model_version,
                },
            )

        def log_message(self, _format: str, *_args: Any) -> None:
            return

        def _write_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(int(status))
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return FastTextClassifierHandler


def main() -> int:
    args = parse_args()
    model_file = args.model_file.resolve()
    if not model_file.exists():
        raise SystemExit(f"model file not found: {model_file}")

    fasttext = import_fasttext()
    model = fasttext.load_model(str(model_file))
    server = ThreadingHTTPServer((args.host, args.port), make_handler(model, args.model_version))
    print(f"serving fasttext classifier on http://{args.host}:{args.port}/classify")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 130
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
