package masking

import (
	"net/netip"
	"regexp"
	"strings"
	"unicode"
)

var documentationAddressPrefixes = []netip.Prefix{
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("2001:db8::/32"),
}

type RegexDetector struct {
	detectorType string
	pattern      *regexp.Regexp
	priority     int
	action       Action
	placeholder  string
}

func NewRegexDetector(detectorType string, pattern string, priority int) RegexDetector {
	action, ok := P0ActionForDetector(detectorType)
	if !ok {
		action = ActionNone
	}
	placeholder, ok := PlaceholderForDetector(detectorType)
	if !ok {
		placeholder = PlaceholderSecret
	}

	return RegexDetector{
		detectorType: detectorType,
		pattern:      regexp.MustCompile(pattern),
		priority:     priority,
		action:       action,
		placeholder:  placeholder,
	}
}

func (d RegexDetector) Type() string {
	return d.detectorType
}

func (d RegexDetector) Priority() int {
	return d.priority
}

func (d RegexDetector) Detect(input string) []Detection {
	if d.pattern == nil || input == "" {
		return nil
	}

	matches := d.pattern.FindAllStringIndex(input, -1)
	detections := make([]Detection, 0, len(matches))
	for _, match := range matches {
		if len(match) != 2 || match[0] < 0 || match[1] <= match[0] || match[1] > len(input) {
			continue
		}
		detections = append(detections, Detection{
			Type:        d.detectorType,
			Start:       match[0],
			End:         match[1],
			Action:      d.action,
			Placeholder: d.placeholder,
			Priority:    d.priority,
		})
	}
	return detections
}

type MatchValidator func(input string, start int, end int) bool

type ValidatingRegexDetector struct {
	detectorType string
	pattern      *regexp.Regexp
	priority     int
	action       Action
	placeholder  string
	validate     MatchValidator
}

func NewValidatingRegexDetector(detectorType string, pattern string, priority int, validate MatchValidator) ValidatingRegexDetector {
	action, ok := P0ActionForDetector(detectorType)
	if !ok {
		action = ActionNone
	}
	placeholder, ok := PlaceholderForDetector(detectorType)
	if !ok {
		placeholder = PlaceholderSecret
	}

	return ValidatingRegexDetector{
		detectorType: detectorType,
		pattern:      regexp.MustCompile(pattern),
		priority:     priority,
		action:       action,
		placeholder:  placeholder,
		validate:     validate,
	}
}

func NewBoundaryRegexDetector(detectorType string, pattern string, priority int, isTokenByte func(byte) bool) ValidatingRegexDetector {
	return NewValidatingRegexDetector(
		detectorType,
		pattern,
		priority,
		func(input string, start int, end int) bool {
			return hasByteBoundary(input, start, end, isTokenByte)
		},
	)
}

func (d ValidatingRegexDetector) Type() string {
	return d.detectorType
}

func (d ValidatingRegexDetector) Priority() int {
	return d.priority
}

func (d ValidatingRegexDetector) Detect(input string) []Detection {
	if d.pattern == nil || input == "" {
		return nil
	}

	matches := d.pattern.FindAllStringIndex(input, -1)
	detections := make([]Detection, 0, len(matches))
	for _, match := range matches {
		if len(match) != 2 || match[0] < 0 || match[1] <= match[0] || match[1] > len(input) {
			continue
		}
		if d.validate != nil && !d.validate(input, match[0], match[1]) {
			continue
		}
		detections = append(detections, Detection{
			Type:        d.detectorType,
			Start:       match[0],
			End:         match[1],
			Action:      d.action,
			Placeholder: d.placeholder,
			Priority:    d.priority,
		})
	}
	return detections
}

type CreditCardDetector struct {
	detectorType string
	pattern      *regexp.Regexp
	priority     int
	action       Action
	placeholder  string
}

func NewCreditCardDetector(detectorType string, pattern string, priority int) CreditCardDetector {
	action, ok := P0ActionForDetector(detectorType)
	if !ok {
		action = ActionNone
	}
	placeholder, ok := PlaceholderForDetector(detectorType)
	if !ok {
		placeholder = PlaceholderSecret
	}

	return CreditCardDetector{
		detectorType: detectorType,
		pattern:      regexp.MustCompile(pattern),
		priority:     priority,
		action:       action,
		placeholder:  placeholder,
	}
}

func (d CreditCardDetector) Type() string {
	return d.detectorType
}

func (d CreditCardDetector) Priority() int {
	return d.priority
}

func (d CreditCardDetector) Detect(input string) []Detection {
	if d.pattern == nil || input == "" {
		return nil
	}

	matches := d.pattern.FindAllStringIndex(input, -1)
	detections := make([]Detection, 0, len(matches))
	for _, match := range matches {
		if len(match) != 2 || !hasByteBoundary(input, match[0], match[1], isDigitByte) {
			continue
		}
		digits := digitsOnly(input[match[0]:match[1]])
		if len(digits) < 13 || len(digits) > 19 || !passesLuhnCheck(digits) {
			continue
		}
		detections = append(detections, Detection{
			Type:        d.detectorType,
			Start:       match[0],
			End:         match[1],
			Action:      d.action,
			Placeholder: d.placeholder,
			Priority:    d.priority,
		})
	}
	return detections
}

type PublicIPAddressDetector struct {
	detectorType string
	pattern      *regexp.Regexp
	priority     int
	action       Action
	placeholder  string
}

func NewPublicIPAddressDetector(detectorType string, pattern string, priority int) PublicIPAddressDetector {
	action, ok := P0ActionForDetector(detectorType)
	if !ok {
		action = ActionNone
	}
	placeholder, ok := PlaceholderForDetector(detectorType)
	if !ok {
		placeholder = PlaceholderSecret
	}

	return PublicIPAddressDetector{
		detectorType: detectorType,
		pattern:      regexp.MustCompile(pattern),
		priority:     priority,
		action:       action,
		placeholder:  placeholder,
	}
}

func (d PublicIPAddressDetector) Type() string {
	return d.detectorType
}

func (d PublicIPAddressDetector) Priority() int {
	return d.priority
}

func (d PublicIPAddressDetector) Detect(input string) []Detection {
	if d.pattern == nil || input == "" {
		return nil
	}

	matches := d.pattern.FindAllStringIndex(input, -1)
	detections := make([]Detection, 0, len(matches))
	for _, match := range matches {
		if len(match) != 2 || !hasByteBoundary(input, match[0], match[1], isIPTokenByte) {
			continue
		}
		if !isPublicIPAddress(input[match[0]:match[1]]) {
			continue
		}
		detections = append(detections, Detection{
			Type:        d.detectorType,
			Start:       match[0],
			End:         match[1],
			Action:      d.action,
			Placeholder: d.placeholder,
			Priority:    d.priority,
		})
	}
	return detections
}

func CredentialAssignmentValidator(minLength int, allowed func(rune) bool) MatchValidator {
	return func(input string, start int, end int) bool {
		value := assignmentValue(input[start:end])
		if len(value) < minLength {
			return false
		}
		hasLetter := false
		hasDigit := false
		for _, char := range value {
			if !allowed(char) {
				return false
			}
			if unicode.IsLetter(char) {
				hasLetter = true
			}
			if unicode.IsDigit(char) {
				hasDigit = true
			}
		}
		return hasLetter && hasDigit
	}
}

func assignmentValue(match string) string {
	index := strings.IndexAny(match, ":=")
	if index < 0 || index+1 >= len(match) {
		return ""
	}
	value := strings.TrimSpace(match[index+1:])
	value = strings.TrimLeft(value, `"'`)
	value = strings.TrimRight(value, `"'.,;}`)
	return value
}

func allowedCredentialRune(char rune) bool {
	return ('a' <= char && char <= 'z') ||
		('A' <= char && char <= 'Z') ||
		('0' <= char && char <= '9') ||
		char == '_' ||
		char == '.' ||
		char == '-'
}

func allowedPasswordRune(char rune) bool {
	return !unicode.IsSpace(char) &&
		char != '"' &&
		char != '\'' &&
		char != ',' &&
		char != ';' &&
		char != '}'
}

func hasByteBoundary(input string, start int, end int, isTokenByte func(byte) bool) bool {
	if start > 0 && isTokenByte(input[start-1]) {
		return false
	}
	if end < len(input) && isTokenByte(input[end]) {
		return false
	}
	return true
}

func isBase64URLTokenByte(value byte) bool {
	return isAlphaNumericByte(value) || value == '_' || value == '-'
}

func isGitHubTokenByte(value byte) bool {
	return isAlphaNumericByte(value) || value == '_'
}

func isSlackTokenByte(value byte) bool {
	return isAlphaNumericByte(value) || value == '-'
}

func isCloudAccessKeyByte(value byte) bool {
	return ('A' <= value && value <= 'Z') || ('0' <= value && value <= '9')
}

func isIPTokenByte(value byte) bool {
	return isAlphaNumericByte(value) || value == '_' || value == '.' || value == ':' || value == '-'
}

func isAlphaNumericByte(value byte) bool {
	return ('a' <= value && value <= 'z') ||
		('A' <= value && value <= 'Z') ||
		('0' <= value && value <= '9')
}

func isDigitByte(value byte) bool {
	return '0' <= value && value <= '9'
}

func digitsOnly(value string) string {
	var builder strings.Builder
	for index := 0; index < len(value); index++ {
		char := value[index]
		if isDigitByte(char) {
			builder.WriteByte(char)
		}
	}
	return builder.String()
}

func passesLuhnCheck(digits string) bool {
	total := 0
	doubleNext := false
	for index := len(digits) - 1; index >= 0; index-- {
		value := int(digits[index] - '0')
		if doubleNext {
			value *= 2
			if value > 9 {
				value -= 9
			}
		}
		total += value
		doubleNext = !doubleNext
	}
	return total%10 == 0
}

func isPublicIPAddress(value string) bool {
	addr, err := netip.ParseAddr(strings.Trim(value, "[]"))
	if err != nil {
		return false
	}
	addr = addr.Unmap()
	if !addr.IsGlobalUnicast() ||
		addr.IsPrivate() ||
		addr.IsLoopback() ||
		addr.IsLinkLocalUnicast() ||
		addr.IsLinkLocalMulticast() ||
		addr.IsMulticast() ||
		addr.IsUnspecified() {
		return false
	}
	return !isDocumentationAddress(addr)
}

func isDocumentationAddress(addr netip.Addr) bool {
	for _, prefix := range documentationAddressPrefixes {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}
