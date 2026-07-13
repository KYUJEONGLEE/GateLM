package routing

import (
	"encoding/json"
	"os"
	"testing"
)

func TestCategoryEvalFixtureUsesOnlyActiveV2Categories(t *testing.T) {
	payload, err := os.ReadFile("testdata/category_eval_cases.json")
	if err != nil {
		t.Fatalf("read category fixture: %v", err)
	}

	var cases []struct {
		ID               string `json:"id"`
		ExpectedCategory string `json:"expectedCategory"`
	}
	if err := json.Unmarshal(payload, &cases); err != nil {
		t.Fatalf("decode category fixture: %v", err)
	}

	active := make(map[string]struct{}, len(Categories))
	for _, category := range Categories {
		active[category] = struct{}{}
	}
	for _, testCase := range cases {
		if _, ok := active[testCase.ExpectedCategory]; !ok {
			t.Fatalf("fixture %q uses retired category %q", testCase.ID, testCase.ExpectedCategory)
		}
	}
}

