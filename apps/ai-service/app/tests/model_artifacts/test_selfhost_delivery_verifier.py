from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[5]
VERIFIER_PATH = (
    REPOSITORY_ROOT
    / "scripts"
    / "tenant_chat_pii_models"
    / "verify_selfhost_delivery.py"
)
SPEC = importlib.util.spec_from_file_location("verify_selfhost_delivery", VERIFIER_PATH)
assert SPEC is not None and SPEC.loader is not None
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)


class SelfhostDeliveryVerifierTests(unittest.TestCase):
    def test_accepts_openai_only_pinned_runtime_boundary(self) -> None:
        config = _valid_config()
        VERIFIER.verify_config(config)

    def test_accepts_absent_or_blank_additional_model_paths(self) -> None:
        for additional_value in (None, "", "   "):
            with self.subTest(additional_value=additional_value):
                config = _valid_config()
                environment = config["services"]["ai-service"]["environment"]
                if additional_value is None:
                    environment.pop(
                        "AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS"
                    )
                else:
                    environment[
                        "AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS"
                    ] = additional_value
                VERIFIER.verify_config(config)

    def test_accepts_exact_allowlisted_additional_model_path(self) -> None:
        config = _valid_config()
        config["services"]["ai-service"]["environment"][
            "AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS"
        ] = next(iter(VERIFIER.ADDITIONAL_MODEL_PATH_ALLOWLIST))

        VERIFIER.verify_config(config)

    def test_rejects_unpinned_primary_model_path(self) -> None:
        invalid_paths = (
            None,
            "",
            "openai/privacy-filter",
            "/models/releases/tenant-chat-pii-models-20260715/unknown",
            (
                "/models/releases/tenant-chat-pii-models-20260715/"
                "openai--privacy-filter/../unknown"
            ),
        )
        for invalid_path in invalid_paths:
            with self.subTest(invalid_path=invalid_path):
                config = _valid_config()
                config["services"]["ai-service"]["environment"][
                    "AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID"
                ] = invalid_path
                with self.assertRaisesRegex(
                    VERIFIER.VerificationError,
                    "primary model must use the pinned OpenAI path",
                ):
                    VERIFIER.verify_config(config)

    def test_rejects_malformed_or_unallowlisted_additional_model_paths(self) -> None:
        allowed = next(iter(VERIFIER.ADDITIONAL_MODEL_PATH_ALLOWLIST))
        invalid_values = (
            [allowed],
            f"{allowed},",
            f",{allowed}",
            f" {allowed}",
            f"{allowed} ",
            f"{allowed},{allowed}",
            "/models/releases/tenant-chat-pii-models-20260715/unknown",
            "amoeba04/koelectra-small-v3-privacy-ner",
        )
        for invalid_value in invalid_values:
            with self.subTest(invalid_value=invalid_value):
                config = _valid_config()
                config["services"]["ai-service"]["environment"][
                    "AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS"
                ] = invalid_value
                with self.assertRaises(VERIFIER.VerificationError):
                    VERIFIER.verify_config(config)

    def test_rejects_unpinned_ml_detector_allowlist(self) -> None:
        for invalid_value in (None, "", "secret,phone_number", "phone_number,email"):
            with self.subTest(invalid_value=invalid_value):
                config = _valid_config()
                config["services"]["ai-service"]["environment"][
                    "AI_SERVICE_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES"
                ] = invalid_value
                with self.assertRaisesRegex(
                    VERIFIER.VerificationError, "ML detector allowlist is not pinned"
                ):
                    VERIFIER.verify_config(config)

    def test_rejects_url_environment_and_writable_runtime_volume(self) -> None:
        config = _valid_config()
        config["services"]["pii-model-init"]["environment"][
            "AI_SERVICE_PII_MODEL_BUNDLE_URL"
        ] = "https://artifacts.invalid/private?signature=credential"
        with self.assertRaises(VERIFIER.VerificationError):
            VERIFIER.verify_config(config)

    def test_rejects_initializer_without_read_only_root_or_tmpfs(self) -> None:
        config = _valid_config()
        config["services"]["pii-model-init"]["read_only"] = False
        with self.assertRaisesRegex(
            VERIFIER.VerificationError, "root filesystem must be read-only"
        ):
            VERIFIER.verify_config(config)

        config = _valid_config()
        config["services"]["pii-model-init"]["tmpfs"] = ["/run"]
        with self.assertRaisesRegex(VERIFIER.VerificationError, "mount /tmp as tmpfs"):
            VERIFIER.verify_config(config)

    def test_rejects_missing_or_misdirected_initializer_secret(self) -> None:
        config = _valid_config()
        config["services"]["pii-model-init"]["secrets"] = []
        with self.assertRaisesRegex(VERIFIER.VerificationError, "exactly one"):
            VERIFIER.verify_config(config)

        config = _valid_config()
        config["services"]["pii-model-init"]["secrets"] = [
            {
                "source": "untrusted_model_url",
                "target": "pii_model_bundle_url",
            }
        ]
        with self.assertRaisesRegex(VERIFIER.VerificationError, "source is not pinned"):
            VERIFIER.verify_config(config)

        config = _valid_config()
        config["services"]["pii-model-init"]["secrets"] = [
            {
                "source": "pii_model_bundle_url",
                "target": "wrong_target",
            }
        ]
        with self.assertRaisesRegex(VERIFIER.VerificationError, "expected target"):
            VERIFIER.verify_config(config)

        config = _valid_config()
        config["services"]["ai-service"]["volumes"][0]["read_only"] = False
        with self.assertRaises(VERIFIER.VerificationError):
            VERIFIER.verify_config(config)


def _valid_config() -> dict[str, object]:
    release = "tenant-chat-pii-models-20260715"
    image = "gatelm/ai-service:test"
    return {
        "services": {
            "pii-model-init": {
                "image": image,
                "command": ["gatelm-pii-model-sync"],
                "read_only": True,
                "tmpfs": ["/tmp"],
                "secrets": [
                    {
                        "source": "pii_model_bundle_url",
                        "target": "pii_model_bundle_url",
                    }
                ],
                "environment": {
                    "AI_SERVICE_PII_MODEL_SYNC_ENABLED": "false",
                    "AI_SERVICE_PII_MODEL_BUNDLE_URL_FILE": (
                        "/run/secrets/pii_model_bundle_url"
                    ),
                    "AI_SERVICE_PII_MODEL_RELEASE_ID": release,
                },
                "volumes": [
                    {
                        "type": "volume",
                        "source": "pii_model_data",
                        "target": "/models",
                        "read_only": False,
                    }
                ],
            },
            "ai-service": {
                "image": image,
                "environment": {
                    "AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID": (
                        f"/models/releases/{release}/openai--privacy-filter"
                    ),
                    "AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS": "",
                    "AI_SERVICE_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES": (
                        "phone_number,secret"
                    ),
                },
                "volumes": [
                    {
                        "type": "volume",
                        "source": "pii_model_data",
                        "target": "/models",
                        "read_only": True,
                    }
                ],
                "depends_on": {
                    "pii-model-init": {
                        "condition": "service_completed_successfully"
                    }
                },
            },
        },
        "secrets": {"pii_model_bundle_url": {"file": "example"}},
        "volumes": {"pii_model_data": {}},
    }


if __name__ == "__main__":
    unittest.main()
