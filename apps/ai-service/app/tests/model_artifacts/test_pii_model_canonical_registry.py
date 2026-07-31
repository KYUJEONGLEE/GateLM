from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path

from app.services import pii_direct_inference_concurrency_benchmark_runner as runner


REPO_ROOT = Path(__file__).resolve().parents[5]
REGISTRY_PATH = (
    REPO_ROOT
    / "apps"
    / "ai-service"
    / "app"
    / "model_artifacts"
    / "releases"
    / "pii-model-canonical-registry.json"
)


class PiiModelCanonicalRegistryTests(unittest.TestCase):
    def test_registry_binds_v36_and_v314_to_canonical_versions(self) -> None:
        registry = runner.load_canonical_model_registry(REGISTRY_PATH)
        entries = {
            entry["canonicalVersion"]: entry
            for entry in registry["entries"]
        }

        self.assertEqual(
            registry["modelId"],
            "gatelm/koelectra-small-v3-pii-ner",
        )
        self.assertEqual(set(entries), {"v0.1.0", "v0.1.1"})
        self.assertEqual(entries["v0.1.0"]["legacyRevision"], "v3.6")
        self.assertEqual(entries["v0.1.1"]["legacyRevision"], "v3.14")
        self.assertEqual(
            model_file(entries["v0.1.0"])["sha256"],
            "dfd9b29ea35974d91d866817d70905844ffd4c65ecda98d8ac2085869ba9f410",
        )
        self.assertEqual(
            model_file(entries["v0.1.1"])["sha256"],
            "8a5cb146e84d413910a423d304e662a6aba9f69e83db129f5061d007a6de9381",
        )

    def test_registry_source_manifest_hashes_match_checked_in_files(self) -> None:
        registry = runner.load_canonical_model_registry(REGISTRY_PATH)

        for entry in registry["entries"]:
            for source in entry["sourceManifests"]:
                source_path = REPO_ROOT / source["path"]
                self.assertTrue(source_path.is_file(), source["path"])
                self.assertEqual(
                    sha256_file(source_path),
                    source["sha256"],
                    source["path"],
                )

    def test_registry_file_sets_match_runtime_sha_manifests(self) -> None:
        registry = runner.load_canonical_model_registry(REGISTRY_PATH)
        entries = {
            entry["legacyRevision"]: entry
            for entry in registry["entries"]
        }
        runtime_manifests = {
            "v3.6": REPO_ROOT
            / "deploy"
            / "aws-triage"
            / "pii-v36-model-manifest.sha256",
            "v3.14": REPO_ROOT
            / "deploy"
            / "aws-triage"
            / "pii-v314-model-manifest.sha256",
        }

        for legacy_revision, manifest_path in runtime_manifests.items():
            expected = parse_sha_manifest(manifest_path)
            actual = {
                file_entry["path"]: file_entry["sha256"]
                for file_entry in entries[legacy_revision]["files"]
            }
            self.assertEqual(actual, expected)

    def test_v314_registry_matches_package_manifest_bytes_and_hashes(self) -> None:
        registry = runner.load_canonical_model_registry(REGISTRY_PATH)
        v314 = next(
            entry
            for entry in registry["entries"]
            if entry["canonicalVersion"] == "v0.1.1"
        )
        package_manifest = json.loads(
            (
                REPO_ROOT
                / "docs"
                / "ai-safety-lab"
                / "pii-model-manifest-v314-20260721.json"
            ).read_text(encoding="utf-8")
        )
        package_files = {
            file_entry["path"]: (
                file_entry["bytes"],
                file_entry["sha256"],
            )
            for file_entry in package_manifest["models"][0]["files"]
        }
        registry_files = {
            file_entry["path"]: (
                file_entry["bytes"],
                file_entry["sha256"],
            )
            for file_entry in v314["files"]
        }

        for path, expected in package_files.items():
            self.assertEqual(registry_files[path], expected, path)


def model_file(entry: dict) -> dict:
    return next(
        file_entry
        for file_entry in entry["files"]
        if file_entry["path"] == "model.onnx"
    )


def parse_sha_manifest(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        sha256, relative_path = line.split(maxsplit=1)
        values[relative_path] = sha256
    return values


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    unittest.main()
