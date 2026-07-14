import copy
import json
import tempfile
import unittest
from pathlib import Path

from gatelm_difficulty_model.encoder_artifacts import (
    DEFAULT_CONFIG,
    canonical_hash,
    load_and_verify_manifest,
    load_candidate_config,
    sha256_file,
)


class EncoderArtifactTest(unittest.TestCase):
    def test_candidate_config_pins_three_immutable_safe_candidates(self) -> None:
        config = load_candidate_config(DEFAULT_CONFIG)

        self.assertGreaterEqual(len(config["candidates"]), 3)
        self.assertEqual(config["status"], "provisional_offline_only")
        self.assertTrue(all(len(item["sourceRevision"]) == 40 for item in config["candidates"]))
        self.assertTrue(all(item["license"] in {"apache-2.0", "mit"} for item in config["candidates"]))
        source_paths = [
            source["path"]
            for candidate in config["candidates"]
            for source in candidate["sourceFiles"]
        ]
        self.assertNotIn("pytorch_model.bin", source_paths)

    def test_rejects_mutable_revision(self) -> None:
        config = json.loads(DEFAULT_CONFIG.read_text(encoding="utf-8"))
        config["candidates"][0]["sourceRevision"] = "main"
        with tempfile.TemporaryDirectory() as value:
            path = Path(value) / "candidates.json"
            path.write_text(json.dumps(config), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "mutable or invalid revision"):
                load_candidate_config(path)

    def test_rejects_unapproved_empty_or_special_token_policy(self) -> None:
        config = json.loads(DEFAULT_CONFIG.read_text(encoding="utf-8"))
        truncation = config["benchmarkProtocol"]["truncation"]
        truncation["emptyOrSpecialTokenOnly"] = "zero_representation_without_encoder_call"
        with tempfile.TemporaryDirectory() as value:
            path = Path(value) / "candidates.json"
            path.write_text(json.dumps(config), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "empty semantic input"):
                load_candidate_config(path)

        config = json.loads(DEFAULT_CONFIG.read_text(encoding="utf-8"))
        config["benchmarkProtocol"]["truncation"]["specialTokenTreatment"] = "tokenizer_default"
        with tempfile.TemporaryDirectory() as value:
            path = Path(value) / "candidates.json"
            path.write_text(json.dumps(config), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "special-token treatment"):
                load_candidate_config(path)

    def test_artifact_hash_mismatch_is_rejected(self) -> None:
        config = load_candidate_config(DEFAULT_CONFIG)
        candidate = copy.deepcopy(config["candidates"][0])
        with tempfile.TemporaryDirectory() as value:
            root = Path(value)
            config_path = root / "config.json"
            config_path.write_text(DEFAULT_CONFIG.read_text(encoding="utf-8"), encoding="utf-8")
            directory = root / candidate["candidateId"] / candidate["sourceRevision"]
            directory.mkdir(parents=True)
            artifact = directory / "dummy.onnx"
            artifact.write_bytes(b"frozen")
            items = [
                {
                    "role": "encoder_onnx_fp32",
                    "relativePath": "dummy.onnx",
                    "sha256": sha256_file(artifact),
                    "sizeBytes": artifact.stat().st_size,
                    "source": "unit_test",
                }
            ]
            manifest = {
                "schemaVersion": "gatelm.difficulty-semantic-encoder-artifact-manifest.v1",
                "candidateId": candidate["candidateId"],
                "sourceModelId": candidate["sourceModelId"],
                "sourceRevision": candidate["sourceRevision"],
                "candidateConfigSha256": sha256_file(config_path),
                "artifacts": items,
                "artifactSetSha256": canonical_hash(items),
            }
            manifest["manifestSha256"] = canonical_hash(manifest)
            (directory / "artifact-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

            load_and_verify_manifest(candidate, root, config_path)
            artifact.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "hash or size mismatch"):
                load_and_verify_manifest(candidate, root, config_path)


if __name__ == "__main__":
    unittest.main()
