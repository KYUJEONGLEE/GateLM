from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

from app.domain.ai_safety_cold_start import (
    ColdStartEvidenceError,
    build_repeated_cold_evidence,
    scan_cold_start_output,
)
from app.services import ai_safety_repeated_cold_runner
from app.services.ai_safety_cold_start_worker import (
    measure_cold_start,
    read_process_peak_rss_mb,
)


class AiSafetyRepeatedColdTests(unittest.TestCase):
    def test_aggregates_fresh_child_successes_with_nearest_rank(self) -> None:
        observations = iter(
            [
                child_success(10, 100),
                child_success(30, 120),
                child_success(20, 110),
                child_success(50, 150),
                child_success(40, 140),
            ]
        )

        evidence = build_repeated_cold_evidence(
            runs=5,
            child_timeout_ms=1000,
            execute_child=lambda _timeout: next(observations),
            evidence_binding=evidence_binding(),
        )

        self.assertEqual(evidence["successfulRuns"], 5)
        self.assertEqual(evidence["failedRuns"], 0)
        self.assertEqual(evidence["startupFailureRate"], 0)
        self.assertEqual(evidence["coldP50Ms"], 30)
        self.assertEqual(evidence["coldP95Ms"], 50)
        self.assertEqual(evidence["peakRssMb"], 150)

    def test_invalid_or_failed_child_is_counted_without_error_detail(self) -> None:
        observations = iter(
            [
                child_success(25, 90),
                {"schemaVersion": "pii-cold-start-child.v1", "status": "failed"},
                {"unexpected": "internal detail"},
            ]
        )

        evidence = build_repeated_cold_evidence(
            runs=3,
            child_timeout_ms=1000,
            execute_child=lambda _timeout: next(observations),
            evidence_binding=evidence_binding(),
        )

        self.assertEqual(evidence["successfulRuns"], 1)
        self.assertEqual(evidence["failedRuns"], 2)
        self.assertEqual(evidence["startupFailureRate"], 0.666667)
        self.assertNotIn("internal detail", json.dumps(evidence))

    def test_output_scanner_rejects_location_and_raw_pii(self) -> None:
        base = build_repeated_cold_evidence(
            runs=1,
            child_timeout_ms=1000,
            execute_child=lambda _timeout: child_success(10, 50),
            evidence_binding=evidence_binding(),
        )
        unsafe_values = (
            {**base, "endpointUrl": "not emitted"},
            {**base, "note": "https://internal.invalid/probe"},
            {**base, "note": "synthetic.person@example.test"},
        )
        for unsafe in unsafe_values:
            with self.subTest(unsafe=list(unsafe)[-1]):
                with self.assertRaises(ColdStartEvidenceError):
                    scan_cold_start_output(unsafe)

    def test_cli_with_fake_fresh_children_writes_aggregate_only(self) -> None:
        calls = 0

        def execute_child(timeout_ms: int) -> dict:
            nonlocal calls
            calls += 1
            self.assertEqual(timeout_ms, 2000)
            return child_success(10 + calls, 100 + calls)

        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "cold.json"
            verification_path = Path(temp_dir) / "artifact-verification.json"
            verification_path.write_text(
                json.dumps(artifact_verification()), encoding="utf-8"
            )
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                exit_code = ai_safety_repeated_cold_runner.run(
                    [
                        "--runs",
                        "3",
                        "--child-timeout-ms",
                        "2000",
                        "--artifact-verification",
                        str(verification_path),
                        "--out",
                        str(output_path),
                    ],
                    child_executor=execute_child,
                )

            self.assertEqual(exit_code, 0)
            self.assertEqual(calls, 3)
            evidence = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertTrue(evidence["aggregateOnly"])
            self.assertNotIn("modelRevision", evidence)
            self.assertEqual(evidence["evidenceBinding"], evidence_binding())
            self.assertNotIn(str(output_path), stdout.getvalue())

    def test_cli_returns_nonzero_when_every_fresh_child_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            verification_path = Path(temp_dir) / "artifact-verification.json"
            verification_path.write_text(
                json.dumps(artifact_verification()), encoding="utf-8"
            )
            exit_code = ai_safety_repeated_cold_runner.run(
                [
                    "--runs",
                    "2",
                    "--artifact-verification",
                    str(verification_path),
                    "--out",
                    str(Path(temp_dir) / "cold.json"),
                ],
                child_executor=lambda _timeout: {},
            )

        self.assertEqual(exit_code, 1)

    def test_cli_rejects_incomplete_artifact_verification(self) -> None:
        verification = artifact_verification()
        verification["filesVerified"] = 0
        with tempfile.TemporaryDirectory() as temp_dir:
            verification_path = Path(temp_dir) / "artifact-verification.json"
            verification_path.write_text(json.dumps(verification), encoding="utf-8")

            exit_code = ai_safety_repeated_cold_runner.run(
                [
                    "--runs",
                    "1",
                    "--artifact-verification",
                    str(verification_path),
                    "--out",
                    str(Path(temp_dir) / "cold.json"),
                ],
                child_executor=lambda _timeout: child_success(10, 50),
            )

        self.assertEqual(exit_code, 2)

    def test_cli_sanitizes_malformed_artifact_verification_json(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            verification_path = Path(temp_dir) / "artifact-verification.json"
            verification_path.write_text("{malformed", encoding="utf-8")
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                exit_code = ai_safety_repeated_cold_runner.run(
                    [
                        "--runs",
                        "1",
                        "--artifact-verification",
                        str(verification_path),
                        "--out",
                        str(Path(temp_dir) / "cold.json"),
                    ],
                    child_executor=lambda _timeout: child_success(10, 50),
                )

        self.assertEqual(exit_code, 2)
        self.assertIn("JSONDecodeError", stderr.getvalue())
        self.assertNotIn("malformed", stderr.getvalue())

    def test_checksum_verification_is_required_and_never_inferred(self) -> None:
        binding = evidence_binding()
        binding["artifactChecksumsVerified"] = False

        with self.assertRaises(ColdStartEvidenceError):
            build_repeated_cold_evidence(
                runs=1,
                child_timeout_ms=1000,
                execute_child=lambda _timeout: child_success(10, 50),
                evidence_binding=binding,
            )

    def test_worker_measurement_requires_preload_probe_and_peak_rss(self) -> None:
        service = RecordingService()

        report = measure_cold_start(
            service_factory=lambda: service,
            request_factory=lambda _service: object(),
            peak_rss_reader=lambda: 128.5,
        )

        self.assertTrue(service.warmed)
        self.assertTrue(service.probed)
        self.assertEqual(report["status"], "passed")
        self.assertEqual(set(report), {"schemaVersion", "status", "startupLatencyMs", "peakRssMb"})

    def test_linux_peak_uses_ru_maxrss_kib_semantics(self) -> None:
        peak_rss = read_process_peak_rss_mb(
            platform_name="linux",
            unix_peak_reader=lambda: 2048,
        )

        self.assertEqual(peak_rss, 2)

    def test_windows_peak_uses_peak_working_set_bytes(self) -> None:
        peak_rss = read_process_peak_rss_mb(
            platform_name="win32",
            windows_peak_reader=lambda: 2 * 1024 * 1024,
        )

        self.assertEqual(peak_rss, 2)

    @unittest.skipUnless(sys.platform.startswith("win"), "Windows API integration check")
    def test_windows_peak_reader_returns_current_process_peak(self) -> None:
        peak_rss = read_process_peak_rss_mb()

        self.assertIsNotNone(peak_rss)
        self.assertGreater(peak_rss or 0, 0)

    def test_worker_fails_when_true_peak_is_unavailable(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "resource measurement unavailable"):
            measure_cold_start(
                service_factory=RecordingService,
                request_factory=lambda _service: object(),
                peak_rss_reader=lambda: None,
            )


class RecordingService:
    def __init__(self) -> None:
        self.warmed = False
        self.probed = False

    def warmup(self) -> None:
        self.warmed = True

    def detect(self, _request: object) -> None:
        if not self.warmed:
            raise AssertionError("probe ran before preload")
        self.probed = True


def child_success(latency_ms: int, peak_rss_mb: float) -> dict:
    return {
        "schemaVersion": "pii-cold-start-child.v1",
        "status": "passed",
        "startupLatencyMs": latency_ms,
        "peakRssMb": peak_rss_mb,
    }


def evidence_binding() -> dict:
    return {
        "schemaVersion": "pii-promotion-evidence-binding.v1",
        "manifestVersion": "synthetic-manifest.v1",
        "modelRevisions": {"synthetic/model": "revision-a"},
        "artifactChecksumsVerified": True,
        "gitRevision": "a" * 40,
    }


def artifact_verification() -> dict:
    return {
        "schemaVersion": "pii-artifact-verification.v1",
        "aggregateOnly": True,
        "filesExpected": 1,
        "filesVerified": 1,
        "checksumFailures": 0,
        "evidenceBinding": evidence_binding(),
    }


if __name__ == "__main__":
    unittest.main()
