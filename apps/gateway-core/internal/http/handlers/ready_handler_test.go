package handlers

import "testing"

func TestPostgresDriverURLRemovesPrismaSchemaQuery(t *testing.T) {
	rawURL := "postgresql://gatelm:gatelm@postgres:5432/gatelm?schema=public&sslmode=disable"

	got := postgresDriverURL(rawURL)
	want := "postgresql://gatelm:gatelm@postgres:5432/gatelm?sslmode=disable"

	if got != want {
		t.Fatalf("unexpected postgres driver url: got %q want %q", got, want)
	}
}
