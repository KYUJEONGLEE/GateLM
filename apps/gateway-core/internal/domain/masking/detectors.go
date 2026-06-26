package masking

import "regexp"

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
