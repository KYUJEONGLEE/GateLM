package masking

type Action string

const (
	ActionNone     Action = "none"
	ActionRedacted Action = "redacted"
	ActionBlocked  Action = "blocked"
)

type DetectorType string

const (
	DetectorEmail                      DetectorType = "email"
	DetectorPhoneNumber                DetectorType = "phone_number"
	DetectorPostalAddress              DetectorType = "postal_address"
	DetectorDateOfBirth                DetectorType = "date_of_birth"
	DetectorPersonName                 DetectorType = "person_name"
	DetectorCustomerID                 DetectorType = "customer_id"
	DetectorEmployeeID                 DetectorType = "employee_id"
	DetectorAccountID                  DetectorType = "account_id"
	DetectorIPAddress                  DetectorType = "ip_address"
	DetectorResidentRegistrationNumber DetectorType = "resident_registration_number"
	DetectorAPIKey                     DetectorType = "api_key"
	DetectorProviderAPIKey             DetectorType = "provider_api_key"
	DetectorCloudAccessKey             DetectorType = "cloud_access_key"
	DetectorGitHubToken                DetectorType = "github_token"
	DetectorSlackToken                 DetectorType = "slack_token"
	DetectorDatabaseURL                DetectorType = "database_url"
	DetectorWebhookURL                 DetectorType = "webhook_url"
	DetectorPasswordAssignment         DetectorType = "password_assignment"
	DetectorSessionCookie              DetectorType = "session_cookie"
	DetectorCreditCard                 DetectorType = "credit_card"
	DetectorBankAccount                DetectorType = "bank_account"
	DetectorPassportNumber             DetectorType = "passport_number"
	DetectorDriverLicense              DetectorType = "driver_license"
	DetectorAuthorizationHeader        DetectorType = "authorization_header"
	DetectorJWT                        DetectorType = "jwt"
	DetectorPrivateKey                 DetectorType = "private_key"
)

const (
	PlaceholderEmail                      = "[EMAIL_REDACTED]"
	PlaceholderPhoneNumber                = "[PHONE_NUMBER_REDACTED]"
	PlaceholderAddress                    = "[ADDRESS_REDACTED]"
	PlaceholderDateOfBirth                = "[DATE_OF_BIRTH_REDACTED]"
	PlaceholderPersonName                 = "[PERSON_NAME_REDACTED]"
	PlaceholderCustomerID                 = "[CUSTOMER_ID_REDACTED]"
	PlaceholderEmployeeID                 = "[EMPLOYEE_ID_REDACTED]"
	PlaceholderAccountID                  = "[ACCOUNT_ID_REDACTED]"
	PlaceholderIPAddress                  = "[IP_ADDRESS_REDACTED]"
	PlaceholderResidentRegistrationNumber = "[RESIDENT_REGISTRATION_NUMBER_REDACTED]"
	PlaceholderAPIKey                     = "[API_KEY_REDACTED]"
	PlaceholderProviderAPIKey             = "[PROVIDER_API_KEY_REDACTED]"
	PlaceholderCloudAccessKey             = "[CLOUD_ACCESS_KEY_REDACTED]"
	PlaceholderGitHubToken                = "[GITHUB_TOKEN_REDACTED]"
	PlaceholderSlackToken                 = "[SLACK_TOKEN_REDACTED]"
	PlaceholderDatabaseURL                = "[DATABASE_URL_REDACTED]"
	PlaceholderWebhookURL                 = "[WEBHOOK_URL_REDACTED]"
	PlaceholderPassword                   = "[PASSWORD_REDACTED]"
	PlaceholderSessionCookie              = "[SESSION_COOKIE_REDACTED]"
	PlaceholderCreditCard                 = "[CREDIT_CARD_REDACTED]"
	PlaceholderBankAccount                = "[BANK_ACCOUNT_REDACTED]"
	PlaceholderPassportNumber             = "[PASSPORT_NUMBER_REDACTED]"
	PlaceholderDriverLicense              = "[DRIVER_LICENSE_REDACTED]"
	PlaceholderAuthorizationHeader        = "[AUTHORIZATION_HEADER_REDACTED]"
	PlaceholderJWT                        = "[JWT_REDACTED]"
	PlaceholderSecret                     = "[SECRET_REDACTED]"
)

type Result struct {
	Action                  Action
	DetectedTypes           []string
	DetectedCount           int
	RedactedPrompt          string
	RedactedPromptPreview   string
	SecurityPolicyVersionID string
}

func P0ActionForDetector(detectorType string) (Action, bool) {
	switch DetectorType(detectorType) {
	case DetectorEmail,
		DetectorPhoneNumber,
		DetectorPostalAddress,
		DetectorDateOfBirth,
		DetectorPersonName,
		DetectorCustomerID,
		DetectorEmployeeID,
		DetectorAccountID,
		DetectorIPAddress:
		return ActionRedacted, true
	case DetectorResidentRegistrationNumber,
		DetectorAPIKey,
		DetectorProviderAPIKey,
		DetectorCloudAccessKey,
		DetectorGitHubToken,
		DetectorSlackToken,
		DetectorDatabaseURL,
		DetectorWebhookURL,
		DetectorPasswordAssignment,
		DetectorSessionCookie,
		DetectorCreditCard,
		DetectorBankAccount,
		DetectorPassportNumber,
		DetectorDriverLicense,
		DetectorAuthorizationHeader,
		DetectorJWT,
		DetectorPrivateKey:
		return ActionBlocked, true
	default:
		return ActionNone, false
	}
}

func PlaceholderForDetector(detectorType string) (string, bool) {
	switch DetectorType(detectorType) {
	case DetectorEmail:
		return PlaceholderEmail, true
	case DetectorPhoneNumber:
		return PlaceholderPhoneNumber, true
	case DetectorPostalAddress:
		return PlaceholderAddress, true
	case DetectorDateOfBirth:
		return PlaceholderDateOfBirth, true
	case DetectorPersonName:
		return PlaceholderPersonName, true
	case DetectorCustomerID:
		return PlaceholderCustomerID, true
	case DetectorEmployeeID:
		return PlaceholderEmployeeID, true
	case DetectorAccountID:
		return PlaceholderAccountID, true
	case DetectorIPAddress:
		return PlaceholderIPAddress, true
	case DetectorResidentRegistrationNumber:
		return PlaceholderResidentRegistrationNumber, true
	case DetectorAPIKey:
		return PlaceholderAPIKey, true
	case DetectorProviderAPIKey:
		return PlaceholderProviderAPIKey, true
	case DetectorCloudAccessKey:
		return PlaceholderCloudAccessKey, true
	case DetectorGitHubToken:
		return PlaceholderGitHubToken, true
	case DetectorSlackToken:
		return PlaceholderSlackToken, true
	case DetectorDatabaseURL:
		return PlaceholderDatabaseURL, true
	case DetectorWebhookURL:
		return PlaceholderWebhookURL, true
	case DetectorPasswordAssignment:
		return PlaceholderPassword, true
	case DetectorSessionCookie:
		return PlaceholderSessionCookie, true
	case DetectorCreditCard:
		return PlaceholderCreditCard, true
	case DetectorBankAccount:
		return PlaceholderBankAccount, true
	case DetectorPassportNumber:
		return PlaceholderPassportNumber, true
	case DetectorDriverLicense:
		return PlaceholderDriverLicense, true
	case DetectorAuthorizationHeader:
		return PlaceholderAuthorizationHeader, true
	case DetectorJWT:
		return PlaceholderJWT, true
	case DetectorPrivateKey:
		return PlaceholderSecret, true
	default:
		return PlaceholderSecret, false
	}
}
