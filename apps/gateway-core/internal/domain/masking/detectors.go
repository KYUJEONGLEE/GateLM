package masking

import "regexp"

type RegexDetector struct {
	detectorType string
	pattern      *regexp.Regexp
	priority     int
	action       Action
	placeholder  string
}

type CaptureRegexDetector struct {
	detectorType string
	pattern      *regexp.Regexp
	captureGroup int
	priority     int
	action       Action
	placeholder  string
}

type MultiCaptureRegexDetector struct {
	detectorType   string
	pattern        *regexp.Regexp
	captureGroups  []int
	priority       int
	action         Action
	placeholder    string
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

func NewCaptureRegexDetector(detectorType string, pattern string, captureGroup int, priority int) CaptureRegexDetector {
	action, ok := P0ActionForDetector(detectorType)
	if !ok {
		action = ActionNone
	}
	placeholder, ok := PlaceholderForDetector(detectorType)
	if !ok {
		placeholder = PlaceholderSecret
	}

	return CaptureRegexDetector{
		detectorType: detectorType,
		pattern:      regexp.MustCompile(pattern),
		captureGroup: captureGroup,
		priority:     priority,
		action:       action,
		placeholder:  placeholder,
	}
}

func NewMultiCaptureRegexDetector(detectorType string, pattern string, captureGroups []int, priority int) MultiCaptureRegexDetector {
	action, ok := P0ActionForDetector(detectorType)
	if !ok {
		action = ActionNone
	}
	placeholder, ok := PlaceholderForDetector(detectorType)
	if !ok {
		placeholder = PlaceholderSecret
	}

	return MultiCaptureRegexDetector{
		detectorType:  detectorType,
		pattern:       regexp.MustCompile(pattern),
		captureGroups: append([]int(nil), captureGroups...),
		priority:      priority,
		action:        action,
		placeholder:   placeholder,
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

func (d CaptureRegexDetector) Type() string {
	return d.detectorType
}

func (d CaptureRegexDetector) Priority() int {
	return d.priority
}

func (d CaptureRegexDetector) Detect(input string) []Detection {
	if d.pattern == nil || input == "" || d.captureGroup <= 0 {
		return nil
	}

	matches := d.pattern.FindAllStringSubmatchIndex(input, -1)
	detections := make([]Detection, 0, len(matches))
	groupStartIndex := d.captureGroup * 2
	groupEndIndex := groupStartIndex + 1
	for _, match := range matches {
		if len(match) <= groupEndIndex {
			continue
		}
		start := match[groupStartIndex]
		end := match[groupEndIndex]
		if start < 0 || end <= start || end > len(input) {
			continue
		}
		detections = append(detections, Detection{
			Type:        d.detectorType,
			Start:       start,
			End:         end,
			Action:      d.action,
			Placeholder: d.placeholder,
			Priority:    d.priority,
		})
	}
	return detections
}

func (d MultiCaptureRegexDetector) Type() string {
	return d.detectorType
}

func (d MultiCaptureRegexDetector) Priority() int {
	return d.priority
}

func (d MultiCaptureRegexDetector) Detect(input string) []Detection {
	if d.pattern == nil || input == "" || len(d.captureGroups) == 0 {
		return nil
	}

	matches := d.pattern.FindAllStringSubmatchIndex(input, -1)
	var detections []Detection
	for _, match := range matches {
		for _, captureGroup := range d.captureGroups {
			if captureGroup <= 0 {
				continue
			}
			groupStartIndex := captureGroup * 2
			groupEndIndex := groupStartIndex + 1
			if len(match) <= groupEndIndex {
				continue
			}
			start := match[groupStartIndex]
			end := match[groupEndIndex]
			if start < 0 || end <= start || end > len(input) {
				continue
			}
			detections = append(detections, Detection{
				Type:        d.detectorType,
				Start:       start,
				End:         end,
				Action:      d.action,
				Placeholder: d.placeholder,
				Priority:    d.priority,
			})
		}
	}
	return detections
}
