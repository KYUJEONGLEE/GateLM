"""Import a local, pinned Tenant Chat PII model bundle.

This developer wrapper uses the same release descriptor, outer bundle pin,
manifest allowlist, and atomic versioned layout as the self-host initializer.
It deliberately accepts local files only; production HTTPS delivery reads its
source from a container secret through ``gatelm-pii-model-sync``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
AI_SERVICE_ROOT = REPOSITORY_ROOT / "apps" / "ai-service"
sys.path.insert(0, str(AI_SERVICE_ROOT))

from app.model_artifacts.pii_bundle import (  # noqa: E402
    ArtifactDeliveryError,
    DEFAULT_RELEASE_ID,
    load_release_descriptor,
    sync_release,
    validate_git_object_id,
    write_artifact_verification_evidence,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import a locally delivered, pinned Tenant Chat PII model bundle."
    )
    parser.add_argument("bundle", type=Path, help="Path to the delivered model bundle zip")
    parser.add_argument(
        "--runtime-root",
        type=Path,
        default=REPOSITORY_ROOT / "apps" / "ai-service" / ".cache" / "onnx",
    )
    parser.add_argument("--release-id", default=DEFAULT_RELEASE_ID)
    parser.add_argument(
        "--evidence-out",
        type=Path,
        help="Write aggregate artifact verification evidence after a complete recheck.",
    )
    parser.add_argument(
        "--git-revision",
        help="Git revision bound into --evidence-out (required with that option).",
    )
    args = parser.parse_args()

    try:
        if (args.evidence_out is None) != (args.git_revision is None):
            raise ArtifactDeliveryError(
                "--evidence-out and --git-revision must be provided together"
            )
        git_revision = (
            validate_git_object_id(args.git_revision)
            if args.git_revision is not None
            else None
        )
        descriptor = load_release_descriptor(args.release_id)
        status = sync_release(
            args.bundle,
            args.runtime_root,
            descriptor=descriptor,
        )
        release_path = (
            args.runtime_root.resolve() / "releases" / descriptor.release_id
        )
        if args.evidence_out is not None:
            write_artifact_verification_evidence(
                args.evidence_out,
                release_path,
                descriptor,
                git_revision=git_revision,
            )
    except ArtifactDeliveryError as exc:
        print(f"PII model import failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from None

    print(
        "PII model release ready: "
        f"release_id={descriptor.release_id} status={status} "
        f"aggregate_evidence={'written' if args.evidence_out is not None else 'not_requested'}"
    )


if __name__ == "__main__":
    main()
