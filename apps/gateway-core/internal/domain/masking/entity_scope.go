package masking

import (
	"fmt"
	"strings"
	"unicode"
)

type EntityScope struct {
	placeholders map[string]map[string]string
	counters     map[string]int
}

func NewEntityScope() *EntityScope {
	return &EntityScope{
		placeholders: map[string]map[string]string{},
		counters:     map[string]int{},
	}
}

func (s *EntityScope) PlaceholderFor(detectorType string, rawValue string, fallback string) string {
	return s.PlaceholderForRole(detectorType, rawValue, "", fallback)
}

func (s *EntityScope) PlaceholderForRole(detectorType string, rawValue string, rolePrefix string, fallback string) string {
	prefix, ok := entityPlaceholderPrefix(detectorType, rolePrefix)
	if !ok {
		return fallback
	}

	normalized := normalizeEntityKey(detectorType, rawValue)
	if normalized == "" {
		return fallback
	}

	if s.placeholders == nil {
		s.placeholders = map[string]map[string]string{}
	}
	if s.counters == nil {
		s.counters = map[string]int{}
	}
	typePlaceholders := s.placeholders[detectorType]
	if typePlaceholders == nil {
		typePlaceholders = map[string]string{}
		s.placeholders[detectorType] = typePlaceholders
	}
	if placeholder, ok := typePlaceholders[normalized]; ok {
		return placeholder
	}

	s.counters[prefix]++
	placeholder := fmt.Sprintf("[%s_%d]", prefix, s.counters[prefix])
	typePlaceholders[normalized] = placeholder
	return placeholder
}

func entityPlaceholderPrefix(detectorType string, rolePrefix string) (string, bool) {
	switch DetectorType(detectorType) {
	case DetectorPersonName:
		if isSupportedPersonRolePrefix(rolePrefix) {
			return rolePrefix, true
		}
		return "PERSON", true
	case DetectorOrganizationName:
		return "ORGANIZATION", true
	case DetectorPostalAddress:
		return "ADDRESS", true
	case DetectorEmail:
		return "EMAIL", true
	case DetectorPhoneNumber:
		return "PHONE_NUMBER", true
	default:
		return "", false
	}
}

func isSupportedPersonRolePrefix(prefix string) bool {
	switch prefix {
	case "CUSTOMER", "AGENT", "DOCTOR", "PATIENT":
		return true
	default:
		return false
	}
}

func normalizeEntityKey(detectorType string, rawValue string) string {
	switch DetectorType(detectorType) {
	case DetectorPersonName, DetectorOrganizationName, DetectorPostalAddress:
		return strings.Join(strings.Fields(strings.TrimSpace(rawValue)), " ")
	case DetectorEmail:
		return strings.TrimSpace(rawValue)
	case DetectorPhoneNumber:
		var builder strings.Builder
		for _, r := range rawValue {
			if unicode.IsDigit(r) {
				builder.WriteRune(r)
			}
		}
		return builder.String()
	default:
		return strings.TrimSpace(rawValue)
	}
}
