from __future__ import annotations

from dataclasses import dataclass


REPORT_VERSION = "ai-safety-resource-latency-benchmark.v2"
MODEL_ID = "openai/privacy-filter"
CONTRACT_VERSION = "ai-safety-detector.v1"
DEFAULT_ENDPOINT_PATH = "/internal/ai-safety/v1/detect"
DEFAULT_RUNTIME_PROFILE = "cpu_local_pipeline"
DEFAULT_WARMUP_REQUESTS = 10
DEFAULT_MEASURED_REQUESTS = 100
DEFAULT_TIMEOUT_MS = 300

RUNTIME_PROFILES = ("cpu_local_pipeline", "gpu_pipeline", "quantized_cpu")
CASE_GROUPS = ("short_safe", "long_safe", "pii_en", "pii_ko", "mixed_edge")
INPUT_LENGTH_BUCKETS = ("short", "medium", "long", "very_long")


class BenchmarkError(ValueError):
    """Raised when benchmark inputs or outputs violate the lab contract."""


@dataclass(frozen=True)
class BenchmarkCase:
    case_id: str
    case_group: str
    input_length_bucket: str
    input_template: str
    placeholder_bindings: dict[str, str]
    locale: str | None
    tags: tuple[str, ...]


@dataclass(frozen=True)
class TargetResult:
    target_kind: str
    target_latency_ms: int
    target_outcome: str
    sidecar_latency_ms: int | None
    sidecar_outcome: str
    sidecar_observation: str
    fallback_mode: str
    fallback_observation: str
    sanitized_error_code: str | None = None


@dataclass(frozen=True)
class BenchmarkSample:
    case_id: str
    case_group: str
    input_length_bucket: str
    runtime_profile: str
    target_kind: str
    target_latency_ms: int
    target_outcome: str
    sidecar_latency_ms: int | None
    sidecar_outcome: str
    sidecar_observation: str
    fallback_mode: str
    fallback_observation: str
    sanitized_error_code: str | None = None


@dataclass(frozen=True)
class ResourceSummary:
    peak_rss_mb: float | None
    avg_cpu_pct: float | None
    peak_gpu_memory_mb: float | None
    notes: str

    def to_report(self) -> dict[str, float | str | None]:
        return {
            "peakRssMb": self.peak_rss_mb,
            "avgCpuPct": self.avg_cpu_pct,
            "peakGpuMemoryMb": self.peak_gpu_memory_mb,
            "notes": self.notes,
        }
