package employeecost

import (
	"errors"
	"testing"
	"time"
)

func TestCalendarBoundsAsiaSeoulDay(t *testing.T) {
	now := time.Date(2026, time.July, 15, 6, 30, 0, 0, time.UTC)

	bounds, err := CalendarBounds(now, PeriodKindDay, "Asia/Seoul")
	if err != nil {
		t.Fatalf("CalendarBounds() error = %v", err)
	}

	wantStart := time.Date(2026, time.July, 14, 15, 0, 0, 0, time.UTC)
	wantEnd := time.Date(2026, time.July, 15, 15, 0, 0, 0, time.UTC)
	if !bounds.Start.Equal(wantStart) || !bounds.End.Equal(wantEnd) {
		t.Fatalf("CalendarBounds() = [%s, %s), want [%s, %s)", bounds.Start, bounds.End, wantStart, wantEnd)
	}
	if bounds.End.Sub(bounds.Start) != 24*time.Hour {
		t.Fatalf("day duration = %s, want 24h", bounds.End.Sub(bounds.Start))
	}
}

func TestCalendarBoundsNewYorkDSTDays(t *testing.T) {
	tests := []struct {
		name         string
		now          time.Time
		wantDuration time.Duration
		wantStart    time.Time
		wantEnd      time.Time
	}{
		{
			name:         "spring forward is 23 hours",
			now:          time.Date(2026, time.March, 8, 16, 0, 0, 0, time.UTC),
			wantDuration: 23 * time.Hour,
			wantStart:    time.Date(2026, time.March, 8, 5, 0, 0, 0, time.UTC),
			wantEnd:      time.Date(2026, time.March, 9, 4, 0, 0, 0, time.UTC),
		},
		{
			name:         "fall back is 25 hours",
			now:          time.Date(2026, time.November, 1, 17, 0, 0, 0, time.UTC),
			wantDuration: 25 * time.Hour,
			wantStart:    time.Date(2026, time.November, 1, 4, 0, 0, 0, time.UTC),
			wantEnd:      time.Date(2026, time.November, 2, 5, 0, 0, 0, time.UTC),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bounds, err := CalendarBounds(tt.now, PeriodKindDay, "America/New_York")
			if err != nil {
				t.Fatalf("CalendarBounds() error = %v", err)
			}
			if !bounds.Start.Equal(tt.wantStart) || !bounds.End.Equal(tt.wantEnd) {
				t.Fatalf("CalendarBounds() = [%s, %s), want [%s, %s)", bounds.Start, bounds.End, tt.wantStart, tt.wantEnd)
			}
			if got := bounds.End.Sub(bounds.Start); got != tt.wantDuration {
				t.Fatalf("day duration = %s, want %s", got, tt.wantDuration)
			}
		})
	}
}

func TestCalendarBoundsUsesISOMondayWeek(t *testing.T) {
	tests := []struct {
		name string
		now  time.Time
	}{
		{name: "Wednesday", now: time.Date(2026, time.July, 15, 12, 0, 0, 0, time.UTC)},
		{name: "Sunday remains in prior ISO week", now: time.Date(2026, time.July, 19, 12, 0, 0, 0, time.UTC)},
	}
	wantStart := time.Date(2026, time.July, 12, 15, 0, 0, 0, time.UTC)
	wantEnd := time.Date(2026, time.July, 19, 15, 0, 0, 0, time.UTC)

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bounds, err := CalendarBounds(tt.now, PeriodKindWeek, "Asia/Seoul")
			if err != nil {
				t.Fatalf("CalendarBounds() error = %v", err)
			}
			if !bounds.Start.Equal(wantStart) || !bounds.End.Equal(wantEnd) {
				t.Fatalf("CalendarBounds() = [%s, %s), want [%s, %s)", bounds.Start, bounds.End, wantStart, wantEnd)
			}
		})
	}
}

func TestCalendarBoundsNewYorkDSTWeekUsesLocalMondays(t *testing.T) {
	now := time.Date(2026, time.March, 8, 16, 0, 0, 0, time.UTC)

	bounds, err := CalendarBounds(now, PeriodKindWeek, "America/New_York")
	if err != nil {
		t.Fatalf("CalendarBounds() error = %v", err)
	}

	wantStart := time.Date(2026, time.March, 2, 5, 0, 0, 0, time.UTC)
	wantEnd := time.Date(2026, time.March, 9, 4, 0, 0, 0, time.UTC)
	if !bounds.Start.Equal(wantStart) || !bounds.End.Equal(wantEnd) {
		t.Fatalf("CalendarBounds() = [%s, %s), want [%s, %s)", bounds.Start, bounds.End, wantStart, wantEnd)
	}
	if got := bounds.End.Sub(bounds.Start); got != 167*time.Hour {
		t.Fatalf("DST week duration = %s, want 167h", got)
	}
}

func TestCalendarBoundsRejectsInvalidInputs(t *testing.T) {
	if _, err := CalendarBounds(time.Now(), PeriodKind("month"), "Asia/Seoul"); !errors.Is(err, ErrInvalidPeriodKind) {
		t.Fatalf("invalid period error = %v, want ErrInvalidPeriodKind", err)
	}
	if _, err := CalendarBounds(time.Now(), PeriodKindDay, "Mars/Olympus_Mons"); !errors.Is(err, ErrInvalidTimezone) {
		t.Fatalf("invalid timezone error = %v, want ErrInvalidTimezone", err)
	}
}
