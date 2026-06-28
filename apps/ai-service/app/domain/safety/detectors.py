from __future__ import annotations


ALLOWED_DETECTOR_TYPES = frozenset(
    {
        "email",
        "phone_number",
        "resident_registration_number",
        "api_key",
        "authorization_header",
        "jwt",
        "private_key",
    }
)
