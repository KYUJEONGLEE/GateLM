from __future__ import annotations

from math import ceil
from typing import Sequence


def nearest_rank(values: Sequence[int], percentile: float) -> int | None:
    if not values:
        return None
    if percentile <= 0 or percentile > 1:
        raise ValueError("percentile must be in the range (0, 1]")
    sorted_values = sorted(values)
    rank = ceil(percentile * len(sorted_values))
    return sorted_values[rank - 1]


def round_rate(count: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(count / total, 4)
