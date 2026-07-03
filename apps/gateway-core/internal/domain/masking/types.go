package masking

type Action string

const (
	ActionNone     Action = "none"
	ActionRedacted Action = "redacted"
	ActionBlocked  Action = "blocked"
)

type PolicyAction string

const (
	PolicyActionAllow  PolicyAction = "allow"
	PolicyActionRedact PolicyAction = "redact"
	PolicyActionBlock  PolicyAction = "block"
)

type DetectorType string

const (
	DetectorEmail                      DetectorType = "email"
	DetectorPhoneNumber                DetectorType = "phone_number"
	DetectorResidentRegistrationNumber DetectorType = "resident_registration_number"
	DetectorAPIKey                     DetectorType = "api_key"
	DetectorAuthorizationHeader        DetectorType = "authorization_header"
	DetectorJWT                        DetectorType = "jwt"
	DetectorPrivateKey                 DetectorType = "private_key"
)

const (
	PlaceholderEmail                      = "[EMAIL_REDACTED]"
	PlaceholderPhoneNumber                = "[PHONE_NUMBER_REDACTED]"
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
	PolicyAllowedTypes      []string
	PolicyAllowedCount      int
	MandatoryProtectedTypes []string
	RedactedPrompt          string
	LogSafePrompt           string
	RedactedPromptPreview   string
	SecurityPolicyVersionID string
}

type DetectorPolicy struct {
	DetectorType string
	Action       PolicyAction
}

func P0ActionForDetector(detectorType string) (Action, bool) {
	switch DetectorType(detectorType) {
	case DetectorEmail, DetectorPhoneNumber:
		return ActionRedacted, true
	case DetectorResidentRegistrationNumber, DetectorAPIKey, DetectorAuthorizationHeader, DetectorJWT, DetectorPrivateKey:
		return ActionBlocked, true
	default:
		return ActionNone, false
	}
}

func IsMandatoryDetector(detectorType string) bool {
	switch DetectorType(detectorType) {
	case DetectorResidentRegistrationNumber, DetectorAPIKey, DetectorAuthorizationHeader, DetectorJWT, DetectorPrivateKey:
		return true
	default:
		return false
	}
}

func PlaceholderForDetector(detectorType string) (string, bool) {
	switch DetectorType(detectorType) {
	case DetectorEmail:
		return PlaceholderEmail, true
	case DetectorPhoneNumber:
		return PlaceholderPhoneNumber, true
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
