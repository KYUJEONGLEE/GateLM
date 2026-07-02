package masking

import (
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

type promptRange struct {
	start int
	end   int
}

type coreferenceLabel struct {
	text     string
	isKorean bool
}

var sentenceInitialCoreferenceLabels = []coreferenceLabel{
	{text: "\ud574\ub2f9 \uc9c1\uc6d0", isKorean: true},
	{text: "\uadf8 \uc0ac\ub78c", isKorean: true},
	{text: "\uc704 \uc0ac\ub78c", isKorean: true},
	{text: "\uadf8\ub140", isKorean: true},
	{text: "\uadf8\ubd84", isKorean: true},
	{text: "\uadf8", isKorean: true},
	{text: "they"},
	{text: "she"},
	{text: "he"},
}

func withCoreferencePlaceholders(input string, personDetections []Detection, protected []Detection) []Detection {
	coreferences := coreferenceDetections(input, personDetections, protected)
	if len(coreferences) == 0 {
		return protected
	}

	combined := make([]Detection, 0, len(protected)+len(coreferences))
	combined = append(combined, protected...)
	combined = append(combined, coreferences...)
	sort.SliceStable(combined, func(i int, j int) bool {
		if combined[i].Start != combined[j].Start {
			return combined[i].Start < combined[j].Start
		}
		return combined[i].End < combined[j].End
	})
	return combined
}

func coreferenceDetections(input string, personDetections []Detection, protected []Detection) []Detection {
	sentences := sentenceRanges(input)
	if len(sentences) < 2 {
		return nil
	}

	var detections []Detection
	for sentenceIndex := 1; sentenceIndex < len(sentences); sentenceIndex++ {
		labelStart, labelEnd, ok := sentenceInitialCoreferenceSpan(input, sentences[sentenceIndex])
		if !ok {
			continue
		}

		placeholder, ok := previousSentenceSubjectPlaceholder(input, sentences[sentenceIndex-1], personDetections)
		if !ok {
			continue
		}

		candidate := Detection{
			Start:       labelStart,
			End:         labelEnd,
			Placeholder: placeholder,
		}
		if overlapsAny(candidate, protected) || overlapsAny(candidate, detections) {
			continue
		}
		detections = append(detections, candidate)
	}
	return detections
}

func sentenceRanges(input string) []promptRange {
	if input == "" {
		return nil
	}

	var ranges []promptRange
	start := 0
	for index, r := range input {
		if !isSentenceTerminator(r) {
			continue
		}
		end := index + utf8.RuneLen(r)
		ranges = append(ranges, promptRange{start: start, end: end})
		start = end
	}
	if start < len(input) {
		ranges = append(ranges, promptRange{start: start, end: len(input)})
	}
	return ranges
}

func isSentenceTerminator(r rune) bool {
	switch r {
	case '.', '!', '?', '\u3002', '\uff01', '\uff1f':
		return true
	default:
		return false
	}
}

func sentenceInitialCoreferenceSpan(input string, sentence promptRange) (int, int, bool) {
	start := firstNonSpaceIndex(input, sentence.start, sentence.end)
	if start < 0 {
		return 0, 0, false
	}

	for _, label := range sentenceInitialCoreferenceLabels {
		end := start + len(label.text)
		if end > sentence.end || end > len(input) {
			continue
		}

		raw := input[start:end]
		if label.isKorean {
			if raw == label.text && hasKoreanCoreferenceBoundary(input, end) {
				return start, end, true
			}
			continue
		}

		if strings.EqualFold(raw, label.text) && hasEnglishWordBoundary(input, end) {
			return start, end, true
		}
	}
	return 0, 0, false
}

func firstNonSpaceIndex(input string, start int, end int) int {
	for index := start; index < end; {
		r, size := utf8.DecodeRuneInString(input[index:end])
		if r == utf8.RuneError && size == 0 {
			return -1
		}
		if !unicode.IsSpace(r) {
			return index
		}
		index += size
	}
	return -1
}

func hasKoreanCoreferenceBoundary(input string, end int) bool {
	if end >= len(input) {
		return true
	}
	next, _ := utf8.DecodeRuneInString(input[end:])
	return strings.ContainsRune("\uc740\ub294\uc774\uac00", next)
}

func hasEnglishWordBoundary(input string, end int) bool {
	if end >= len(input) {
		return true
	}
	next, _ := utf8.DecodeRuneInString(input[end:])
	return !(unicode.IsLetter(next) || unicode.IsDigit(next) || next == '_')
}

func previousSentenceSubjectPlaceholder(input string, sentence promptRange, detections []Detection) (string, bool) {
	people := personDetectionsInRange(sentence, detections)
	if len(people) == 0 || hasPersonGroupConjunction(input, people) {
		return "", false
	}

	var candidates []Detection
	for _, detection := range people {
		if !isPersonCoreferencePlaceholder(detection.Placeholder) {
			continue
		}
		if isKoreanSubjectCandidate(input, detection) || isEnglishSubjectCandidate(input, sentence, detection) {
			candidates = append(candidates, detection)
		}
	}
	if len(candidates) != 1 {
		return "", false
	}
	return candidates[0].Placeholder, true
}

func personDetectionsInRange(sentence promptRange, detections []Detection) []Detection {
	var people []Detection
	for _, detection := range detections {
		if DetectorType(detection.Type) != DetectorPersonName || detection.Action != ActionRedacted {
			continue
		}
		if detection.Start < sentence.start || detection.End > sentence.end || detection.End <= detection.Start {
			continue
		}
		people = append(people, detection)
	}
	sort.SliceStable(people, func(i int, j int) bool {
		if people[i].Start != people[j].Start {
			return people[i].Start < people[j].Start
		}
		return people[i].End < people[j].End
	})
	return people
}

func hasPersonGroupConjunction(input string, people []Detection) bool {
	for index := 0; index+1 < len(people); index++ {
		between := strings.TrimSpace(input[people[index].End:people[index+1].Start])
		switch {
		case between == "\uc640", between == "\uacfc", between == "\ub791", between == "\ud558\uace0":
			return true
		case between == "&", strings.EqualFold(between, "and"):
			return true
		}
	}
	return false
}

func isKoreanSubjectCandidate(input string, detection Detection) bool {
	if detection.End >= len(input) {
		return false
	}
	next, _ := utf8.DecodeRuneInString(input[detection.End:])
	return strings.ContainsRune("\uc740\ub294\uc774\uac00", next)
}

func isEnglishSubjectCandidate(input string, sentence promptRange, detection Detection) bool {
	if firstNonSpaceIndex(input, sentence.start, sentence.end) != detection.Start {
		return false
	}
	return hasASCIILetter(input[detection.Start:detection.End])
}

func hasASCIILetter(value string) bool {
	for _, r := range value {
		if ('A' <= r && r <= 'Z') || ('a' <= r && r <= 'z') {
			return true
		}
	}
	return false
}

func isPersonCoreferencePlaceholder(placeholder string) bool {
	for _, prefix := range []string{
		"[PERSON_",
		"[CUSTOMER_",
		"[AGENT_",
		"[DOCTOR_",
		"[PATIENT_",
		"[APPLICANT_",
		"[INTERVIEWER_",
	} {
		if strings.HasPrefix(placeholder, prefix) {
			return true
		}
	}
	return false
}
