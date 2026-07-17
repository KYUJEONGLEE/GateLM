package masking

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

const maximumSeededPlaceholderCounter = 1_000_000

var numberedPlaceholderPattern = regexp.MustCompile(`\[([A-Z][A-Z_]*)_([1-9][0-9]{0,6})\]`)

type EntityScope struct {
	placeholders  map[string]map[string]string
	counters      map[string]int
	personAnchors map[string]personAliasAnchor
}

type personAliasAnchor struct {
	fullName    string
	familyName  string
	givenName   string
	placeholder string
}

func NewEntityScope() *EntityScope {
	return &EntityScope{
		placeholders:  map[string]map[string]string{},
		counters:      map[string]int{},
		personAnchors: map[string]personAliasAnchor{},
	}
}

// SeedPlaceholderCounters reserves identifiers that already exist in trusted,
// redacted conversation history. It never restores or retains raw entity
// values; it only prevents a new entity from reusing an existing identifier.
func (s *EntityScope) SeedPlaceholderCounters(counters map[string]int) {
	if s == nil {
		return
	}
	s.ensureState()
	for prefix, count := range counters {
		if !isSupportedPlaceholderPrefix(prefix) || count < 0 || count > maximumSeededPlaceholderCounter {
			continue
		}
		if count > s.counters[prefix] {
			s.counters[prefix] = count
		}
	}
}

// PlaceholderCounters returns a defensive, raw-value-free snapshot that can
// seed another masking runtime without exposing entity-to-placeholder maps.
func (s *EntityScope) PlaceholderCounters() map[string]int {
	if s == nil || len(s.counters) == 0 {
		return nil
	}
	counters := make(map[string]int, len(s.counters))
	for prefix, count := range s.counters {
		if !isSupportedPlaceholderPrefix(prefix) || count <= 0 {
			continue
		}
		if count > maximumSeededPlaceholderCounter {
			count = maximumSeededPlaceholderCounter
		}
		counters[prefix] = count
	}
	if len(counters) == 0 {
		return nil
	}
	return counters
}

// SeedFromRedactedText scans only GateLM placeholder tokens. It does not run
// PII detectors and does not reinterpret the surrounding trusted text.
func (s *EntityScope) SeedFromRedactedText(value string) {
	if s == nil || value == "" {
		return
	}
	counters := make(map[string]int)
	for _, match := range numberedPlaceholderPattern.FindAllStringSubmatch(value, -1) {
		if len(match) != 3 || !isSupportedPlaceholderPrefix(match[1]) {
			continue
		}
		count, err := strconv.Atoi(match[2])
		if err != nil || count > maximumSeededPlaceholderCounter {
			continue
		}
		if count > counters[match[1]] {
			counters[match[1]] = count
		}
	}
	s.SeedPlaceholderCounters(counters)
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

	if DetectorType(detectorType) == DetectorPersonName {
		return s.placeholderForPerson(normalized, prefix)
	}
	return s.placeholderForNormalized(detectorType, normalized, prefix)
}

func (s *EntityScope) placeholderForPerson(normalized string, prefix string) string {
	s.ensureState()
	typePlaceholders := s.typePlaceholders(string(DetectorPersonName))
	if placeholder, ok := typePlaceholders[normalized]; ok {
		return placeholder
	}

	if placeholder, ok := s.resolvePersonAlias(normalized); ok {
		typePlaceholders[normalized] = placeholder
		return placeholder
	}

	placeholder := s.nextPlaceholder(prefix)
	typePlaceholders[normalized] = placeholder
	if anchor, ok := newPersonAliasAnchor(normalized, placeholder); ok {
		s.personAnchors[anchor.fullName] = anchor
	}
	return placeholder
}

func (s *EntityScope) placeholderForNormalized(detectorType string, normalized string, prefix string) string {
	s.ensureState()
	typePlaceholders := s.typePlaceholders(detectorType)
	if placeholder, ok := typePlaceholders[normalized]; ok {
		return placeholder
	}

	placeholder := s.nextPlaceholder(prefix)
	typePlaceholders[normalized] = placeholder
	return placeholder
}

func (s *EntityScope) ensureState() {
	if s.placeholders == nil {
		s.placeholders = map[string]map[string]string{}
	}
	if s.counters == nil {
		s.counters = map[string]int{}
	}
	if s.personAnchors == nil {
		s.personAnchors = map[string]personAliasAnchor{}
	}
}

func (s *EntityScope) typePlaceholders(detectorType string) map[string]string {
	typePlaceholders := s.placeholders[detectorType]
	if typePlaceholders == nil {
		typePlaceholders = map[string]string{}
		s.placeholders[detectorType] = typePlaceholders
	}
	return typePlaceholders
}

func (s *EntityScope) nextPlaceholder(prefix string) string {
	s.counters[prefix]++
	placeholder := fmt.Sprintf("[%s_%d]", prefix, s.counters[prefix])
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
	case "CUSTOMER", "AGENT", "DOCTOR", "PATIENT", "APPLICANT", "INTERVIEWER":
		return true
	default:
		return false
	}
}

func isSupportedPlaceholderPrefix(prefix string) bool {
	switch prefix {
	case "PERSON", "ORGANIZATION", "ADDRESS", "EMAIL", "PHONE_NUMBER":
		return true
	default:
		return isSupportedPersonRolePrefix(prefix)
	}
}

func normalizeEntityKey(detectorType string, rawValue string) string {
	switch DetectorType(detectorType) {
	case DetectorPersonName:
		return normalizePersonAliasKey(rawValue)
	case DetectorOrganizationName, DetectorPostalAddress:
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

func (s *EntityScope) resolvePersonAlias(normalized string) (string, bool) {
	if len(s.personAnchors) == 0 || isKoreanFullNameKey(normalized) || !isKoreanAliasKey(normalized) {
		return "", false
	}

	var matchedPlaceholder string
	matches := 0
	for _, anchor := range s.personAnchors {
		if !personAliasMatchesAnchor(normalized, anchor) {
			continue
		}
		matchedPlaceholder = anchor.placeholder
		matches++
		if matches > 1 {
			return "", false
		}
	}
	return matchedPlaceholder, matches == 1
}

func personAliasMatchesAnchor(alias string, anchor personAliasAnchor) bool {
	aliasRunes := []rune(alias)
	switch {
	case len(aliasRunes) == 1:
		return alias == anchor.familyName
	case len(aliasRunes) >= 2:
		return alias == anchor.givenName || strings.HasSuffix(anchor.fullName, alias)
	default:
		return false
	}
}

func newPersonAliasAnchor(normalized string, placeholder string) (personAliasAnchor, bool) {
	if !isKoreanFullNameKey(normalized) {
		return personAliasAnchor{}, false
	}
	runes := []rune(normalized)
	return personAliasAnchor{
		fullName:    normalized,
		familyName:  string(runes[0]),
		givenName:   string(runes[1:]),
		placeholder: placeholder,
	}, true
}

func normalizePersonAliasKey(rawValue string) string {
	normalized := strings.Join(strings.Fields(strings.TrimSpace(rawValue)), " ")
	normalized = stripPersonHonorificSuffix(normalized)
	normalized = stripPersonBusinessRoleSuffix(normalized)
	normalized = stripPersonHonorificSuffix(normalized)
	if koreanKey := strings.ReplaceAll(normalized, " ", ""); isKoreanAliasKey(koreanKey) {
		return koreanKey
	}
	return normalized
}

func stripPersonHonorificSuffix(value string) string {
	for {
		trimmed := strings.TrimSpace(value)
		withoutHonorific := strings.TrimSuffix(trimmed, "\ub2d8")
		withoutHonorific = strings.TrimSuffix(withoutHonorific, "\uc528")
		withoutHonorific = strings.TrimSpace(withoutHonorific)
		if withoutHonorific == trimmed {
			return trimmed
		}
		value = withoutHonorific
	}
}

func stripPersonBusinessRoleSuffix(value string) string {
	trimmed := strings.TrimSpace(value)
	for _, role := range businessRoleLabels {
		if len(trimmed) <= len(role) || !strings.EqualFold(trimmed[len(trimmed)-len(role):], role) {
			continue
		}

		beforeRoleWithSpace := trimmed[:len(trimmed)-len(role)]
		beforeRole := strings.TrimRightFunc(beforeRoleWithSpace, unicode.IsSpace)
		if beforeRole == "" {
			continue
		}
		if len(beforeRole) == len(beforeRoleWithSpace) && !isKoreanPersonStem(beforeRole) {
			continue
		}
		return beforeRole
	}
	return trimmed
}

func isKoreanFullNameKey(value string) bool {
	runes := []rune(value)
	return (len(runes) == 3 || len(runes) == 4) && areKoreanSyllables(runes)
}

func isKoreanAliasKey(value string) bool {
	runes := []rune(value)
	return len(runes) > 0 && areKoreanSyllables(runes)
}

func areKoreanSyllables(runes []rune) bool {
	for _, r := range runes {
		if r < '\uac00' || r > '\ud7a3' {
			return false
		}
	}
	return true
}
