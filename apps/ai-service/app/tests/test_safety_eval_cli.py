from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
AI_SERVICE_ROOT = REPO_ROOT / "apps" / "ai-service"
CORPUS_PATH = REPO_ROOT / "docs" / "v1.0.0" / "fixtures" / "safety-eval-corpus.jsonl"
FIXTURE_DIR = AI_SERVICE_ROOT / "app" / "tests" / "fixtures" / "safety_eval"
SMOKE_SCRIPT = REPO_ROOT / "scripts" / "dev" / "v1-safety-eval-corpus-smoke.py"


class SafetyEvalCliTests(unittest.TestCase):
    def test_cli_pass_fixture_exits_zero(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            result = run_cli(
                [
                    "--mode",
                    "detector-output",
                    "--corpus",
                    str(CORPUS_PATH),
                    "--fixture",
                    str(FIXTURE_DIR / "detector-output.fixture.json"),
                    "--out",
                    temp_dir,
                ]
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("28/28 passed", result.stdout)
            self.assertTrue((Path(temp_dir) / "safety-eval-report.json").exists())

    def test_cli_gateway_v2_fixture_with_semantic_cache_evidence_exits_zero(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            result = run_cli(
                [
                    "--mode",
                    "gateway-safety-output-v2",
                    "--corpus",
                    str(CORPUS_PATH),
                    "--fixture",
                    str(FIXTURE_DIR / "gateway-safety-output-v2.fixture.json"),
                    "--semantic-cache-evidence",
                    str(FIXTURE_DIR / "semantic-cache-evidence-v2.fixture.json"),
                    "--out",
                    temp_dir,
                ]
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("28/28 passed", result.stdout)

    def test_cli_mismatch_fixture_exits_one_unless_overridden(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            result = run_cli(
                [
                    "--mode",
                    "detector-output",
                    "--corpus",
                    str(CORPUS_PATH),
                    "--fixture",
                    str(FIXTURE_DIR / "detector-output-mixed-failure.fixture.json"),
                    "--out",
                    temp_dir,
                ]
            )
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)

        with tempfile.TemporaryDirectory() as temp_dir:
            result = run_cli(
                [
                    "--mode",
                    "detector-output",
                    "--corpus",
                    str(CORPUS_PATH),
                    "--fixture",
                    str(FIXTURE_DIR / "detector-output-mixed-failure.fixture.json"),
                    "--out",
                    temp_dir,
                    "--no-fail-on-mismatch",
                ]
            )
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_smoke_wrapper_validates_docs_corpus(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SMOKE_SCRIPT)],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("v1 safety eval corpus smoke passed: 28 cases", result.stdout)

    def test_cli_io_failure_exits_two_without_traceback(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            occupied_out_path = Path(temp_dir) / "occupied-output-path"
            occupied_out_path.write_text("not a directory", encoding="utf-8")

            result = run_cli(
                [
                    "--mode",
                    "detector-output",
                    "--corpus",
                    str(CORPUS_PATH),
                    "--fixture",
                    str(FIXTURE_DIR / "detector-output.fixture.json"),
                    "--out",
                    str(occupied_out_path),
                ]
            )

            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertIn("FAIL:", result.stderr)
            self.assertNotIn("Traceback", result.stderr)


def run_cli(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "app.services.safety_eval_runner", *args],
        cwd=AI_SERVICE_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


if __name__ == "__main__":
    unittest.main()
