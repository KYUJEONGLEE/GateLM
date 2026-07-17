from __future__ import annotations

import contextlib
import ctypes
import io
import json
import sys
from time import perf_counter
from typing import Any, Callable


CHILD_VERSION = "pii-cold-start-child.v1"
FIXED_SYNTHETIC_PROBE = "GateLM fixed synthetic detector readiness probe."


def measure_cold_start(
    *,
    service_factory: Callable[[], Any],
    request_factory: Callable[[Any], Any],
    peak_rss_reader: Callable[[], float | None],
) -> dict[str, Any]:
    started = perf_counter()
    service = service_factory()
    service.warmup()
    service.detect(request_factory(service))
    latency_ms = max(0, round((perf_counter() - started) * 1000))
    peak_rss_mb = peak_rss_reader()
    if peak_rss_mb is None or peak_rss_mb <= 0:
        raise RuntimeError("resource measurement unavailable")
    return {
        "schemaVersion": CHILD_VERSION,
        "status": "passed",
        "startupLatencyMs": latency_ms,
        "peakRssMb": round(peak_rss_mb, 3),
    }


def run_worker() -> int:
    sink = io.StringIO()
    try:
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            report = measure_cold_start(
                service_factory=_service_factory,
                request_factory=_request_factory,
                peak_rss_reader=read_process_peak_rss_mb,
            )
    except Exception:
        print(json.dumps({"schemaVersion": CHILD_VERSION, "status": "failed"}))
        return 1
    print(json.dumps(report, separators=(",", ":"), sort_keys=True))
    return 0


def _service_factory():
    from app.api.dependencies import create_ai_safety_detector_service
    from app.core.config import load_settings

    return create_ai_safety_detector_service(load_settings())


def _request_factory(service):
    from app.domain.ai_safety_benchmark.targets import build_request_payload
    from app.schemas.safety import AiSafetyDetectRequest

    return AiSafetyDetectRequest.model_validate(
        build_request_payload(
            FIXED_SYNTHETIC_PROBE,
            locale="en-US",
            model_id=service.model_id,
        )
    )


def read_process_peak_rss_mb(
    *,
    platform_name: str | None = None,
    unix_peak_reader: Callable[[], float | None] | None = None,
    windows_peak_reader: Callable[[], int | None] | None = None,
) -> float | None:
    platform_value = platform_name or sys.platform
    if platform_value.startswith("win"):
        reader = windows_peak_reader or _windows_peak_working_set_bytes
        peak_bytes = reader()
        if peak_bytes is None or peak_bytes <= 0:
            return None
        return peak_bytes / (1024 * 1024)
    if platform_value.startswith("linux") or platform_value == "darwin":
        reader = unix_peak_reader or _unix_ru_maxrss
        ru_maxrss = reader()
        if ru_maxrss is None or ru_maxrss <= 0:
            return None
        divisor = 1024 * 1024 if platform_value == "darwin" else 1024
        return ru_maxrss / divisor
    return None


def _unix_ru_maxrss() -> float | None:
    try:
        import resource

        return float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    except Exception:
        return None


def _windows_peak_working_set_bytes() -> int | None:
    if not sys.platform.startswith("win"):
        return None

    class ProcessMemoryCounters(ctypes.Structure):
        _fields_ = [
            ("cb", ctypes.c_ulong),
            ("PageFaultCount", ctypes.c_ulong),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
        ]

    try:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel32.GetCurrentProcess.argtypes = []
        kernel32.GetCurrentProcess.restype = ctypes.c_void_p
        psapi.GetProcessMemoryInfo.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(ProcessMemoryCounters),
            ctypes.c_ulong,
        ]
        psapi.GetProcessMemoryInfo.restype = ctypes.c_int

        counters = ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        process = kernel32.GetCurrentProcess()
        succeeded = psapi.GetProcessMemoryInfo(
            process,
            ctypes.byref(counters),
            counters.cb,
        )
        return int(counters.PeakWorkingSetSize) if succeeded else None
    except Exception:
        return None


if __name__ == "__main__":
    raise SystemExit(run_worker())
