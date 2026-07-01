from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.domain.safety_eval.actual import load_actual_fixture
from app.schemas.safety_eval import SafetyEvalError


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "safety_eval"


class SafetyEvalActualFixtureTests(unittest.TestCase):
    def test_loads_detector_output_fixture(self) -> None:
        _, actual = load_actual_fixture(FIXTURE_DIR / "detector-output.fixture.json", "detector-output")
        self.assertEqual(len(actual), 32)
        repeated = actual["repeated_email_redacts_count"]
        self.assertEqual(repeated.detected_type_counts, {"email": 2})
        self.assertEqual(repeated.action, "redacted")

    def test_loads_gateway_safety_output_fixture(self) -> None:
        _, actual = load_actual_fixture(
            FIXTURE_DIR / "gateway-safety-output.fixture.json",
            "gateway-safety-output",
        )
        blocked = actual["api_key_blocks_before_cache"]
        self.assertEqual(blocked.action, "blocked")
        self.assertIsNotNone(blocked.gateway_effects)
        self.assertFalse(blocked.gateway_effects.provider_called)
        self.assertEqual(blocked.gateway_effects.error_code, "sensitive_data_blocked")

    def test_loads_gateway_safety_output_v2_fixture(self) -> None:
        _, actual = load_actual_fixture(
            FIXTURE_DIR / "gateway-safety-output-v2.fixture.json",
            "gateway-safety-output-v2",
        )
        self.assertEqual(len(actual), 32)
        safe = actual["safe_none_basic"]
        self.assertEqual(safe.safety_outcome, "passed")
        self.assertEqual(safe.action, "none")
        blocked = actual["api_key_blocks_before_cache"]
        self.assertEqual(blocked.safety_outcome, "blocked")
        self.assertIsNotNone(blocked.gateway_effects)
        self.assertFalse(blocked.gateway_effects.provider_called)
        self.assertFalse(blocked.gateway_effects.cache_write)
        self.assertFalse(blocked.gateway_effects.streaming_started)
        self.assertEqual(blocked.gateway_effects.terminal_status, "blocked")

    def test_gateway_safety_output_v2_rejects_legacy_terminal_statuses(self) -> None:
        raw_fixture = json.loads((FIXTURE_DIR / "gateway-safety-output-v2.fixture.json").read_text(encoding="utf-8"))

        for terminal_status in ("cache_hit", "error"):
            raw_fixture["results"][0]["gatewayEffects"]["terminalStatus"] = terminal_status
            with tempfile.TemporaryDirectory() as temp_dir:
                fixture_path = Path(temp_dir) / f"bad-{terminal_status}.fixture.json"
                fixture_path.write_text(json.dumps(raw_fixture), encoding="utf-8")

                with self.assertRaisesRegex(SafetyEvalError, "invalid terminalStatus"):
                    load_actual_fixture(fixture_path, "gateway-safety-output-v2")

    def test_gateway_safety_output_v2_rejects_non_object_gateway_effects(self) -> None:
        raw_fixture = json.loads((FIXTURE_DIR / "gateway-safety-output-v2.fixture.json").read_text(encoding="utf-8"))
        raw_fixture["results"][0]["gatewayEffects"] = None

        with tempfile.TemporaryDirectory() as temp_dir:
            fixture_path = Path(temp_dir) / "bad-gateway-effects.fixture.json"
            fixture_path.write_text(json.dumps(raw_fixture), encoding="utf-8")

            with self.assertRaisesRegex(SafetyEvalError, "gatewayEffects: must be an object"):
                load_actual_fixture(fixture_path, "gateway-safety-output-v2")

    def test_gateway_safety_output_v2_rejects_invalid_detector_category_without_type_error(self) -> None:
        raw_fixture = json.loads((FIXTURE_DIR / "gateway-safety-output-v2.fixture.json").read_text(encoding="utf-8"))
        raw_fixture["results"][0]["domainOutcomes"]["safety"]["detectorSummary"]["detectorCategories"] = [
            "email",
            {"nested": "not_allowed"},
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            fixture_path = Path(temp_dir) / "bad-detector-category.fixture.json"
            fixture_path.write_text(json.dumps(raw_fixture), encoding="utf-8")

            with self.assertRaisesRegex(SafetyEvalError, "invalid detector category"):
                load_actual_fixture(fixture_path, "gateway-safety-output-v2")

    def test_gateway_safety_output_v2_supports_not_checked_outcome(self) -> None:
        raw_fixture = {
            "fixtureName": "v2-safety-eval-not-checked-probe",
            "fixtureVersion": "2026-06-30.v2",
            "mode": "gateway_safety_output_v2",
            "results": [
                {
                    "caseId": "not_checked_probe",
                    "domainOutcomes": {
                        "safety": {
                            "outcome": "not_checked",
                            "detectorSummary": {
                                "detectedCount": 0,
                                "detectorCategories": [],
                            },
                            "policyBasis": {
                                "runtimeSnapshotId": "runtime_snapshot_safety_eval_001",
                                "runtimeSnapshotVersion": 1,
                                "securityPolicyHash": "sec_v1_safety_baseline",
                            },
                        },
                        "cache": {
                            "outcome": "miss",
                        },
                        "provider": {
                            "outcome": "success",
                        },
                        "streaming": {
                            "outcome": "not_streaming",
                        },
                    },
                    "gatewayEffects": {
                        "providerCalled": True,
                        "cacheLookup": True,
                        "cacheWrite": True,
                        "streamingStarted": False,
                        "terminalStatus": "success",
                        "httpStatus": 200,
                        "errorCode": None,
                    },
                }
            ],
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture_path = Path(temp_dir) / "not-checked.fixture.json"
            fixture_path.write_text(json.dumps(raw_fixture), encoding="utf-8")

            _, actual = load_actual_fixture(fixture_path, "gateway-safety-output-v2")
            self.assertEqual(actual["not_checked_probe"].safety_outcome, "not_checked")

    def test_fixture_metadata_is_required(self) -> None:
        raw_fixture = json.loads((FIXTURE_DIR / "detector-output.fixture.json").read_text(encoding="utf-8"))
        del raw_fixture["fixtureName"]

        with tempfile.TemporaryDirectory() as temp_dir:
            fixture_path = Path(temp_dir) / "missing-metadata.fixture.json"
            fixture_path.write_text(json.dumps(raw_fixture), encoding="utf-8")

            with self.assertRaisesRegex(SafetyEvalError, "top-level fields mismatch"):
                load_actual_fixture(fixture_path, "detector-output")

    def test_fixture_metadata_must_be_string(self) -> None:
        raw_fixture = json.loads((FIXTURE_DIR / "detector-output.fixture.json").read_text(encoding="utf-8"))
        raw_fixture["fixtureVersion"] = 20260627

        with tempfile.TemporaryDirectory() as temp_dir:
            fixture_path = Path(temp_dir) / "bad-metadata.fixture.json"
            fixture_path.write_text(json.dumps(raw_fixture), encoding="utf-8")

            with self.assertRaisesRegex(SafetyEvalError, "fixtureVersion must be a non-empty string"):
                load_actual_fixture(fixture_path, "detector-output")


if __name__ == "__main__":
    unittest.main()
