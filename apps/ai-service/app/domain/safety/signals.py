from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SafetySignal:
    detector_type: str
    start: int
    end: int
    action: str
    placeholder: str
    priority: int
    source: str = "local_rule"
    confidence: float = 1.0

    @property
    def length(self) -> int:
        return self.end - self.start
