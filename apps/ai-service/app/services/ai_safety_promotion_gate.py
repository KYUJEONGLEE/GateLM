from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Sequence

from app.domain.ai_safety_promotion import (
    PromotionEvidenceError,
    build_promotion_evidence,
    scan_promotion_output,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_MANIFEST = REPO_ROOT / "docs" / "ai-safety-lab" / "pii-model-manifest-20260715.json"
DEFAULT_QUALITY = REPO_ROOT / "docs" / "ai-safety-lab" / "pii-model-evaluation-summary-20260715.json"
DEFAULT_OUTPUT = REPO_ROOT / "reports" / "ai-safety-lab" / "pii-production-promotion-evidence.json"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Evaluate aggregate-only PII production promotion evidence."
    )
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--quality", type=Path, default=DEFAULT_QUALITY)
    parser.add_argument("--owner-policy", type=Path, default=None)
    parser.add_argument("--artifact-verification", type=Path, default=None)
    parser.add_argument("--benchmark", type=Path, default=None)
    parser.add_argument("--cold-start", type=Path, default=None)
    parser.add_argument("--tenant-chat-e2e", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--expect-blocked",
        action="store_true",
        help="Return success only when the evaluated evidence is blocked.",
    )
    return parser


def run(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        evidence = build_promotion_evidence(
            manifest=_read_object(args.manifest),
            quality=_read_object(args.quality),
            owner_policy=_read_optional_object(args.owner_policy),
            artifact_verification=_read_optional_object(args.artifact_verification),
            benchmark=_read_optional_object(args.benchmark),
            cold_start=_read_optional_object(args.cold_start),
            tenant_chat_e2e=_read_optional_object(args.tenant_chat_e2e),
        )
        scan_promotion_output(evidence)
        _write_evidence(args.out, evidence)
    except (OSError, UnicodeError, json.JSONDecodeError, PromotionEvidenceError) as exc:
        print(f"FAIL: promotion evidence could not be evaluated ({type(exc).__name__})", file=sys.stderr)
        return 2

    blocked = not evidence["readyForProduction"]
    print(
        "pii production promotion gate completed: "
        f"decision={evidence['decision']}, "
        f"passed_checks={evidence['gateCounts']['passed']}, "
        f"blocked_checks={evidence['gateCounts']['blocked']}"
    )
    if args.expect_blocked:
        return 0 if blocked else 1
    return 1 if blocked else 0


def _read_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise PromotionEvidenceError("promotion input must be a JSON object")
    return value


def _read_optional_object(path: Path | None) -> dict[str, Any] | None:
    return None if path is None else _read_object(path)


def _write_evidence(path: Path, evidence: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    path.write_text(text, encoding="utf-8")


def main() -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
