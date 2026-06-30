from __future__ import annotations


ALLOWED_DETECTOR_TYPES = frozenset(
    {
        "email",
        "phone_number",
        "resident_registration_number",
        "api_key",
        "provider_api_key",
        "cloud_access_key",
        "github_token",
        "slack_token",
        "database_url",
        "webhook_url",
        "password_assignment",
        "session_cookie",
        "authorization_header",
        "jwt",
        "private_key",
    }
)
