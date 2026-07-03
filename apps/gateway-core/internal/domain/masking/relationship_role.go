package masking

import (
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

var businessRoleLabels = []string{
	"\uc5d0\uc2a4\uceec\ub808\uc774\uc158 \ub2f4\ub2f9\uc790",
	"\ud504\ub85c\uc81d\ud2b8 \ub9e4\ub2c8\uc800",
	"\uad00\ub9ac\ucc45\uc784\uc790",
	"\ubc30\uc815\ub300\uc0c1\uc790",
	"\uc601\uc5c5\ub2f4\ub2f9\uc790",
	"\uacc4\uc815\ub2f4\ub2f9\uc790",
	"\ucc44\uc6a9\ub2f4\ub2f9\uc790",
	"\ubc95\ubb34\ub2f4\ub2f9\uc790",
	"\uacc4\uc57d\ub2f4\ub2f9\uc790",
	"\ud68c\uacc4\ub2f4\ub2f9\uc790",
	"\uc815\uc0b0\ub2f4\ub2f9\uc790",
	"\uc288\ud37c\ubc14\uc774\uc800",
	"\ub2f4\ub2f9\uc790",
	"\uc2b9\uc778\uc790",
	"\uac80\ud1a0\uc790",
	"\uc694\uccad\uc790",
	"\uacb0\uc7ac\uc790",
	"\uae30\uc548\uc790",
	"\ucc98\ub9ac\uc790",
	"\uc811\uc218\uc790",
	"\ucc38\uc870\uc790",
	"\uad00\ub9ac\uc790",
	"\ubcf8\ubd80\uc7a5",
	"\ucc45\uc784\uc790",
	"\uc6b4\uc601\uc790",
	"\uc2e4\ubb34\uc790",
	"\uc791\uc131\uc790",
	"\uc218\uc2e0\uc790",
	"\ubc1c\uc2e0\uc790",
	"\ubcf4\uace0\uc790",
	"\ud53c\ubcf4\uace0\uc790",
	"\ud611\uc5c5\uc790",
	"\uac80\uc218\uc790",
	"\ubc30\uc815\uc790",
	"\uc0c1\ub2f4\uc6d0",
	"\uc0c1\ub2f4\uc0ac",
	"\ud300\uc7a5",
	"\ub9e4\ub2c8\uc800",
	"\uc0c1\uc0ac",
	"\ubd80\ud558",
	"\ub9ac\ub354",
	"\ud30c\ud2b8\uc7a5",
	"\uc2e4\uc7a5",
	"\uac1c\ubc1c\uc790",
	"\ub514\uc790\uc774\ub108",
	"\uc9c0\uc6d0\uc790",
	"\uba74\uc811\uad00",
	"\ud3c9\uac00\uc790",
	"CSM",
	"PM",
	"PO",
	"PL",
	"QA",
	"AM",
	"AE",
}

func relationshipRolePattern() string {
	parts := make([]string, 0, len(businessRoleLabels))
	for _, label := range businessRoleLabels {
		parts = append(parts, strings.ReplaceAll(regexp.QuoteMeta(label), " ", `\s+`))
	}
	return `(?:` + strings.Join(parts, "|") + `)`
}

func withRelationshipRolePlaceholders(input string, detections []Detection) []Detection {
	roles := relationshipRoleDetections(input, detections)
	if len(roles) == 0 {
		return detections
	}

	combined := make([]Detection, 0, len(detections)+len(roles))
	combined = append(combined, detections...)
	combined = append(combined, roles...)
	sort.SliceStable(combined, func(i int, j int) bool {
		if combined[i].Start != combined[j].Start {
			return combined[i].Start < combined[j].Start
		}
		return combined[i].End < combined[j].End
	})
	return combined
}

func relationshipRoleDetections(input string, protected []Detection) []Detection {
	var detections []Detection
	for _, label := range businessRoleLabels {
		pattern := regexp.MustCompile(`(?i)` + strings.ReplaceAll(regexp.QuoteMeta(label), " ", `\s+`))
		for _, match := range pattern.FindAllStringIndex(input, -1) {
			if len(match) != 2 || !hasBusinessRoleBoundary(input, match[0], match[1]) {
				continue
			}
			candidate := Detection{
				Start:       match[0],
				End:         match[1],
				Placeholder: "[ROLE:" + label + "]",
			}
			if overlapsAny(candidate, protected) || overlapsAny(candidate, detections) {
				continue
			}
			detections = append(detections, candidate)
		}
	}
	return detections
}

func hasBusinessRoleBoundary(input string, start int, end int) bool {
	if start > 0 {
		previous, _ := utf8.DecodeLastRuneInString(input[:start])
		if unicode.IsLetter(previous) || unicode.IsDigit(previous) {
			return false
		}
	}
	if end >= len(input) {
		return true
	}

	next, _ := utf8.DecodeRuneInString(input[end:])
	if unicode.IsSpace(next) || strings.ContainsRune(`"')]}>,;:.`, next) {
		return true
	}
	return strings.ContainsRune("\uc740\ub294\uc774\uac00\uc744\ub97c\uc5d0\uaed8\uc640\uacfc\ub3c4\ub9cc\uc73c\ub85c", next)
}

func isBusinessRoleLabel(label string) bool {
	for _, candidate := range businessRoleLabels {
		if candidate == label {
			return true
		}
	}
	return false
}
