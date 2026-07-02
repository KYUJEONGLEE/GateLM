package masking

import (
	"regexp"
	"strings"
)

var structureEmailPattern = regexp.MustCompile(`(?i)[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}`)

var personNameStructureSuffixes = []string{
	"\uc5d0\uac8c",
	"\uc5d0\uc11c",
	"\uc73c\ub85c",
	"\ub2d8",
	"\uc528",
	"\uc740",
	"\ub294",
	"\uc774",
	"\uac00",
	"\uc744",
	"\ub97c",
	"\uc5d0",
	"\uc640",
	"\uacfc",
	"\uc758",
	"\ub3c4",
	"\ub9cc",
	"\ub85c",
}

func normalizeDetectionSpans(input string, detections []Detection) []Detection {
	if len(detections) == 0 {
		return detections
	}

	normalized := make([]Detection, len(detections))
	copy(normalized, detections)
	for index, detection := range normalized {
		if detection.Start < 0 || detection.End > len(input) || detection.End <= detection.Start {
			continue
		}
		normalized[index] = normalizeDetectionSpan(input, detection)
	}
	return normalized
}

func normalizeDetectionSpan(input string, detection Detection) Detection {
	switch DetectorType(detection.Type) {
	case DetectorPersonName:
		detection.End = trimPersonNameStructureSuffix(input, detection.Start, detection.End)
	case DetectorEmail:
		detection.Start, detection.End = emailValueSpan(input, detection.Start, detection.End)
	}
	return detection
}

func trimPersonNameStructureSuffix(input string, start int, end int) int {
	for end > start {
		value := input[start:end]
		nextEnd := end
		for _, suffix := range personNameStructureSuffixes {
			stem := strings.TrimSuffix(value, suffix)
			if stem != value && isKoreanPersonStem(stem) {
				nextEnd = end - len(suffix)
				break
			}
		}
		if nextEnd == end {
			return end
		}
		end = nextEnd
	}
	return end
}

func isKoreanPersonStem(value string) bool {
	key := strings.ReplaceAll(value, " ", "")
	runes := []rune(key)
	return len(runes) >= 2 && len(runes) <= 4 && isKoreanAliasKey(key)
}

func emailValueSpan(input string, start int, end int) (int, int) {
	match := structureEmailPattern.FindStringIndex(input[start:end])
	if len(match) != 2 {
		return start, end
	}
	return start + match[0], start + match[1]
}
