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
		NewRegexDetector(string(DetectorAPIKey), `(?i)\b(?:api[_-]?key|secret|token|access[_-]?key|client[_-]?secret)\s*[:=]\s*['"]?[A-Za-z0-9_.-]{20,}`, 10),
		NewRegexDetector(string(DetectorAuthorizationHeader), `(?i)\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+[A-Za-z0-9._~+/\-=]{8,}`, 11),
		NewRegexDetector(string(DetectorJWT), `\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b`, 12),
		NewRegexDetector(string(DetectorResidentRegistrationNumber), `\b\d{6}[-\s]?[1-8]\d{6}\b`, 20),
		NewCaptureRegexDetector(string(DetectorPersonName), `(?i)\b(?:name|customer[_ -]?name|contact[_ -]?name|manager|agent[_ -]?name|doctor[_ -]?name|patient[_ -]?name)\s*[:=]\s*['"]?([A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2})`, 1, 31),
		NewCaptureRegexDetector(string(DetectorPersonName), `(?i)\b(?:customer|agent|support agent|doctor|physician|patient)\s+([A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2})`, 1, 32),
		NewCaptureRegexDetector(string(DetectorPersonName), `(?:\x{ACE0}\x{AC1D}|\x{ACE0}\x{AC1D}\x{BA85}|\x{C0C1}\x{B2F4}\x{C6D0}|\x{C0C1}\x{B2F4}\x{C0AC}|\x{B2F4}\x{B2F9}\s*\x{C758}\x{C0AC}|\x{C758}\x{C0AC}|\x{C8FC}\x{CE58}\x{C758}|\x{D658}\x{C790})\s+([\x{AC00}-\x{D7A3}]{2,3}?)(?:\x{C5D0}\x{AC8C}|[\x{C774}\x{AC00}\x{C740}\x{B294}\x{C744}\x{B97C}]|[\s,.]|$)`, 1, 33),
		NewMultiCaptureRegexDetector(string(DetectorPersonName), `([\x{AC00}-\x{D7A3}]{2,4})\x{C758}\s*`+relationshipRolePattern()+`\s+([\x{AC00}-\x{D7A3}]{2,4})(?:[\x{C774}\x{AC00}\x{C740}\x{B294}\x{C744}\x{B97C}]|[\s,.]|$)`, []int{1, 2}, 34),
		NewCaptureRegexDetector(string(DetectorPostalAddress), `(?i)\b(?:address|shipping[_ -]?address|postal[_ -]?address)\s*[:=]\s*['"]?([0-9]{1,6}\s+[A-Za-z0-9 .'-]{2,60}\s+(?:Street|St\.|Road|Rd\.|Avenue|Ave\.|Boulevard|Blvd\.|Drive|Dr\.|Lane|Ln\.|Way))`, 1, 35),
		NewCaptureRegexDetector(string(DetectorOrganizationName), `(?i)\b(?:organization|organization[_ -]?name|company|company[_ -]?name|org)\s*[:=]\s*['"]?([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Za-z0-9&.'-]+){0,4})`, 1, 36),
		NewRegexDetector(string(DetectorPhoneNumber), `\b(?:\+82[-.\s]?)?(?:0?1[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}\b`, 40),
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
