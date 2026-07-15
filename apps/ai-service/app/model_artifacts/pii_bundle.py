"""Download, verify, and atomically install a pinned PII model release.

The remote source is untrusted. A release is accepted only when the outer
bundle, embedded manifest, and every runtime artifact match a descriptor
shipped with the AI Service image. Source URLs are never included in errors.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
import urllib.parse
import urllib.request
import zipfile
from contextlib import contextmanager
from dataclasses import dataclass
from importlib import resources
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Iterator, Mapping
from urllib.error import HTTPError, URLError


DEFAULT_RELEASE_ID = "tenant-chat-pii-models-20260715"
DESCRIPTOR_VERSION = "gatelm.pii-model-release.v1"
MANIFEST_VERSION = "tenant-chat-pii-models.v1"
COPY_CHUNK_BYTES = 1024 * 1024
DOWNLOAD_TIMEOUT_SECONDS = 30
MAX_RUNTIME_ARTIFACT_BYTES = 4 * 1024 * 1024 * 1024
RELEASE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
MODEL_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$")
FULL_GIT_OBJECT_ID_PATTERN = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")
ARTIFACT_EVIDENCE_VERSION = "pii-artifact-verification.v1"
EVIDENCE_BINDING_VERSION = "pii-promotion-evidence-binding.v1"


class ArtifactDeliveryError(RuntimeError):
    """A sanitized model delivery failure safe to show to an operator."""


@dataclass(frozen=True)
class BundlePin:
    bytes: int
    sha256: str
    manifest_suffix: str
    manifest_bytes: int
    manifest_sha256: str


@dataclass(frozen=True)
class RuntimePin:
    artifact_files: int
    artifact_bytes: int
    model_directories: tuple[str, ...]
    primary_model_directory: str
    additional_model_directories: tuple[str, ...]


@dataclass(frozen=True)
class ReleaseDescriptor:
    release_id: str
    bundle: BundlePin
    runtime: RuntimePin


@dataclass(frozen=True)
class RuntimeArtifact:
    model_directory: str
    relative_path: PurePosixPath
    bytes: int
    sha256: str


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(COPY_CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_release_descriptor(release_id: str = DEFAULT_RELEASE_ID) -> ReleaseDescriptor:
    _validate_release_id(release_id)
    try:
        descriptor_path = resources.files("app.model_artifacts.releases").joinpath(
            f"{release_id}.json"
        )
        payload = json.loads(descriptor_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError) as exc:
        raise ArtifactDeliveryError("pinned model release descriptor is unavailable") from exc
    return parse_release_descriptor(payload, expected_release_id=release_id)


def parse_release_descriptor(
    payload: object,
    *,
    expected_release_id: str | None = None,
) -> ReleaseDescriptor:
    root = _require_mapping(payload, "release descriptor")
    if root.get("descriptorVersion") != DESCRIPTOR_VERSION:
        raise ArtifactDeliveryError("unsupported model release descriptor version")

    release_id = _require_string(root.get("releaseId"), "release id")
    _validate_release_id(release_id)
    if expected_release_id is not None and release_id != expected_release_id:
        raise ArtifactDeliveryError("model release descriptor id does not match the requested release")

    bundle_payload = _require_mapping(root.get("bundle"), "bundle pin")
    bundle = BundlePin(
        bytes=_require_positive_int(bundle_payload.get("bytes"), "bundle bytes"),
        sha256=_require_sha256(bundle_payload.get("sha256"), "bundle SHA-256"),
        manifest_suffix=_require_safe_suffix(
            bundle_payload.get("manifestSuffix"), "manifest suffix"
        ),
        manifest_bytes=_require_positive_int(
            bundle_payload.get("manifestBytes"), "manifest bytes"
        ),
        manifest_sha256=_require_sha256(
            bundle_payload.get("manifestSha256"), "manifest SHA-256"
        ),
    )

    runtime_payload = _require_mapping(root.get("runtime"), "runtime pin")
    model_directories = _require_directory_list(
        runtime_payload.get("modelDirectories"), "runtime model directories"
    )
    primary = _require_directory_name(
        runtime_payload.get("primaryModelDirectory"), "primary model directory"
    )
    additional = _require_directory_list(
        runtime_payload.get("additionalModelDirectories"),
        "additional model directories",
        allow_empty=True,
    )
    if primary not in model_directories or any(
        directory not in model_directories for directory in additional
    ):
        raise ArtifactDeliveryError("runtime model directory pin is inconsistent")
    if len({primary, *additional}) != 1 + len(additional):
        raise ArtifactDeliveryError("runtime model directory pin contains duplicates")

    runtime = RuntimePin(
        artifact_files=_require_positive_int(
            runtime_payload.get("artifactFiles"), "runtime artifact file count"
        ),
        artifact_bytes=_require_positive_int(
            runtime_payload.get("artifactBytes"), "runtime artifact bytes"
        ),
        model_directories=model_directories,
        primary_model_directory=primary,
        additional_model_directories=additional,
    )
    if runtime.artifact_bytes > MAX_RUNTIME_ARTIFACT_BYTES:
        raise ArtifactDeliveryError("runtime artifact release exceeds the safety limit")
    return ReleaseDescriptor(release_id=release_id, bundle=bundle, runtime=runtime)


def sync_release(
    source: str | Path,
    runtime_root: Path,
    *,
    descriptor: ReleaseDescriptor | None = None,
    timeout_seconds: int = DOWNLOAD_TIMEOUT_SECONDS,
) -> str:
    """Ensure a verified versioned release exists under ``runtime_root``.

    Returns ``"installed"`` for a new atomic installation and ``"verified"``
    when an existing release passed a complete file re-verification.
    """

    pinned = descriptor or load_release_descriptor()
    root = runtime_root.expanduser().resolve()
    releases_root = root / "releases"
    release_directory = releases_root / pinned.release_id
    releases_root.mkdir(parents=True, exist_ok=True)

    if release_directory.exists() or release_directory.is_symlink():
        verify_release(release_directory, pinned)
        return "verified"

    with _verified_bundle_source(
        source,
        releases_root,
        pinned.bundle,
        timeout_seconds=timeout_seconds,
    ) as bundle_path:
        staging_path = Path(
            tempfile.mkdtemp(prefix=f".{pinned.release_id}.", dir=releases_root)
        )
        try:
            _extract_release(bundle_path, staging_path, pinned)
            verify_release(staging_path, pinned)
            try:
                staging_path.rename(release_directory)
            except FileExistsError as exc:
                raise ArtifactDeliveryError(
                    "model release activation raced with another installer"
                ) from exc
        finally:
            if staging_path.exists():
                shutil.rmtree(staging_path)
    return "installed"


def verify_release(release_directory: Path, descriptor: ReleaseDescriptor) -> None:
    _verified_release_manifest(release_directory, descriptor)


def build_artifact_verification_evidence(
    release_directory: Path,
    descriptor: ReleaseDescriptor,
    *,
    git_revision: str,
) -> dict[str, object]:
    """Reverify a release and return promotion-safe aggregate integrity evidence."""

    revision = validate_git_object_id(git_revision)
    manifest = _verified_release_manifest(release_directory, descriptor)
    models = manifest.get("models")
    if not isinstance(models, list) or not models:
        raise ArtifactDeliveryError("installed model manifest has no models")

    model_revisions: dict[str, str] = {}
    for payload in models:
        model = _require_mapping(payload, "model manifest entry")
        model_id = _require_string(model.get("modelId"), "model id")
        model_revision = _require_bounded_string(model.get("revision"), "model revision")
        if MODEL_ID_PATTERN.fullmatch(model_id) is None:
            raise ArtifactDeliveryError("model id cannot be used in promotion evidence")
        if model_id in model_revisions:
            raise ArtifactDeliveryError("model manifest contains duplicate model ids")
        model_revisions[model_id] = model_revision

    expected_files = descriptor.runtime.artifact_files
    return {
        "schemaVersion": ARTIFACT_EVIDENCE_VERSION,
        "aggregateOnly": True,
        "filesExpected": expected_files,
        "filesVerified": expected_files,
        "checksumFailures": 0,
        "evidenceBinding": {
            "schemaVersion": EVIDENCE_BINDING_VERSION,
            "manifestVersion": MANIFEST_VERSION,
            "modelRevisions": dict(sorted(model_revisions.items())),
            "artifactChecksumsVerified": True,
            "gitRevision": revision,
        },
    }


def write_artifact_verification_evidence(
    output_path: Path,
    release_directory: Path,
    descriptor: ReleaseDescriptor,
    *,
    git_revision: str,
) -> None:
    """Atomically write aggregate evidence without URLs, paths, or digests."""

    evidence = build_artifact_verification_evidence(
        release_directory,
        descriptor,
        git_revision=git_revision,
    )
    destination = output_path.expanduser().absolute()
    temporary_path: Path | None = None
    file_descriptor: int | None = None
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        file_descriptor, name = tempfile.mkstemp(
            prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
        )
        temporary_path = Path(name)
        with os.fdopen(file_descriptor, "w", encoding="utf-8", newline="\n") as output:
            file_descriptor = None
            json.dump(
                evidence,
                output,
                ensure_ascii=True,
                sort_keys=True,
                separators=(",", ":"),
            )
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_path, destination)
        temporary_path = None
    except OSError:
        raise ArtifactDeliveryError(
            "artifact verification evidence could not be written"
        ) from None
    finally:
        if file_descriptor is not None:
            os.close(file_descriptor)
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def validate_git_object_id(value: object) -> str:
    revision = _require_string(value, "Git revision")
    if FULL_GIT_OBJECT_ID_PATTERN.fullmatch(revision) is None:
        raise ArtifactDeliveryError(
            "Git revision must be a full lowercase 40- or 64-hex object id"
        )
    return revision


def _verified_release_manifest(
    release_directory: Path, descriptor: ReleaseDescriptor
) -> Mapping[str, object]:
    if release_directory.is_symlink() or not release_directory.is_dir():
        raise ArtifactDeliveryError("model release directory is missing or unsafe")
    release_directory = release_directory.resolve(strict=True)

    marker_path = release_directory / ".gatelm-release.json"
    manifest_path = release_directory / ".gatelm-manifest.json"
    _require_regular_release_file(marker_path, release_directory)
    _require_regular_release_file(manifest_path, release_directory)

    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise ArtifactDeliveryError("model release marker is invalid") from exc
    expected_marker = _release_marker(descriptor)
    if marker != expected_marker:
        raise ArtifactDeliveryError("model release marker does not match the pinned release")

    if manifest_path.stat().st_size != descriptor.bundle.manifest_bytes:
        raise ArtifactDeliveryError("installed model manifest size does not match its pin")
    if sha256_path(manifest_path) != descriptor.bundle.manifest_sha256:
        raise ArtifactDeliveryError("installed model manifest SHA-256 does not match its pin")
    try:
        manifest_payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise ArtifactDeliveryError("installed model manifest is invalid") from exc

    manifest = _require_mapping(manifest_payload, "model manifest")
    artifacts = _runtime_artifacts(manifest, descriptor)
    _require_exact_release_layout(release_directory, artifacts)
    for artifact in artifacts:
        artifact_path = release_directory.joinpath(
            artifact.model_directory, *artifact.relative_path.parts
        )
        _require_regular_release_file(artifact_path, release_directory)
        if artifact_path.stat().st_size != artifact.bytes:
            raise ArtifactDeliveryError("installed model artifact size does not match its pin")
        if sha256_path(artifact_path) != artifact.sha256:
            raise ArtifactDeliveryError("installed model artifact SHA-256 does not match its pin")
    return manifest


def _require_exact_release_layout(
    release_directory: Path,
    artifacts: tuple[RuntimeArtifact, ...],
) -> None:
    expected_files = {
        PurePosixPath(".gatelm-manifest.json"),
        PurePosixPath(".gatelm-release.json"),
    }
    expected_directories: set[PurePosixPath] = set()
    for artifact in artifacts:
        artifact_path = PurePosixPath(artifact.model_directory) / artifact.relative_path
        expected_files.add(artifact_path)
        parent = artifact_path.parent
        while parent != PurePosixPath("."):
            expected_directories.add(parent)
            parent = parent.parent

    actual_files: set[PurePosixPath] = set()
    actual_directories: set[PurePosixPath] = set()
    try:
        for current_root, directory_names, file_names in os.walk(
            release_directory, topdown=True, followlinks=False
        ):
            current = Path(current_root)
            for name in directory_names:
                child = current / name
                if child.is_symlink():
                    raise ArtifactDeliveryError(
                        "installed model release contains a symbolic link"
                    )
                actual_directories.add(
                    PurePosixPath(child.relative_to(release_directory).as_posix())
                )
            for name in file_names:
                child = current / name
                if child.is_symlink():
                    raise ArtifactDeliveryError(
                        "installed model release contains a symbolic link"
                    )
                actual_files.add(
                    PurePosixPath(child.relative_to(release_directory).as_posix())
                )
    except ArtifactDeliveryError:
        raise
    except OSError:
        raise ArtifactDeliveryError("installed model release layout could not be verified") from None

    if actual_files != expected_files or actual_directories != expected_directories:
        raise ArtifactDeliveryError(
            "installed model release contains unlisted or missing runtime paths"
        )


@contextmanager
def _verified_bundle_source(
    source: str | Path,
    workspace: Path,
    pin: BundlePin,
    *,
    timeout_seconds: int,
) -> Iterator[Path]:
    source_is_path = isinstance(source, Path)
    source_text = str(source).strip()
    if source_text == "":
        raise ArtifactDeliveryError("model bundle source is required")

    try:
        parsed = urllib.parse.urlsplit(source_text) if not source_is_path else None
    except ValueError:
        raise ArtifactDeliveryError("model bundle source is invalid") from None
    temporary_path: Path | None = None
    try:
        if source_is_path:
            bundle_path = source.expanduser().resolve()
        elif parsed is not None and parsed.scheme.lower() == "https":
            if parsed.hostname is None or parsed.username is not None or parsed.password is not None:
                raise ArtifactDeliveryError("HTTPS model bundle source is invalid")
            downloads = workspace / ".downloads"
            downloads.mkdir(parents=True, exist_ok=True)
            file_descriptor, name = tempfile.mkstemp(prefix=".bundle.", suffix=".part", dir=downloads)
            os.close(file_descriptor)
            temporary_path = Path(name)
            _download_https(
                source_text,
                temporary_path,
                pin,
                timeout_seconds=timeout_seconds,
            )
            bundle_path = temporary_path
        elif parsed is not None and parsed.scheme.lower() == "file":
            if parsed.netloc not in {"", "localhost"} or parsed.query or parsed.fragment:
                raise ArtifactDeliveryError("local model bundle source is invalid")
            local_path = urllib.request.url2pathname(urllib.parse.unquote(parsed.path))
            bundle_path = Path(local_path).expanduser().resolve()
        elif parsed is not None and parsed.scheme == "":
            bundle_path = Path(source_text).expanduser().resolve()
        else:
            raise ArtifactDeliveryError("model bundle source must use HTTPS or a local file")

        _verify_outer_bundle(bundle_path, pin)
        yield bundle_path
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _download_https(
    source: str,
    destination: Path,
    pin: BundlePin,
    *,
    timeout_seconds: int,
) -> None:
    try:
        request = urllib.request.Request(
            source,
            headers={"User-Agent": "GateLM-PII-Model-Sync/1"},
        )
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            final_url = urllib.parse.urlsplit(response.geturl())
            if (
                final_url.scheme.lower() != "https"
                or final_url.hostname is None
                or final_url.username is not None
                or final_url.password is not None
            ):
                raise ArtifactDeliveryError("HTTPS model bundle download redirected unsafely")
            content_length = response.headers.get("Content-Length")
            if content_length is not None:
                try:
                    advertised_bytes = int(content_length)
                except ValueError as exc:
                    raise ArtifactDeliveryError(
                        "HTTPS model bundle response has an invalid size"
                    ) from exc
                if advertised_bytes != pin.bytes:
                    raise ArtifactDeliveryError(
                        "HTTPS model bundle response size does not match its pin"
                    )

            digest = hashlib.sha256()
            written = 0
            with destination.open("wb") as output:
                for chunk in iter(lambda: response.read(COPY_CHUNK_BYTES), b""):
                    written += len(chunk)
                    if written > pin.bytes:
                        raise ArtifactDeliveryError(
                            "HTTPS model bundle exceeds its pinned size"
                        )
                    output.write(chunk)
                    digest.update(chunk)
            if written != pin.bytes or digest.hexdigest() != pin.sha256:
                raise ArtifactDeliveryError("HTTPS model bundle does not match its pin")
    except HTTPError as exc:
        raise ArtifactDeliveryError(
            f"HTTPS model bundle download failed with status {exc.code}"
        ) from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise ArtifactDeliveryError("HTTPS model bundle download failed") from None


def _verify_outer_bundle(bundle_path: Path, pin: BundlePin) -> None:
    try:
        if bundle_path.is_symlink() or not bundle_path.is_file():
            raise ArtifactDeliveryError("local model bundle file is missing or unsafe")
        if bundle_path.stat().st_size != pin.bytes:
            raise ArtifactDeliveryError("model bundle size does not match its pin")
        if sha256_path(bundle_path) != pin.sha256:
            raise ArtifactDeliveryError("model bundle SHA-256 does not match its pin")
    except ArtifactDeliveryError:
        raise
    except OSError:
        raise ArtifactDeliveryError("model bundle could not be verified") from None


def _extract_release(
    bundle_path: Path,
    staging_path: Path,
    descriptor: ReleaseDescriptor,
) -> None:
    try:
        with zipfile.ZipFile(bundle_path) as bundle:
            indexed = _archive_index(bundle)
            prefix, manifest, manifest_bytes = _pinned_manifest(bundle, indexed, descriptor)
            artifacts = _runtime_artifacts(manifest, descriptor)

            (staging_path / ".gatelm-manifest.json").write_bytes(manifest_bytes)
            for artifact in artifacts:
                source_name = str(
                    PurePosixPath(prefix)
                    / "models"
                    / artifact.model_directory
                    / artifact.relative_path
                )
                info = indexed.get(source_name)
                if info is None or info.is_dir():
                    raise ArtifactDeliveryError("pinned model artifact is missing from the bundle")
                if info.file_size != artifact.bytes:
                    raise ArtifactDeliveryError(
                        "model bundle artifact size does not match its manifest"
                    )
                destination = staging_path.joinpath(
                    artifact.model_directory, *artifact.relative_path.parts
                )
                destination.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(info, "r") as source, destination.open("xb") as output:
                    actual_bytes, actual_sha256 = _copy_and_hash(source, output, artifact.bytes)
                if actual_bytes != artifact.bytes or actual_sha256 != artifact.sha256:
                    raise ArtifactDeliveryError(
                        "model bundle artifact content does not match its manifest"
                    )

            marker = json.dumps(
                _release_marker(descriptor),
                ensure_ascii=True,
                sort_keys=True,
                separators=(",", ":"),
            )
            (staging_path / ".gatelm-release.json").write_text(
                marker + "\n", encoding="utf-8"
            )
    except ArtifactDeliveryError:
        raise
    except (zipfile.BadZipFile, RuntimeError, OSError, UnicodeDecodeError, json.JSONDecodeError):
        raise ArtifactDeliveryError("model bundle archive is invalid") from None


def _archive_index(bundle: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    indexed: dict[str, zipfile.ZipInfo] = {}
    for info in bundle.infolist():
        name = _normalized_archive_name(info.filename)
        if name in indexed:
            raise ArtifactDeliveryError("model bundle contains duplicate normalized paths")
        if info.flag_bits & 0x1:
            raise ArtifactDeliveryError("encrypted model bundle members are not supported")
        member_mode = (info.external_attr >> 16) & 0xFFFF
        if member_mode and stat.S_ISLNK(member_mode):
            raise ArtifactDeliveryError("model bundle contains a symbolic link")
        if info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
            raise ArtifactDeliveryError("model bundle uses an unsupported compression method")
        indexed[name] = info
    return indexed


def _pinned_manifest(
    bundle: zipfile.ZipFile,
    indexed: Mapping[str, zipfile.ZipInfo],
    descriptor: ReleaseDescriptor,
) -> tuple[str, object, bytes]:
    candidates = [
        name for name in indexed if name.endswith(descriptor.bundle.manifest_suffix)
    ]
    if len(candidates) != 1:
        raise ArtifactDeliveryError("model bundle must contain exactly one pinned manifest")
    manifest_name = candidates[0]
    info = indexed[manifest_name]
    if info.file_size != descriptor.bundle.manifest_bytes:
        raise ArtifactDeliveryError("model bundle manifest size does not match its pin")
    manifest_bytes = bundle.read(info)
    if hashlib.sha256(manifest_bytes).hexdigest() != descriptor.bundle.manifest_sha256:
        raise ArtifactDeliveryError("model bundle manifest SHA-256 does not match its pin")
    manifest = json.loads(manifest_bytes.decode("utf-8"))
    prefix = manifest_name[: -len(descriptor.bundle.manifest_suffix)]
    return prefix, manifest, manifest_bytes


def _runtime_artifacts(
    manifest_payload: object,
    descriptor: ReleaseDescriptor,
) -> tuple[RuntimeArtifact, ...]:
    manifest = _require_mapping(manifest_payload, "model manifest")
    if manifest.get("manifestVersion") != MANIFEST_VERSION:
        raise ArtifactDeliveryError("unsupported model bundle manifest version")
    models = manifest.get("models")
    if not isinstance(models, list) or not models:
        raise ArtifactDeliveryError("model bundle manifest has no models")

    artifacts: list[RuntimeArtifact] = []
    model_directories: list[str] = []
    targets: set[tuple[str, str]] = set()
    for model_payload in models:
        model = _require_mapping(model_payload, "model manifest entry")
        model_directory = _runtime_directory(model.get("runtimeDirectory"))
        if model_directory in model_directories:
            raise ArtifactDeliveryError("model bundle manifest contains duplicate model directories")
        model_directories.append(model_directory)
        files = model.get("files")
        if not isinstance(files, list) or not files:
            raise ArtifactDeliveryError("model bundle manifest model has no runtime files")
        for file_payload in files:
            file_pin = _require_mapping(file_payload, "model artifact pin")
            relative_path = _model_file_path(file_pin.get("path"))
            key = (model_directory, str(relative_path))
            if key in targets:
                raise ArtifactDeliveryError("model bundle manifest contains duplicate artifacts")
            targets.add(key)
            artifacts.append(
                RuntimeArtifact(
                    model_directory=model_directory,
                    relative_path=relative_path,
                    bytes=_require_positive_int(file_pin.get("bytes"), "model artifact bytes"),
                    sha256=_require_sha256(
                        file_pin.get("sha256"), "model artifact SHA-256"
                    ),
                )
            )

    if tuple(model_directories) != descriptor.runtime.model_directories:
        raise ArtifactDeliveryError("model bundle directories do not match the release pin")
    if len(artifacts) != descriptor.runtime.artifact_files:
        raise ArtifactDeliveryError("model bundle file count does not match the release pin")
    if sum(artifact.bytes for artifact in artifacts) != descriptor.runtime.artifact_bytes:
        raise ArtifactDeliveryError("model bundle artifact bytes do not match the release pin")
    return tuple(artifacts)


def _copy_and_hash(
    source: BinaryIO,
    destination: BinaryIO,
    expected_bytes: int,
) -> tuple[int, str]:
    digest = hashlib.sha256()
    written = 0
    for chunk in iter(lambda: source.read(COPY_CHUNK_BYTES), b""):
        written += len(chunk)
        if written > expected_bytes:
            raise ArtifactDeliveryError("model bundle artifact exceeds its pinned size")
        destination.write(chunk)
        digest.update(chunk)
    return written, digest.hexdigest()


def _release_marker(descriptor: ReleaseDescriptor) -> dict[str, object]:
    return {
        "descriptorVersion": DESCRIPTOR_VERSION,
        "releaseId": descriptor.release_id,
        "bundleSha256": descriptor.bundle.sha256,
        "manifestSha256": descriptor.bundle.manifest_sha256,
        "artifactFiles": descriptor.runtime.artifact_files,
        "artifactBytes": descriptor.runtime.artifact_bytes,
    }


def _require_regular_release_file(path: Path, release_directory: Path) -> None:
    try:
        resolved_release = release_directory.resolve(strict=True)
        resolved_path = path.resolve(strict=True)
        resolved_path.relative_to(resolved_release)
    except (FileNotFoundError, OSError, ValueError):
        raise ArtifactDeliveryError("installed model release contains a missing or unsafe path") from None
    current = path
    while current != release_directory:
        if current.is_symlink():
            raise ArtifactDeliveryError("installed model release contains a symbolic link")
        current = current.parent
    if path.is_symlink() or not path.is_file():
        raise ArtifactDeliveryError("installed model release artifact is not a regular file")


def _normalized_archive_name(value: str) -> str:
    normalized = value.replace("\\", "/")
    path = PurePosixPath(normalized)
    if not path.parts or path.is_absolute() or ".." in path.parts:
        raise ArtifactDeliveryError("model bundle contains an unsafe member path")
    return str(path)


def _runtime_directory(value: object) -> str:
    path = PurePosixPath(_require_string(value, "runtime directory").replace("\\", "/"))
    if path.is_absolute() or ".." in path.parts or len(path.parts) != 2:
        raise ArtifactDeliveryError("model bundle runtime directory is unsafe")
    if path.parts[0] != "models":
        raise ArtifactDeliveryError("model bundle runtime directory is outside models")
    return _require_directory_name(path.parts[1], "runtime model directory")


def _model_file_path(value: object) -> PurePosixPath:
    path = PurePosixPath(_require_string(value, "model artifact path").replace("\\", "/"))
    if not path.parts or path.is_absolute() or ".." in path.parts:
        raise ArtifactDeliveryError("model bundle artifact path is unsafe")
    return path


def _validate_release_id(value: str) -> None:
    if RELEASE_ID_PATTERN.fullmatch(value) is None:
        raise ArtifactDeliveryError("model release id is invalid")


def _require_mapping(value: object, name: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ArtifactDeliveryError(f"{name} must be an object")
    return value


def _require_string(value: object, name: str) -> str:
    if not isinstance(value, str) or value.strip() == "":
        raise ArtifactDeliveryError(f"{name} must be a non-empty string")
    return value.strip()


def _require_bounded_string(value: object, name: str) -> str:
    text = _require_string(value, name)
    if len(text) > 200:
        raise ArtifactDeliveryError(f"{name} must contain at most 200 characters")
    return text


def _require_positive_int(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ArtifactDeliveryError(f"{name} must be a positive integer")
    return value


def _require_sha256(value: object, name: str) -> str:
    digest = _require_string(value, name)
    if SHA256_PATTERN.fullmatch(digest) is None:
        raise ArtifactDeliveryError(f"{name} must be a lowercase hexadecimal digest")
    return digest


def _require_safe_suffix(value: object, name: str) -> str:
    suffix = _require_string(value, name).replace("\\", "/")
    path = PurePosixPath(suffix)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ArtifactDeliveryError(f"{name} is unsafe")
    return str(path)


def _require_directory_name(value: object, name: str) -> str:
    directory = _require_string(value, name)
    path = PurePosixPath(directory)
    if len(path.parts) != 1 or path.parts[0] in {".", ".."}:
        raise ArtifactDeliveryError(f"{name} must be one safe path segment")
    return directory


def _require_directory_list(
    value: object,
    name: str,
    *,
    allow_empty: bool = False,
) -> tuple[str, ...]:
    if not isinstance(value, list) or (not value and not allow_empty):
        raise ArtifactDeliveryError(f"{name} must be a list")
    directories = tuple(_require_directory_name(item, name) for item in value)
    if len(set(directories)) != len(directories):
        raise ArtifactDeliveryError(f"{name} contains duplicates")
    return directories
