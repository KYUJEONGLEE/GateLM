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
    def test_accepts_pinned_secret_and_read_only_runtime_boundary(self) -> None:
        config = _valid_config()
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
                    "AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS": (
                        f"/models/releases/{release}/koelectra"
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
