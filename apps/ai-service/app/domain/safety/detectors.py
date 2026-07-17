from __future__ import annotations


ALLOWED_DETECTOR_TYPES = frozenset(
    {
        "email",
        "phone_number",
        "postal_address",
        "date_of_birth",
        "private_date",
        "private_url",
        "person_name",
        "organization_name",
        "customer_id",
        "employee_id",
        "account_id",
        "account_number",
        "ip_address",
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
        "credit_card",
        "bank_account",
        "passport_number",
        "driver_license",
        "authorization_header",
        "confidential_business_context",
        "jwt",
        "private_key",
        "secret",
        "sensitive_health_context",
        "unknown_pii",
    }
)

MAXIMUM_PLACEHOLDER_COUNTER = 1_000_000
ALLOWED_PLACEHOLDER_PREFIXES = frozenset(
    {
        "ADDRESS",
        "AGENT",
        "APPLICANT",
        "CUSTOMER",
        "DOCTOR",
        "EMAIL",
        "INTERVIEWER",
        "ORGANIZATION",
        "PATIENT",
        "PERSON",
        "PHONE_NUMBER",
    }
)
