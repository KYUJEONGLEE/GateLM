from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any


BINDING_VERSION = "pii-promotion-evidence-binding.v1"
ARTIFACT_VERIFICATION_VERSION = "pii-artifact-verification.v1"


class EvidenceBindingError(ValueError):
    """Raised when provenance binding does not match its versioned contract."""


def validate_evidence_binding(value: Mapping[str, Any]) -> dict[str, Any]:
    expected_fields = {
        "schemaVersion",
        "manifestVersion",
        "modelRevisions",
        "artifactChecksumsVerified",
        "gitRevision",
    }
    if not isinstance(value, Mapping) or set(value) != expected_fields:
        raise EvidenceBindingError("evidence binding shape is invalid")
    model_revisions = value.get("modelRevisions")
    if (
        value.get("schemaVersion") != BINDING_VERSION
        or not _bounded_string(value.get("manifestVersion"))
        or not isinstance(model_revisions, Mapping)
        or not model_revisions
        or not all(
            isinstance(model_key, str)
            and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,199}", model_key) is not None
            and _bounded_string(revision)
            for model_key, revision in model_revisions.items()
        )
        or value.get("artifactChecksumsVerified") is not True
        or not isinstance(value.get("gitRevision"), str)
        or re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", value["gitRevision"]) is None
    ):
        raise EvidenceBindingError("evidence binding value is invalid")
    return {
        "schemaVersion": BINDING_VERSION,
        "manifestVersion": value["manifestVersion"].strip(),
        "modelRevisions": dict(sorted(model_revisions.items())),
        "artifactChecksumsVerified": True,
        "gitRevision": value["gitRevision"],
    }


def binding_from_verified_artifact_evidence(value: Mapping[str, Any]) -> dict[str, Any]:
    expected_fields = {
        "schemaVersion",
        "aggregateOnly",
        "filesExpected",
        "filesVerified",
        "checksumFailures",
        "evidenceBinding",
    }
    files_expected = value.get("filesExpected") if isinstance(value, Mapping) else None
    files_verified = value.get("filesVerified") if isinstance(value, Mapping) else None
    checksum_failures = value.get("checksumFailures") if isinstance(value, Mapping) else None
    if (
        not isinstance(value, Mapping)
        or set(value) != expected_fields
        or value.get("schemaVersion") != ARTIFACT_VERIFICATION_VERSION
        or value.get("aggregateOnly") is not True
        or not _positive_integer(files_expected)
        or not _non_negative_integer(files_verified)
        or files_verified != files_expected
        or not _non_negative_integer(checksum_failures)
        or checksum_failures != 0
    ):
        raise EvidenceBindingError("artifact verification evidence is invalid")
    binding = value.get("evidenceBinding")
    if not isinstance(binding, Mapping):
        raise EvidenceBindingError("artifact verification binding is invalid")
    return validate_evidence_binding(binding)


def _bounded_string(value: Any) -> bool:
    return isinstance(value, str) and 0 < len(value.strip()) <= 200


def _positive_integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _non_negative_integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0
