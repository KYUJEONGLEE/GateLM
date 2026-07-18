package handlers

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func TestCostReportDataIncludesBoundedExecutedModelBuckets(t *testing.T) {
	periodStart := time.Date(2026, 7, 18, 1, 0, 0, 0, time.UTC)
	periodEnd := periodStart.Add(time.Hour)
	data := costReportData(invocationlog.CostReportFilter{
		TenantID: "tenant_demo",
		Period:   "hour",
		From:     periodStart,
		To:       periodEnd,
	}, invocationlog.CostReportFields{
		Period:              "hour",
		BucketInterval:      "1h",
		ExpectedBucketCount: 1,
		ModelBuckets: []invocationlog.CostReportModelBucket{{
			PeriodStart:  periodStart,
			PeriodEnd:    periodEnd,
			Provider:     "openai",
			Model:        "gpt-4.1-mini",
			RequestCount: 1501,
		}},
	})

	if len(data.ModelBuckets) != 1 ||
		data.ModelBuckets[0].Provider != "openai" ||
		data.ModelBuckets[0].Model != "gpt-4.1-mini" ||
		data.ModelBuckets[0].RequestCount != 1501 ||
		!data.ModelBuckets[0].PeriodStart.Equal(periodStart) ||
		!data.ModelBuckets[0].PeriodEnd.Equal(periodEnd) {
		t.Fatalf("unexpected model buckets: %+v", data.ModelBuckets)
	}

	payload, err := json.Marshal(data)
	if err != nil {
		t.Fatalf("marshal cost report data: %v", err)
	}
	body := string(payload)
	for _, forbidden := range []string{
		"rawPrompt",
		"rawResponse",
		"authorizationHeader",
		"apiKeyPlaintext",
		"providerApiKey",
		"metadata",
		"requestId",
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("model bucket response must not include forbidden field %q: %s", forbidden, body)
		}
	}
}
