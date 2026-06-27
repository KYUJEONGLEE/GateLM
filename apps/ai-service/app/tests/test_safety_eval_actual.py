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
        self.assertEqual(len(actual), 9)
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
