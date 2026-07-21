from __future__ import annotations

import contextlib
import gc
import hashlib
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.domain.routing_lightgbm_shadow.runtime import (
    RoutingLightGBMShadowRuntime,
    RoutingLightGBMShadowRuntimeError,
)
from app.main import create_app
from app.schemas.routing_difficulty import RULE_VECTOR_DIMENSION, RULE_VECTOR_VERSION
from app.schemas.routing_lightgbm_shadow import CONTRACT_VERSION


REPOSITORY_ROOT = Path(__file__).resolve().parents[5]
OUTPUT_ROOT = REPOSITORY_ROOT / (
    "scripts/routing_difficulty_model/artifacts/"
    "lightgbm-four-way-owner-approved-500"
)
SMALL_SOURCE_ROOT = REPOSITORY_ROOT / ".tmp/difficulty-semantic-encoder-artifacts"
BASE_SOURCE_ROOT = REPOSITORY_ROOT / ".tmp/difficulty-lightgbm-e5-base-artifacts"
SMALL_MANIFEST_SOURCE = REPOSITORY_ROOT / (
    "scripts/routing_difficulty_model/artifacts/"
    "difficulty-e5-encoder-manifest.v2.json"
)
SMALL_PCA_SOURCE = REPOSITORY_ROOT / (
    "scripts/routing_difficulty_model/artifacts/difficulty-e5-pca-64.v2.npz"
)
SEMANTIC_HEADS_SOURCE = REPOSITORY_ROOT / (
    "scripts/routing_difficulty_model/artifacts/candidates/"
    "difficulty-semantic-heads.owner-approved-500.v2.json"
)
SERVICE_TOKEN = "0123456789abcdef0123456789abcdef"
INSTRUCTION = "Design a bounded retry workflow with two constraints."
PROFILES = {
    "rule_42_plus_e5_small_pca_64": 106,
    "rule_42_plus_semantic_heads_12": 54,
    "e5_base_raw_768": 768,
    "rule_42_plus_e5_base_raw_768": 810,
}


class RoutingLightGBMShadowRealArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        missing_packages = [
            name
            for name in ("lightgbm", "numpy", "onnxruntime", "transformers")
            if importlib.util.find_spec(name) is None
        ]
        if missing_packages:
            raise unittest.SkipTest(
                "real routing LightGBM dependencies are unavailable: "
                + ", ".join(missing_packages)
            )
        missing = []
        for candidate in PROFILES:
            for suffix in (".lightgbm.txt", ".shadow-profile.v1.json"):
                path = OUTPUT_ROOT / f"{candidate}{suffix}"
                if not path.is_file():
                    missing.append(path)
        for path in (
            SMALL_MANIFEST_SOURCE,
            SMALL_PCA_SOURCE,
            SEMANTIC_HEADS_SOURCE,
        ):
            if not path.is_file():
                missing.append(path)
        for profile_name, source_root in (
            ("rule_42_plus_e5_small_pca_64", SMALL_SOURCE_ROOT),
            ("e5_base_raw_768", BASE_SOURCE_ROOT),
        ):
            profile = _read_profile(profile_name)
            encoder_root = source_root / profile["encoder"]["artifactDirectory"]
            for entry in profile["encoder"]["runtimeArtifacts"]:
                path = encoder_root / entry["relativePath"]
                if not path.is_file():
                    missing.append(path)
        if missing:
            raise unittest.SkipTest(
                "hydrated E5 runtime artifacts are unavailable: "
                + ", ".join(str(path) for path in missing[:3])
            )

    def test_all_four_profiles_run_actual_float32_inference(self) -> None:
        for candidate, dimension in PROFILES.items():
            with self.subTest(candidate=candidate), _staged_profile(
                candidate
            ) as staged:
                runtime = _runtime(staged)
                rule_vector = _rule_vector()
                pooled = runtime._encode_many([INSTRUCTION], [rule_vector])
                features = runtime._material.build_features(
                    pooled, [rule_vector]
                )
                prediction = runtime.classify(INSTRUCTION, rule_vector)
                self.assertEqual(features.shape, (1, dimension))
                self.assertEqual(str(features.dtype), "float32")
                self.assertEqual(runtime._material.booster.num_feature(), dimension)
                self.assertTrue(0 <= prediction.score <= 1)
                self.assertIn(prediction.difficulty, {"simple", "complex"})
                del runtime, pooled, features
                gc.collect()

    def test_small_profiles_start_full_app_and_keep_endpoint_bounded(self) -> None:
        for candidate in (
            "rule_42_plus_e5_small_pca_64",
            "rule_42_plus_semantic_heads_12",
        ):
            with self.subTest(candidate=candidate), _staged_profile(
                candidate
            ) as staged:
                profile = json.loads(staged.profile.read_text(encoding="utf-8"))
                settings = Settings(
                    deployment_mode="local",
                    routing_lightgbm_shadow_enabled=True,
                    routing_lightgbm_shadow_service_token=SERVICE_TOKEN,
                    routing_lightgbm_shadow_artifact_root=str(staged.root),
                    routing_lightgbm_shadow_profile_manifest=str(staged.profile),
                    routing_lightgbm_shadow_profile_manifest_sha256=(
                        staged.profile_sha256
                    ),
                    routing_lightgbm_shadow_max_concurrent=2,
                    routing_lightgbm_shadow_worker_count=1,
                    routing_lightgbm_shadow_onnx_intra_op_threads=1,
                    routing_lightgbm_shadow_onnx_inter_op_threads=1,
                )
                app = create_app(settings)
                with TestClient(app) as client:
                    response = client.post(
                        "/internal/routing/difficulty/lightgbm-shadow/v1/classify",
                        headers={"X-GateLM-AI-Service-Token": SERVICE_TOKEN},
                        json={
                            "contractVersion": CONTRACT_VERSION,
                            "modelVersion": profile["model"]["version"],
                            "modelContentHash": profile["model"]["contentHash"],
                            "ruleVectorVersion": RULE_VECTOR_VERSION,
                            "instructionText": INSTRUCTION,
                            "ruleVector": _rule_vector(),
                        },
                    )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(
                    set(response.json()),
                    {
                        "contractVersion",
                        "status",
                        "difficulty",
                        "modelVersion",
                        "modelContentHash",
                    },
                )
                self.assertIn(response.json()["difficulty"], {"simple", "complex"})
                self.assertNotIn("score", response.text.lower())
                self.assertNotIn("vector", response.text.lower())
                gc.collect()

    def test_cross_dimension_model_profiles_fail_closed(self) -> None:
        swaps = (
            (
                "rule_42_plus_e5_small_pca_64",
                "rule_42_plus_semantic_heads_12",
            ),
            (
                "rule_42_plus_semantic_heads_12",
                "rule_42_plus_e5_small_pca_64",
            ),
        )
        for candidate, foreign_model in swaps:
            def mutate(profile: dict[str, Any]) -> None:
                foreign = OUTPUT_ROOT / f"{foreign_model}.lightgbm.txt"
                target_name = foreign.name
                profile["model"].update(
                    {
                        "relativePath": target_name,
                        "sizeBytes": foreign.stat().st_size,
                        "sha256": _sha256(foreign),
                        "contentHash": f"sha256:{_sha256(foreign)}",
                    }
                )

            with self.subTest(candidate=candidate), _staged_profile(
                candidate,
                profile_mutator=mutate,
                extra_models=(foreign_model,),
            ) as staged:
                with self.assertRaisesRegex(
                    RoutingLightGBMShadowRuntimeError,
                    "feature dimension mismatch",
                ):
                    _runtime(staged)

    def test_semantic_head_class_order_change_fails_closed(self) -> None:
        def mutate(profile: dict[str, Any]) -> None:
            classes = profile["featureShape"]["semanticHeads"]["classOrder"][0][
                "classes"
            ]
            classes[0], classes[1] = classes[1], classes[0]

        with _staged_profile(
            "rule_42_plus_semantic_heads_12",
            profile_mutator=mutate,
        ) as staged:
            with self.assertRaisesRegex(
                RoutingLightGBMShadowRuntimeError,
                "semantic head descriptor identity mismatch",
            ):
                _runtime(staged)

    def test_pca_and_semantic_head_corruption_fail_at_startup(self) -> None:
        for candidate, artifact_name in (
            (
                "rule_42_plus_e5_small_pca_64",
                SMALL_PCA_SOURCE.name,
            ),
            (
                "rule_42_plus_semantic_heads_12",
                SEMANTIC_HEADS_SOURCE.name,
            ),
        ):
            with self.subTest(candidate=candidate), _staged_profile(
                candidate
            ) as staged:
                path = staged.root / artifact_name
                path.write_bytes(path.read_bytes() + b"corrupt")
                with self.assertRaisesRegex(
                    RoutingLightGBMShadowRuntimeError,
                    "artifact integrity mismatch",
                ):
                    _runtime(staged)


class _StagedProfile:
    def __init__(self, root: Path, profile: Path) -> None:
        self.root = root
        self.profile = profile

    @property
    def profile_sha256(self) -> str:
        return _sha256(self.profile)


@contextlib.contextmanager
def _staged_profile(
    candidate: str,
    *,
    profile_mutator: Callable[[dict[str, Any]], None] | None = None,
    extra_models: tuple[str, ...] = (),
) -> Iterator[_StagedProfile]:
    source_profile = OUTPUT_ROOT / f"{candidate}.shadow-profile.v1.json"
    profile = json.loads(source_profile.read_text(encoding="utf-8"))
    source_root = (
        SMALL_SOURCE_ROOT
        if profile["encoderMode"] == "e5_small"
        else BASE_SOURCE_ROOT
    )
    with tempfile.TemporaryDirectory(
        prefix="routing-lightgbm-real-",
        dir=REPOSITORY_ROOT / ".tmp",
    ) as raw_root:
        root = Path(raw_root)
        encoder_source = source_root / profile["encoder"]["artifactDirectory"]
        encoder_target = root / profile["encoder"]["artifactDirectory"]
        for entry in profile["encoder"]["runtimeArtifacts"]:
            source = encoder_source / entry["relativePath"]
            target = encoder_target / entry["relativePath"]
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.link(source, target)
            except OSError as exc:
                raise unittest.SkipTest(
                    "real artifact integration requires same-volume hard links"
                ) from exc

        model_source = OUTPUT_ROOT / profile["model"]["relativePath"]
        shutil.copy2(model_source, root / model_source.name)
        for foreign_model in extra_models:
            source = OUTPUT_ROOT / f"{foreign_model}.lightgbm.txt"
            shutil.copy2(source, root / source.name)
        if profile["encoderMode"] == "e5_small":
            shutil.copy2(SMALL_MANIFEST_SOURCE, root / SMALL_MANIFEST_SOURCE.name)
            shutil.copy2(SMALL_PCA_SOURCE, root / SMALL_PCA_SOURCE.name)
            if profile["featureShape"]["semanticHeads"] is not None:
                shutil.copy2(
                    SEMANTIC_HEADS_SOURCE,
                    root / SEMANTIC_HEADS_SOURCE.name,
                )
        if profile_mutator is not None:
            profile_mutator(profile)
        staged_profile = root / source_profile.name
        staged_profile.write_text(
            json.dumps(profile, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        yield _StagedProfile(root, staged_profile)


def _read_profile(candidate: str) -> dict[str, Any]:
    return json.loads(
        (OUTPUT_ROOT / f"{candidate}.shadow-profile.v1.json").read_text(
            encoding="utf-8"
        )
    )


def _runtime(staged: _StagedProfile) -> RoutingLightGBMShadowRuntime:
    return RoutingLightGBMShadowRuntime(
        artifact_root=staged.root,
        profile_manifest_path=staged.profile,
        profile_manifest_sha256=staged.profile_sha256,
        intra_op_threads=1,
        inter_op_threads=1,
    )


def _rule_vector() -> list[float]:
    vector = [0.0] * RULE_VECTOR_DIMENSION
    vector[1] = 1.0
    vector[8] = 1.0
    return vector


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    unittest.main()
