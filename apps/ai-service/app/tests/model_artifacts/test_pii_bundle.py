from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import subprocess
import tempfile
import unittest
import zipfile
from dataclasses import replace
from pathlib import Path
from unittest import mock
from urllib.error import URLError

from app.model_artifacts import cli
from app.model_artifacts.pii_bundle import (
    ArtifactDeliveryError,
    BundlePin,
    ReleaseDescriptor,
    RuntimePin,
    build_artifact_verification_evidence,
    sync_release,
    write_artifact_verification_evidence,
)


RELEASE_ID = "tenant-chat-pii-models-test"
MODEL_DIRECTORY = "synthetic--privacy-model"
PREFIX = "synthetic-bundle"
MANIFEST_SUFFIX = "docs/pii-model-manifest-test.json"


class FixtureBundle:
    def __init__(
        self,
        root: Path,
        *,
        artifact_payload: bytes = b"verified-model",
        archived_artifact_payload: bytes | None = None,
        extra_members: tuple[tuple[str, bytes], ...] = (),
    ) -> None:
        artifact_sha = hashlib.sha256(artifact_payload).hexdigest()
        self.manifest_bytes = json.dumps(
            {
                "manifestVersion": "tenant-chat-pii-models.v1",
                "models": [
                    {
                        "modelId": "synthetic/privacy-model",
                        "revision": "test-revision",
                        "runtimeDirectory": f"models/{MODEL_DIRECTORY}",
                        "files": [
                            {
                                "path": "model.onnx",
                                "bytes": len(artifact_payload),
                                "sha256": artifact_sha,
                            }
                        ],
                    }
                ],
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        self.path = root / "bundle.zip"
        with zipfile.ZipFile(self.path, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            bundle.writestr(f"{PREFIX}/{MANIFEST_SUFFIX}", self.manifest_bytes)
            bundle.writestr(
                f"{PREFIX}/models/{MODEL_DIRECTORY}/model.onnx",
                archived_artifact_payload
                if archived_artifact_payload is not None
                else artifact_payload,
            )
            bundle.writestr(f"{PREFIX}/reports/not-runtime.txt", b"must-not-extract")
            for name, payload in extra_members:
                bundle.writestr(name, payload)
        self.descriptor = ReleaseDescriptor(
            release_id=RELEASE_ID,
            bundle=BundlePin(
                bytes=self.path.stat().st_size,
                sha256=_sha256(self.path.read_bytes()),
                manifest_suffix=MANIFEST_SUFFIX,
                manifest_bytes=len(self.manifest_bytes),
                manifest_sha256=_sha256(self.manifest_bytes),
            ),
            runtime=RuntimePin(
                artifact_files=1,
                artifact_bytes=len(artifact_payload),
                model_directories=(MODEL_DIRECTORY,),
                primary_model_directory=MODEL_DIRECTORY,
                additional_model_directories=(),
            ),
        )


class PiiBundleSyncTests(unittest.TestCase):
    def test_installs_only_pinned_runtime_files_and_reverifies_idempotently(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = FixtureBundle(root)
            runtime_root = root / "runtime"

            self.assertEqual(
                sync_release(fixture.path, runtime_root, descriptor=fixture.descriptor),
                "installed",
            )
            release = runtime_root / "releases" / RELEASE_ID
            self.assertEqual(
                (release / MODEL_DIRECTORY / "model.onnx").read_bytes(),
                b"verified-model",
            )
            self.assertFalse((release / "reports").exists())

            fixture.path.unlink()
            self.assertEqual(
                sync_release(
                    "https://artifacts.invalid/private.zip?signature=do-not-log",
                    runtime_root,
                    descriptor=fixture.descriptor,
                ),
                "verified",
            )

    def test_writes_only_aggregate_promotion_bound_integrity_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = FixtureBundle(root)
            runtime_root = root / "runtime"
            sync_release(fixture.path, runtime_root, descriptor=fixture.descriptor)
            release = runtime_root / "releases" / RELEASE_ID
            evidence_path = root / "evidence" / "artifact-verification.json"

            write_artifact_verification_evidence(
                evidence_path,
                release,
                fixture.descriptor,
                git_revision="a" * 40,
            )

            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
            self.assertEqual(
                evidence,
                {
                    "schemaVersion": "pii-artifact-verification.v1",
                    "aggregateOnly": True,
                    "filesExpected": 1,
                    "filesVerified": 1,
                    "checksumFailures": 0,
                    "evidenceBinding": {
                        "schemaVersion": "pii-promotion-evidence-binding.v1",
                        "manifestVersion": "tenant-chat-pii-models.v1",
                        "modelRevisions": {
                            "synthetic/privacy-model": "test-revision"
                        },
                        "artifactChecksumsVerified": True,
                        "gitRevision": "a" * 40,
                    },
                },
            )
            serialized = json.dumps(evidence, sort_keys=True)
            self.assertNotIn(fixture.descriptor.bundle.sha256, serialized)
            self.assertNotIn(fixture.descriptor.bundle.manifest_sha256, serialized)
            self.assertNotIn("model.onnx", serialized)
            self.assertNotIn(str(root), serialized)
            self.assertNotIn("https://", serialized)

    def test_aggregate_evidence_requires_a_safe_bounded_git_revision(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = FixtureBundle(root)
            runtime_root = root / "runtime"
            sync_release(fixture.path, runtime_root, descriptor=fixture.descriptor)
            release = runtime_root / "releases" / RELEASE_ID

            for valid_revision in ("a" * 40, "b" * 64):
                with self.subTest(valid_revision_length=len(valid_revision)):
                    evidence = build_artifact_verification_evidence(
                        release,
                        fixture.descriptor,
                        git_revision=valid_revision,
                    )
                    self.assertEqual(
                        evidence["evidenceBinding"]["gitRevision"], valid_revision
                    )

            for invalid_revision in (
                "",
                "main",
                "a" * 39,
                "A" * 40,
                "https://credential.invalid",
                "x" * 64,
            ):
                with self.subTest(invalid_revision=invalid_revision[:20]):
                    with self.assertRaises(ArtifactDeliveryError):
                        build_artifact_verification_evidence(
                            release,
                            fixture.descriptor,
                            git_revision=invalid_revision,
                        )

    def test_failed_reverification_does_not_replace_existing_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = FixtureBundle(root)
            runtime_root = root / "runtime"
            sync_release(fixture.path, runtime_root, descriptor=fixture.descriptor)
            release = runtime_root / "releases" / RELEASE_ID
            evidence_path = root / "artifact-verification.json"
            sentinel = b'{"previousEvidence":true}\n'
            evidence_path.write_bytes(sentinel)
            (release / MODEL_DIRECTORY / "model.onnx").write_bytes(b"tampered")

            with self.assertRaises(ArtifactDeliveryError):
                write_artifact_verification_evidence(
                    evidence_path,
                    release,
                    fixture.descriptor,
                    git_revision="a" * 40,
                )

            self.assertEqual(evidence_path.read_bytes(), sentinel)

    def test_outer_bundle_mismatch_leaves_no_release(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = FixtureBundle(root)
            fixture.path.write_bytes(fixture.path.read_bytes() + b"tampered")
            runtime_root = root / "runtime"

            with self.assertRaisesRegex(ArtifactDeliveryError, "size does not match"):
                sync_release(fixture.path, runtime_root, descriptor=fixture.descriptor)
            self.assertFalse((runtime_root / "releases" / RELEASE_ID).exists())

    def test_embedded_manifest_must_match_separate_release_pin(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = FixtureBundle(root)
            wrong_bundle_pin = replace(
                fixture.descriptor.bundle,
                manifest_sha256="0" * 64,
            )
            descriptor = replace(fixture.descriptor, bundle=wrong_bundle_pin)

            with self.assertRaisesRegex(ArtifactDeliveryError, "manifest SHA-256"):
                sync_release(fixture.path, root / "runtime", descriptor=descriptor)

    def test_artifact_content_must_match_embedded_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = FixtureBundle(
                root,
                artifact_payload=b"expected-model",
                archived_artifact_payload=b"tampered-model",
            )

            with self.assertRaisesRegex(ArtifactDeliveryError, "artifact content"):
                sync_release(fixture.path, root / "runtime", descriptor=fixture.descriptor)
            self.assertFalse((root / "runtime" / "releases" / RELEASE_ID).exists())

    def test_unsafe_unlisted_archive_member_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = FixtureBundle(root, extra_members=(("../escape.txt", b"unsafe"),))

            with self.assertRaisesRegex(ArtifactDeliveryError, "unsafe member path"):
                sync_release(fixture.path, root / "runtime", descriptor=fixture.descriptor)
            self.assertFalse((root / "escape.txt").exists())

    def test_duplicate_normalized_archive_member_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            duplicate = f"{PREFIX}\\reports\\not-runtime.txt"
            fixture = FixtureBundle(root, extra_members=((duplicate, b"duplicate"),))

            with self.assertRaisesRegex(ArtifactDeliveryError, "duplicate normalized"):
                sync_release(fixture.path, root / "runtime", descriptor=fixture.descriptor)

    def test_corrupt_existing_release_fails_closed_without_downloading(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = FixtureBundle(root)
            runtime_root = root / "runtime"
            sync_release(fixture.path, runtime_root, descriptor=fixture.descriptor)
            artifact = runtime_root / "releases" / RELEASE_ID / MODEL_DIRECTORY / "model.onnx"
            artifact.write_bytes(b"same-size-wrong!")
            secret_source = "https://artifacts.invalid/private.zip?signature=credential"

            with mock.patch(
                "app.model_artifacts.pii_bundle.urllib.request.urlopen"
            ) as urlopen:
                with self.assertRaises(ArtifactDeliveryError) as captured:
                    sync_release(secret_source, runtime_root, descriptor=fixture.descriptor)
            urlopen.assert_not_called()
            self.assertNotIn("signature", str(captured.exception))
            self.assertNotIn("credential", str(captured.exception))

    def test_existing_release_rejects_unlisted_runtime_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = FixtureBundle(root)
            runtime_root = root / "runtime"
            sync_release(fixture.path, runtime_root, descriptor=fixture.descriptor)
            release = runtime_root / "releases" / RELEASE_ID
            (release / MODEL_DIRECTORY / "unlisted-model.bin").write_bytes(b"unexpected")

            with self.assertRaisesRegex(
                ArtifactDeliveryError, "unlisted or missing runtime paths"
            ):
                sync_release(
                    "https://artifacts.invalid/private.zip?signature=credential",
                    runtime_root,
                    descriptor=fixture.descriptor,
                )

    def test_http_source_is_rejected_without_echoing_the_source(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fixture = FixtureBundle(Path(temporary))
            source = "http://artifacts.invalid/bundle.zip?token=credential"
            with self.assertRaises(ArtifactDeliveryError) as captured:
                sync_release(source, Path(temporary) / "runtime", descriptor=fixture.descriptor)
            message = str(captured.exception)
            self.assertIn("HTTPS or a local file", message)
            self.assertNotIn("token", message)
            self.assertNotIn("credential", message)

    def test_https_transport_error_does_not_echo_presigned_query(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fixture = FixtureBundle(Path(temporary))
            source = "https://artifacts.invalid/bundle.zip?signature=credential"
            with mock.patch(
                "app.model_artifacts.pii_bundle.urllib.request.urlopen",
                side_effect=URLError(source),
            ):
                with self.assertRaises(ArtifactDeliveryError) as captured:
                    sync_release(source, Path(temporary) / "runtime", descriptor=fixture.descriptor)
            message = str(captured.exception)
            self.assertEqual(message, "HTTPS model bundle download failed")
            self.assertNotIn("signature", message)
            self.assertNotIn("credential", message)

    def test_https_download_accepts_pinned_content_without_exposing_source(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = FixtureBundle(root)
            response = _HttpsResponse(
                fixture.path.read_bytes(),
                "https://cdn.invalid/pinned-bundle.zip",
            )
            source = "https://artifacts.invalid/bundle.zip?signature=credential"
            with mock.patch(
                "app.model_artifacts.pii_bundle.urllib.request.urlopen",
                return_value=response,
            ):
                self.assertEqual(
                    sync_release(source, root / "runtime", descriptor=fixture.descriptor),
                    "installed",
                )

    def test_https_redirect_rejects_userinfo_without_echoing_it(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = FixtureBundle(root)
            response = _HttpsResponse(
                fixture.path.read_bytes(),
                "https://private-user:private-pass@cdn.invalid/pinned-bundle.zip",
            )
            with mock.patch(
                "app.model_artifacts.pii_bundle.urllib.request.urlopen",
                return_value=response,
            ):
                with self.assertRaises(ArtifactDeliveryError) as captured:
                    sync_release(
                        "https://artifacts.invalid/bundle.zip?signature=credential",
                        root / "runtime",
                        descriptor=fixture.descriptor,
                    )
            message = str(captured.exception)
            self.assertIn("redirected unsafely", message)
            self.assertNotIn("private-user", message)
            self.assertNotIn("private-pass", message)


class PiiModelSyncCliTests(unittest.TestCase):
    def test_disabled_sync_does_not_require_or_read_a_secret(self) -> None:
        stderr = io.StringIO()
        stdout = io.StringIO()
        with mock.patch.dict(os.environ, {}, clear=True):
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                self.assertEqual(cli.main(["--no-enabled"]), 0)
        self.assertIn("feature is disabled", stdout.getvalue())
        self.assertEqual(stderr.getvalue(), "")

    def test_source_secret_requires_exactly_one_non_comment_line(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            secret = Path(temporary) / "source"
            secret.write_text("# disabled by default\n", encoding="utf-8")
            with self.assertRaisesRegex(ArtifactDeliveryError, "exactly one source"):
                cli._read_source_secret(secret)
            secret.write_text("https://one.invalid/a\nhttps://two.invalid/b\n", encoding="utf-8")
            with self.assertRaisesRegex(ArtifactDeliveryError, "exactly one source"):
                cli._read_source_secret(secret)

    def test_aggregate_evidence_output_requires_git_revision_binding(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "artifact-verification.json"
            with mock.patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(ArtifactDeliveryError, "provided together"):
                    cli.main(["--enabled", "--evidence-out", str(output)])

            with mock.patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(ArtifactDeliveryError, "full lowercase"):
                    cli.main(
                        [
                            "--enabled",
                            "--evidence-out",
                            str(output),
                            "--git-revision",
                            "main",
                        ]
                    )


class SelfhostSecretPermissionTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "posix", "Bash self-host checks require POSIX paths")
    def test_install_fails_before_docker_when_ml_dependencies_are_disabled(self) -> None:
        repository_root = Path(__file__).resolve().parents[5]
        install_script = repository_root / "deploy" / "selfhost" / "scripts" / "install.sh"
        with tempfile.TemporaryDirectory() as temporary:
            env_file = Path(temporary) / ".env"
            env_file.write_text(
                "\n".join(
                    [
                        "GATELM_IMAGE_REGISTRY=gatelm",
                        "GATELM_IMAGE_TAG=test",
                        "GATELM_PUBLIC_BASE_URL=https://gatelm.invalid",
                        "SELFHOST_WEB_PORT=3000",
                        "SELFHOST_CONTROL_PLANE_PORT=3001",
                        "SELFHOST_GATEWAY_PORT=8080",
                        "SELFHOST_AI_SERVICE_PORT=8001",
                        "SELFHOST_POSTGRES_PORT=5432",
                        "SELFHOST_REDIS_PORT=6379",
                        "SELFHOST_MOCK_PROVIDER_PORT=8090",
                        "POSTGRES_USER=gatelm",
                        "POSTGRES_PASSWORD=local-password",
                        "POSTGRES_DB=gatelm",
                        "TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN=0123456789abcdef0123456789abcdef",
                        "GATEWAY_OBSERVABILITY_INTERNAL_TOKEN=0123456789abcdef0123456789abcdef",
                        "GATEWAY_EXACT_CACHE_KEY_SECRET=local-cache-secret",
                        "GATELM_DEMO_API_KEY=local-api-key",
                        "GATELM_DEMO_APP_TOKEN=local-app-token",
                        "TENANT_CHAT_RAG_ENABLED=false",
                        "GATEWAY_AI_SAFETY_SIDECAR_ENABLED=true",
                        "AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED=true",
                        "AI_SERVICE_INSTALL_ML_DEPS=false",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            completed = subprocess.run(
                ["bash", str(install_script)],
                env={**os.environ, "SELFHOST_ENV_FILE": str(env_file)},
                capture_output=True,
                text=True,
            )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("AI_SERVICE_INSTALL_ML_DEPS must be true", completed.stderr)
        self.assertNotIn("Docker is", completed.stderr)

    @unittest.skipUnless(os.name == "posix", "Bash self-host checks require POSIX paths")
    def test_model_preload_requires_ml_dependency_image_flag(self) -> None:
        repository_root = Path(__file__).resolve().parents[5]
        library = repository_root / "deploy" / "selfhost" / "scripts" / "lib.sh"
        accepted = subprocess.run(
            [
                "bash",
                "-c",
                'source "$1"; gatelm_require_true_env AI_SERVICE_INSTALL_ML_DEPS "ML deps required"',
                "bash",
                str(library),
            ],
            env={**os.environ, "AI_SERVICE_INSTALL_ML_DEPS": "true"},
            capture_output=True,
            text=True,
        )
        self.assertEqual(accepted.returncode, 0, accepted.stderr)

        rejected = subprocess.run(
            [
                "bash",
                "-c",
                'source "$1"; gatelm_require_true_env AI_SERVICE_INSTALL_ML_DEPS "ML deps required"',
                "bash",
                str(library),
            ],
            env={**os.environ, "AI_SERVICE_INSTALL_ML_DEPS": "false"},
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn("ML deps required", rejected.stderr)

    def test_linux_secret_rejects_group_or_other_permissions(self) -> None:
        if os.name != "posix":
            self.skipTest("POSIX permission evidence is Linux/macOS specific")
        repository_root = Path(__file__).resolve().parents[5]
        library = repository_root / "deploy" / "selfhost" / "scripts" / "lib.sh"
        with tempfile.TemporaryDirectory() as temporary:
            secret = Path(temporary) / "source"
            secret.write_text("https://artifacts.invalid/private\n", encoding="utf-8")
            secret.chmod(0o600)
            accepted = subprocess.run(
                [
                    "bash",
                    "-c",
                    'source "$1"; gatelm_require_private_file "$2" "private file required"',
                    "bash",
                    str(library),
                    str(secret),
                ],
                capture_output=True,
                text=True,
            )
            self.assertEqual(accepted.returncode, 0, accepted.stderr)

            secret.chmod(0o640)
            rejected = subprocess.run(
                [
                    "bash",
                    "-c",
                    'source "$1"; gatelm_require_private_file "$2" "private file required"',
                    "bash",
                    str(library),
                    str(secret),
                ],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("chmod 600", rejected.stderr)
            self.assertNotIn(str(secret), rejected.stderr)


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


class _HttpsResponse:
    def __init__(self, payload: bytes, final_url: str) -> None:
        self._stream = io.BytesIO(payload)
        self._final_url = final_url
        self.headers = {"Content-Length": str(len(payload))}

    def __enter__(self) -> _HttpsResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def geturl(self) -> str:
        return self._final_url

    def read(self, size: int = -1) -> bytes:
        return self._stream.read(size)


if __name__ == "__main__":
    unittest.main()
