"""Verify the rendered Self-host Compose PII model delivery boundary."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Mapping


RELEASE_ID = "tenant-chat-pii-models-20260715"
PRIMARY_MODEL_PATH = f"/models/releases/{RELEASE_ID}/openai--privacy-filter"
ADDITIONAL_MODEL_PATH_ALLOWLIST = frozenset(
    {
        (
            f"/models/releases/{RELEASE_ID}/"
            "amoeba04--koelectra-small-v3-privacy-ner-quantized"
        )
    }
)
ML_ALLOWED_DETECTOR_TYPES = ("phone_number", "secret")


class VerificationError(RuntimeError):
    pass


def verify_config(payload: object) -> None:
    root = _mapping(payload, "Compose document")
    services = _mapping(root.get("services"), "Compose services")
    init = _mapping(services.get("pii-model-init"), "pii-model-init service")
    ai_service = _mapping(services.get("ai-service"), "ai-service service")

    if init.get("image") != ai_service.get("image"):
        raise VerificationError("pii-model-init and ai-service must use the same image pin")
    command = init.get("command")
    if command != ["gatelm-pii-model-sync"]:
        raise VerificationError("pii-model-init must run only the pinned synchronization CLI")

    init_environment = _mapping(init.get("environment"), "pii-model-init environment")
    if "AI_SERVICE_PII_MODEL_BUNDLE_URL" in init_environment:
        raise VerificationError("presigned model URL must not be present in container environment")
    if init_environment.get("AI_SERVICE_PII_MODEL_BUNDLE_URL_FILE") != (
        "/run/secrets/pii_model_bundle_url"
    ):
        raise VerificationError("pii-model-init must read its source through the Compose secret")
    if init_environment.get("AI_SERVICE_PII_MODEL_SYNC_ENABLED") not in {"false", False}:
        raise VerificationError("PII model synchronization must be opt-in in the example config")
    if init_environment.get("AI_SERVICE_PII_MODEL_RELEASE_ID") != RELEASE_ID:
        raise VerificationError("pii-model-init release id is not pinned")

    if init.get("read_only") is not True:
        raise VerificationError("pii-model-init root filesystem must be read-only")
    if not _has_tmpfs_target(init, "/tmp"):
        raise VerificationError("pii-model-init must mount /tmp as tmpfs")
    secret_target = _secret_target(init, "pii_model_bundle_url")
    if secret_target != "/run/secrets/pii_model_bundle_url":
        raise VerificationError(
            "pii-model-init must mount the pinned source secret at the expected target"
        )

    init_volume = _volume_at(init, "/models")
    ai_volume = _volume_at(ai_service, "/models")
    if init_volume.get("source") != "pii_model_data" or init_volume.get("read_only", False):
        raise VerificationError("pii-model-init must own the writable model volume")
    if ai_volume.get("source") != "pii_model_data" or not ai_volume.get("read_only", False):
        raise VerificationError("ai-service must mount the model volume read-only")
    if any(volume.get("type") == "bind" for volume in ai_service.get("volumes", [])):
        raise VerificationError("ai-service must not bind-mount a repository model cache")

    depends_on = _mapping(ai_service.get("depends_on"), "ai-service dependencies")
    init_dependency = _mapping(
        depends_on.get("pii-model-init"), "ai-service model initializer dependency"
    )
    if init_dependency.get("condition") != "service_completed_successfully":
        raise VerificationError("ai-service must wait for successful model initialization")

    ai_environment = _mapping(ai_service.get("environment"), "ai-service environment")
    if ai_environment.get("AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID") != PRIMARY_MODEL_PATH:
        raise VerificationError("ai-service primary model must use the pinned OpenAI path")
    _additional_model_paths(
        ai_environment.get("AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS")
    )
    if ai_environment.get("AI_SERVICE_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES") != (
        ",".join(ML_ALLOWED_DETECTOR_TYPES)
    ):
        raise VerificationError("ai-service ML detector allowlist is not pinned")

    secrets = _mapping(root.get("secrets"), "Compose secrets")
    if "pii_model_bundle_url" not in secrets:
        raise VerificationError("PII model source Compose secret is missing")
    if "pii_model_data" not in _mapping(root.get("volumes"), "Compose volumes"):
        raise VerificationError("PII model named volume is missing")


def render_compose(compose_file: Path, env_file: Path) -> object:
    command = [
        "docker",
        "compose",
        "--env-file",
        str(env_file),
        "-f",
        str(compose_file),
        "config",
        "--format",
        "json",
    ]
    try:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError):
        raise VerificationError("Docker Compose could not render the Self-host model delivery config") from None
    try:
        return json.loads(completed.stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise VerificationError("Docker Compose did not return a JSON configuration") from None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--compose-file", type=Path, required=True)
    parser.add_argument("--env-file", type=Path, required=True)
    args = parser.parse_args()
    try:
        verify_config(render_compose(args.compose_file, args.env_file))
    except VerificationError as exc:
        print(f"Self-host PII model delivery verification failed: {exc}", file=sys.stderr)
        return 1
    print("Self-host PII model delivery verification passed")
    return 0


def _mapping(value: object, name: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise VerificationError(f"{name} is missing or invalid")
    return value


def _additional_model_paths(value: object) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, str):
        raise VerificationError("ai-service additional model paths must be a string")
    if value.strip() == "":
        return ()

    paths = value.split(",")
    if any(path == "" or path != path.strip() for path in paths):
        raise VerificationError("ai-service additional model path syntax is invalid")
    if len(set(paths)) != len(paths):
        raise VerificationError("ai-service additional model paths must not contain duplicates")
    if any(path not in ADDITIONAL_MODEL_PATH_ALLOWLIST for path in paths):
        raise VerificationError("ai-service additional model path is not pinned or allowlisted")
    return tuple(paths)


def _volume_at(service: Mapping[str, object], target: str) -> Mapping[str, object]:
    volumes = service.get("volumes")
    if not isinstance(volumes, list):
        raise VerificationError(f"service volume {target} is missing")
    matches = [
        volume
        for volume in volumes
        if isinstance(volume, Mapping) and volume.get("target") == target
    ]
    if len(matches) != 1:
        raise VerificationError(f"service must have exactly one {target} volume")
    return matches[0]


def _has_tmpfs_target(service: Mapping[str, object], target: str) -> bool:
    tmpfs = service.get("tmpfs")
    if not isinstance(tmpfs, list):
        return False
    for mount in tmpfs:
        if isinstance(mount, str) and mount.split(":", maxsplit=1)[0] == target:
            return True
        if isinstance(mount, Mapping) and mount.get("target") == target:
            return True
    return False


def _secret_target(service: Mapping[str, object], source: str) -> str:
    secrets = service.get("secrets")
    if not isinstance(secrets, list) or len(secrets) != 1:
        raise VerificationError("pii-model-init must mount exactly one Compose secret")

    attachment = secrets[0]
    if isinstance(attachment, str):
        attached_source = attachment
        target = attachment
    elif isinstance(attachment, Mapping):
        attached_source = attachment.get("source")
        target = attachment.get("target", attached_source)
    else:
        raise VerificationError("pii-model-init Compose secret attachment is invalid")

    if attached_source != source or not isinstance(target, str) or not target:
        raise VerificationError("pii-model-init Compose secret source is not pinned")
    if target.startswith("/"):
        return target
    return f"/run/secrets/{target}"


if __name__ == "__main__":
    raise SystemExit(main())
