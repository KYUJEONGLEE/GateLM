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
	DetectorPersonName                 DetectorType = "person_name"
	DetectorOrganizationName           DetectorType = "organization_name"
	DetectorResidentRegistrationNumber DetectorType = "resident_registration_number"
	DetectorAPIKey                     DetectorType = "api_key"
	DetectorAuthorizationHeader        DetectorType = "authorization_header"
	DetectorJWT                        DetectorType = "jwt"
	DetectorPrivateKey                 DetectorType = "private_key"
)

const (
	PlaceholderEmail                      = "[EMAIL_REDACTED]"
	PlaceholderPhoneNumber                = "[PHONE_NUMBER_REDACTED]"
	PlaceholderPostalAddress              = "[ADDRESS_REDACTED]"
	PlaceholderPersonName                 = "[PERSON_NAME_REDACTED]"
	PlaceholderOrganizationName           = "[ORGANIZATION_NAME_REDACTED]"
	PlaceholderResidentRegistrationNumber = "[RESIDENT_REGISTRATION_NUMBER_REDACTED]"
	PlaceholderAPIKey                     = "[API_KEY_REDACTED]"
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
	case DetectorEmail, DetectorPhoneNumber, DetectorPostalAddress, DetectorPersonName, DetectorOrganizationName:
		return ActionRedacted, true
	case DetectorResidentRegistrationNumber, DetectorAPIKey, DetectorAuthorizationHeader, DetectorJWT, DetectorPrivateKey:
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
		return PlaceholderPostalAddress, true
	case DetectorPersonName:
		return PlaceholderPersonName, true
	case DetectorOrganizationName:
		return PlaceholderOrganizationName, true
	case DetectorResidentRegistrationNumber:
		return PlaceholderResidentRegistrationNumber, true
	case DetectorAPIKey:
		return PlaceholderAPIKey, true
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
