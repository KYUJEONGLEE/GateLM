package masking

import (
	"sort"
)

type Detection struct {
	Type        string
	Start       int
	End         int
	Action      Action
	Placeholder string
	Priority    int
}

type Detector interface {
	Type() string
	Priority() int
	Detect(input string) []Detection
}

type Registry struct {
	detectors []Detector
}

func NewRegistry(detectors ...Detector) Registry {
	registry := Registry{}
	for _, detector := range detectors {
		registry.Register(detector)
	}
	return registry
}

func NewP0Registry() Registry {
	return NewRegistry(
		NewRegexDetector(string(DetectorPrivateKey), `(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----`, 5),
		NewRegexDetector(string(DetectorSessionCookie), `(?i)\b(?:cookie|set-cookie)\s*:\s*(?:[^\r\n;]*;\s*)*(?:session(?:id)?|sid|auth(?:_token)?|access_token|refresh_token)=[A-Za-z0-9._~+/=-]{16,}`, 7),
		NewBoundaryRegexDetector(string(DetectorProviderAPIKey), `(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{20,})`, 8, isBase64URLTokenByte),
		NewBoundaryRegexDetector(string(DetectorCloudAccessKey), `(?:AKIA|ASIA)[A-Z0-9]{16}`, 9, isCloudAccessKeyByte),
		NewValidatingRegexDetector(
			string(DetectorCloudAccessKey),
			`(?i)\b(?:cloud[_-]?access[_-]?key|aws[_-]?access[_-]?key[_-]?id|azure[_-]?client[_-]?secret|gcp[_-]?private[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9_.-]{32,}`,
			9,
			CredentialAssignmentValidator(32, allowedCredentialRune),
		),
		NewBoundaryRegexDetector(string(DetectorGitHubToken), `(?:ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})`, 9, isGitHubTokenByte),
		NewBoundaryRegexDetector(string(DetectorSlackToken), `xox[abp]-[A-Za-z0-9-]{20,}`, 9, isSlackTokenByte),
		NewRegexDetector(string(DetectorDatabaseURL), `(?i)\b(?:postgres(?:ql)?|mysql|mariadb)://[^:\s/@]+:[^@\s/]{6,}@[^\s'")<>]+`, 9),
		NewRegexDetector(string(DetectorWebhookURL), `(?i)https://hooks\.slack\.com/services/[A-Za-z0-9/_-]{20,}|https://discord(?:app)?\.com/api/webhooks/\d{8,}/[A-Za-z0-9_-]{20,}|https://api\.github\.com/[^\s'")<>]*(?:token|secret)=[A-Za-z0-9_-]{20,}`, 10),
		NewValidatingRegexDetector(
			string(DetectorAPIKey),
			`(?i)\b(?:api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|id[_-]?token|secret[_-]?key|client[_-]?secret|provider[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9_.-]{32,}`,
			10,
			CredentialAssignmentValidator(32, allowedCredentialRune),
		),
		NewRegexDetector(string(DetectorAuthorizationHeader), `(?i)\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+[A-Za-z0-9._~+/\-=]{8,}`, 11),
		NewBoundaryRegexDetector(string(DetectorJWT), `eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}`, 12, isBase64URLTokenByte),
		NewCreditCardDetector(string(DetectorCreditCard), `\d(?:[ -]?\d){12,18}`, 13),
		NewRegexDetector(string(DetectorBankAccount), `(?i)\b(?:bank[_ -]?account|bank[_ -]?account[_ -]?number|account[_ -]?number)\b\s*[:=]?\s*['"]?(?:\d{2,6}[- ]?){2,5}\d{2,6}`, 14),
		NewValidatingRegexDetector(
			string(DetectorPasswordAssignment),
			`(?i)\b(?:password|passwd)\s*[:=]\s*['"]?[^\s'",;}]{12,}`,
			15,
			CredentialAssignmentValidator(12, allowedPasswordRune),
		),
		NewRegexDetector(string(DetectorPassportNumber), `(?i)\b(?:passport[_ -]?(?:no|number)|passport[_ -]?id)\s*[:=]\s*['"]?[A-Z][A-Z0-9]{7,8}\b`, 16),
		NewRegexDetector(string(DetectorDriverLicense), `(?i)\b(?:driver[_ -]?license(?:[_ -]?(?:no|number))?)\s*[:=]\s*['"]?(?:\d{2}[- ]?\d{2}[- ]?\d{6}[- ]?\d{2}|\d{12})\b`, 17),
		NewRegexDetector(string(DetectorResidentRegistrationNumber), `\b\d{6}[-\s]?[1-8]\d{6}\b`, 20),
		NewRegexDetector(string(DetectorDateOfBirth), `(?i)\b(?:date[_ -]?of[_ -]?birth|birth[_ -]?date|birthday|dob)\b\s*[:=]?\s*['"]?(?:\d{4}[-./]\d{1,2}[-./]\d{1,2})`, 30),
		NewRegexDetector(string(DetectorPersonName), `(?i)\b(?:name|customer[_ -]?name|contact[_ -]?name|manager)\b\s*[:=]\s*['"]?(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})`, 31),
		NewRegexDetector(string(DetectorCustomerID), `(?i)\b(?:customer[_ -]?id|customer[_ -]?no)\b\s*[:=]?\s*['"]?(?:cus_[A-Za-z0-9_-]{6,}|[A-Za-z0-9_-]{6,})`, 32),
		NewRegexDetector(string(DetectorEmployeeID), `(?i)\b(?:employee[_ -]?id|employee[_ -]?no)\b\s*[:=]?\s*['"]?(?:E\d{5,}|[A-Z]{1,3}\d{5,}|\d{6,})`, 33),
		NewRegexDetector(string(DetectorAccountID), `(?i)\b(?:account[_ -]?id|account[_ -]?no|acct[_ -]?id)\b\s*[:=]?\s*['"]?(?:acct_[A-Za-z0-9_-]{6,}|[A-Za-z0-9_-]{8,})`, 34),
		NewRegexDetector(string(DetectorPostalAddress), `(?i)\b(?:address|shipping[_ -]?address|postal[_ -]?address)\b\s*[:=]\s*['"]?[A-Za-z0-9\s,.-]{6,80}(?:street|st\.|road|rd\.|avenue|ave\.|blvd|drive|dr\.)\s*\d{0,5}(?:-\d{1,5})?|\b(?:postal[_ -]?code|zip)\b\s*[:=]\s*\d{5}`, 35),
		NewRegexDetector(string(DetectorPhoneNumber), `\b(?:\+82[-.\s]?)?(?:0?1[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}\b`, 40),
		NewPublicIPAddressDetector(string(DetectorIPAddress), `(?:\d{1,3}\.){3}\d{1,3}|(?:[A-Fa-f0-9]{0,4}:){2,7}[A-Fa-f0-9]{0,4}`, 45),
		NewRegexDetector(string(DetectorEmail), `(?i)\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b`, 50),
	)
}

func (r *Registry) Register(detector Detector) {
	if detector == nil {
		return
	}
	r.detectors = append(r.detectors, detector)
	sort.SliceStable(r.detectors, func(i int, j int) bool {
		return r.detectors[i].Priority() < r.detectors[j].Priority()
	})
}

func (r Registry) Detect(input string) []Detection {
	var detections []Detection
	for _, detector := range r.detectors {
		detections = append(detections, detector.Detect(input)...)
	}
	return detections
}
