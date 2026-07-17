"""Console entry point for self-host PII model initialization."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from app.model_artifacts.pii_bundle import (
    ArtifactDeliveryError,
    DEFAULT_RELEASE_ID,
    load_release_descriptor,
    sync_release,
    validate_git_object_id,
    write_artifact_verification_evidence,
)


ENABLED_ENV = "AI_SERVICE_PII_MODEL_SYNC_ENABLED"
SOURCE_FILE_ENV = "AI_SERVICE_PII_MODEL_BUNDLE_URL_FILE"
RUNTIME_ROOT_ENV = "AI_SERVICE_PII_MODEL_RUNTIME_ROOT"
RELEASE_ID_ENV = "AI_SERVICE_PII_MODEL_RELEASE_ID"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Install a pinned GateLM PII model release from a secret source file."
    )
    parser.add_argument("--source-file", type=Path)
    parser.add_argument("--runtime-root", type=Path)
    parser.add_argument("--release-id")
    parser.add_argument(
        "--evidence-out",
        type=Path,
        help="Write aggregate artifact verification evidence after a complete recheck.",
    )
    parser.add_argument(
        "--git-revision",
        help="Git revision bound into --evidence-out (required with that option).",
    )
    parser.add_argument(
        "--enabled",
        action=argparse.BooleanOptionalAction,
        default=None,
    )
    args = parser.parse_args(argv)

    enabled = _env_bool(ENABLED_ENV, False) if args.enabled is None else args.enabled
    if not enabled:
        print("PII model synchronization skipped: feature is disabled")
        return 0

    if (args.evidence_out is None) != (args.git_revision is None):
        raise ArtifactDeliveryError(
            "--evidence-out and --git-revision must be provided together"
        )
    git_revision = (
        validate_git_object_id(args.git_revision)
        if args.git_revision is not None
        else None
    )

    source_file = args.source_file or _env_path(SOURCE_FILE_ENV)
    runtime_root = args.runtime_root or _env_path(RUNTIME_ROOT_ENV, Path("/models"))
    release_id = args.release_id or os.environ.get(RELEASE_ID_ENV, DEFAULT_RELEASE_ID)
    if source_file is None:
        raise ArtifactDeliveryError("PII model bundle source secret file is required")

    source = _read_source_secret(source_file)
    descriptor = load_release_descriptor(release_id)
    status = sync_release(source, runtime_root, descriptor=descriptor)
    if args.evidence_out is not None:
        release_directory = (
            runtime_root.expanduser().resolve() / "releases" / descriptor.release_id
        )
        write_artifact_verification_evidence(
            args.evidence_out,
            release_directory,
            descriptor,
            git_revision=git_revision,
        )
    print(
        "PII model release ready: "
        f"release_id={descriptor.release_id} status={status} "
        f"aggregate_evidence={'written' if args.evidence_out is not None else 'not_requested'}"
    )
    return 0


def run() -> None:
    try:
        raise SystemExit(main())
    except ArtifactDeliveryError as exc:
        print(f"PII model synchronization failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from None
    except Exception:
        print(
            "PII model synchronization failed: unexpected local delivery error",
            file=sys.stderr,
        )
        raise SystemExit(1) from None


def _read_source_secret(path: Path) -> str:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        raise ArtifactDeliveryError("PII model bundle source secret file is unavailable") from None
    values = [line.strip() for line in lines if line.strip() and not line.lstrip().startswith("#")]
    if len(values) != 1:
        raise ArtifactDeliveryError(
            "PII model bundle source secret file must contain exactly one source"
        )
    return values[0]


def _env_bool(name: str, fallback: bool) -> bool:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return fallback
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ArtifactDeliveryError(f"{name} must be true or false")


def _env_path(name: str, fallback: Path | None = None) -> Path | None:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return fallback
    return Path(value.strip())


if __name__ == "__main__":
    run()
