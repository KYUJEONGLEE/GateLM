package masking

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

type personRoleContextLabel struct {
	prefix           string
	labels           []string
	consumableLabels []string
}

type personRoleContext struct {
	prefix       string
	redactStart  int
	consumeLabel bool
}

var personRoleContextLabels = []personRoleContextLabel{
	{
		prefix: "CUSTOMER",
		labels: []string{
			"customer",
			"customer name",
			"client",
			"\uace0\uac1d",
			"\uace0\uac1d\uba85",
		},
		consumableLabels: []string{
			"customer",
			"client",
			"\uace0\uac1d",
		},
	},
	{
		prefix: "AGENT",
		labels: []string{
			"agent",
			"agent name",
			"support agent",
			"\uc0c1\ub2f4\uc6d0",
			"\uc0c1\ub2f4\uc0ac",
		},
		consumableLabels: []string{
			"support agent",
			"agent",
			"\uc0c1\ub2f4\uc6d0",
			"\uc0c1\ub2f4\uc0ac",
		},
	},
	{
		prefix: "DOCTOR",
		labels: []string{
			"doctor",
			"doctor name",
			"physician",
			"\uc758\uc0ac",
			"\ub2f4\ub2f9 \uc758\uc0ac",
			"\uc8fc\uce58\uc758",
		},
		consumableLabels: []string{
			"doctor",
			"physician",
			"\ub2f4\ub2f9 \uc758\uc0ac",
			"\uc758\uc0ac",
			"\uc8fc\uce58\uc758",
		},
	},
	{
		prefix: "PATIENT",
		labels: []string{
			"patient",
			"patient name",
			"\ud658\uc790",
		},
		consumableLabels: []string{
			"patient",
			"\ud658\uc790",
		},
	},
}

func inferPersonRolePrefix(input string, start int) string {
	return inferPersonRoleContext(input, start).prefix
}

func inferPersonRoleContext(input string, start int) personRoleContext {
	if start < 0 || start > len(input) {
		return personRoleContext{}
	}
	context := normalizePersonRoleContext(input[:start])
	if context == "" {
		return personRoleContext{}
	}
	for _, candidate := range personRoleContextLabels {
		for _, label := range candidate.labels {
			if context == label || strings.HasSuffix(context, " "+label) {
				redactStart, consumeLabel := personRoleLabelRedactStart(input[:start], candidate)
				return personRoleContext{
					prefix:       candidate.prefix,
					redactStart:  redactStart,
					consumeLabel: consumeLabel,
				}
			}
		}
	}
	return personRoleContext{}
}

func normalizePersonRoleContext(value string) string {
	normalized := strings.TrimSpace(value)
	normalized = strings.TrimSuffix(normalized, ":")
	normalized = strings.TrimSuffix(normalized, "=")
	normalized = strings.TrimSpace(normalized)
	normalized = strings.ToLower(normalized)
	normalized = strings.ReplaceAll(normalized, "_", " ")
	normalized = strings.ReplaceAll(normalized, "-", " ")
	return strings.Join(strings.Fields(normalized), " ")
}

func personRoleLabelRedactStart(context string, candidate personRoleContextLabel) (int, bool) {
	trimmed := strings.TrimRightFunc(context, unicode.IsSpace)
	lower := strings.ToLower(trimmed)
	for _, label := range candidate.consumableLabels {
		labelStart := len(lower) - len(label)
		if labelStart < 0 || !strings.HasSuffix(lower, label) {
			continue
		}
		if !hasPersonRoleLabelBoundary(lower, labelStart) {
			continue
		}
		return len(trimmed) - len(label), true
	}
	return 0, false
}

func hasPersonRoleLabelBoundary(value string, labelStart int) bool {
	if labelStart <= 0 {
		return true
	}
	r, _ := utf8.DecodeLastRuneInString(value[:labelStart])
	return unicode.IsSpace(r) || strings.ContainsRune("([{,.;:", r)
}
