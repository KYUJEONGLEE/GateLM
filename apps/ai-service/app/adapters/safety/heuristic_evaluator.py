"""Compatibility exports for the centralized built-in PII rule registry.

New production code should import rule definitions from ``pii_rule_registry``.
This module keeps the existing public import path stable for tests and callers.
"""

from app.adapters.safety.pii_rule_registry import (
    CreditCardDetector,
    CREDIT_CARD_CANDIDATE_PATTERN,
    DetectionAdapter,
    HeuristicSafetyEvaluator,
    IP_ADDRESS_CANDIDATE_PATTERN,
    PromptDetector,
    PublicIPAddressDetector,
    RegexDetector,
    default_detectors,
    passes_luhn_check,
)

__all__ = [
    "CreditCardDetector",
    "CREDIT_CARD_CANDIDATE_PATTERN",
    "DetectionAdapter",
    "HeuristicSafetyEvaluator",
    "IP_ADDRESS_CANDIDATE_PATTERN",
    "PromptDetector",
    "PublicIPAddressDetector",
    "RegexDetector",
    "default_detectors",
    "passes_luhn_check",
]
