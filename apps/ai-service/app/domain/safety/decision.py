from __future__ import annotations

from dataclasses import dataclass, field


ACTION_NONE = "none"
ACTION_REDACTED = "redacted"
ACTION_BLOCKED = "blocked"
BLOCK_REASON_SENSITIVE_DATA_BLOCKED = "sensitive_data_blocked"


@dataclass(frozen=True)
class SafetyDecision:
    action: str
    detected_types: tuple[str, ...]
    detected_count: int
    redacted_prompt_preview: str | None
    block_reason: str | None
    security_policy_hash: str
    detected_type_counts: dict[str, int] = field(default_factory=dict)
