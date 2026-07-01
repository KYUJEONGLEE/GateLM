from __future__ import annotations

import os
from dataclasses import dataclass, field

from app.domain.ai_safety_benchmark.types import ResourceSummary


@dataclass
class ResourceSampler:
    process_id: int | None
    note: str
    _process: object | None = None
    _rss_samples_mb: list[float] = field(default_factory=list)
    _cpu_samples_pct: list[float] = field(default_factory=list)
    _gpu_samples_mb: list[float] = field(default_factory=list)

    @classmethod
    def for_target(cls, *, target: str, resource_pid: int | None) -> ResourceSampler:
        if target == "http" and resource_pid is None:
            return cls(process_id=None, note="not_collected_http_target")
        return cls(process_id=resource_pid or os.getpid(), note="sampled_process")

    def start(self) -> None:
        if self.process_id is None:
            return
        try:
            import psutil  # type: ignore[import-not-found]

            self._process = psutil.Process(self.process_id)
            self._process.cpu_percent(interval=None)
        except Exception:
            self._process = None
            self.note = "psutil_unavailable"

    def sample(self) -> None:
        if self._process is None:
            return
        try:
            memory_info = self._process.memory_info()
            self._rss_samples_mb.append(round(memory_info.rss / (1024 * 1024), 2))
            self._cpu_samples_pct.append(round(float(self._process.cpu_percent(interval=None)), 2))
        except Exception:
            self.note = "resource_sample_failed"
            self._process = None
            return

        gpu_memory = current_gpu_memory_mb()
        if gpu_memory is not None:
            self._gpu_samples_mb.append(gpu_memory)

    def summary(self) -> ResourceSummary:
        peak_rss = max(self._rss_samples_mb) if self._rss_samples_mb else None
        avg_cpu = (
            round(sum(self._cpu_samples_pct) / len(self._cpu_samples_pct), 2)
            if self._cpu_samples_pct
            else None
        )
        peak_gpu = max(self._gpu_samples_mb) if self._gpu_samples_mb else None
        notes = self.note
        if peak_gpu is None:
            notes = f"{notes};gpu_not_collected"
        return ResourceSummary(
            peak_rss_mb=peak_rss,
            avg_cpu_pct=avg_cpu,
            peak_gpu_memory_mb=peak_gpu,
            notes=notes,
        )


def current_gpu_memory_mb() -> float | None:
    try:
        import torch  # type: ignore[import-not-found]
    except Exception:
        return None
    try:
        if not torch.cuda.is_available():
            return None
        return round(float(torch.cuda.max_memory_allocated()) / (1024 * 1024), 2)
    except Exception:
        return None
