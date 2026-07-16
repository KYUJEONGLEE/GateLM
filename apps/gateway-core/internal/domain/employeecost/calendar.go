package employeecost

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrInvalidPeriodKind = errors.New("invalid employee cost period kind")
	ErrInvalidTimezone   = errors.New("invalid employee cost period timezone")
)

// CalendarBounds returns a half-open local calendar period converted to UTC.
// Day and week boundaries intentionally use AddDate rather than fixed durations
// so DST transitions produce 23/25 hour days and 167/169 hour weeks as needed.
func CalendarBounds(now time.Time, kind PeriodKind, timezone string) (PeriodBounds, error) {
	if !kind.Valid() {
		return PeriodBounds{}, ErrInvalidPeriodKind
	}
	timezone = strings.TrimSpace(timezone)
	if timezone == "" {
		return PeriodBounds{}, ErrInvalidTimezone
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return PeriodBounds{}, fmt.Errorf("%w: %s", ErrInvalidTimezone, timezone)
	}

	local := now.In(location)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
	var end time.Time
	switch kind {
	case PeriodKindDay:
		end = start.AddDate(0, 0, 1)
	case PeriodKindWeek:
		daysSinceMonday := (int(start.Weekday()) + 6) % 7
		start = start.AddDate(0, 0, -daysSinceMonday)
		end = start.AddDate(0, 0, 7)
	}

	return PeriodBounds{
		Kind:     kind,
		Start:    start.UTC(),
		End:      end.UTC(),
		Timezone: timezone,
	}, nil
}
