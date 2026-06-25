package handlers

import (
	"net/http"
	"reflect"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/pipeline"
)

func TestNewGatewayContextIncludesPromptText(t *testing.T) {
	startedAt := time.Date(2026, 6, 25, 12, 0, 0, 0, time.UTC)
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
		StartedAt: startedAt,
	})
	reqCtx.RequestedModel = "auto"

	gatewayCtx := newGatewayContext(reqCtx, "system prompt\nuser prompt")

	if gatewayCtx.Request.PromptText != "system prompt\nuser prompt" {
		t.Fatalf("unexpected prompt text: %q", gatewayCtx.Request.PromptText)
	}
	if gatewayCtx.Request.RequestedModel != "auto" {
		t.Fatalf("unexpected requested model: %s", gatewayCtx.Request.RequestedModel)
	}
	if !gatewayCtx.Request.StartedAt.Equal(startedAt) {
		t.Fatalf("unexpected started at: %s", gatewayCtx.Request.StartedAt)
	}
}

func TestApplyGatewayContextPreservesHTTPStatusWhenOnlyErrorCodeIsProvided(t *testing.T) {
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	reqCtx.HTTPStatus = http.StatusBadGateway
	gatewayCtx := &request.GatewayContext{
		Status: request.StatusContext{
			ErrorCode: "sensitive_data_blocked",
		},
	}

	applyGatewayContext(reqCtx, gatewayCtx)

	if reqCtx.HTTPStatus != http.StatusBadGateway {
		t.Fatalf("expected HTTP status %d, got %d", http.StatusBadGateway, reqCtx.HTTPStatus)
	}
	if reqCtx.ErrorCode != "sensitive_data_blocked" {
		t.Fatalf("unexpected error code: %s", reqCtx.ErrorCode)
	}
}

func TestApplyGatewayContextCopiesHTTPStatusOnly(t *testing.T) {
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	reqCtx.ErrorCode = "existing_error"
	gatewayCtx := &request.GatewayContext{
		Status: request.StatusContext{
			HTTPStatus: http.StatusForbidden,
		},
	}

	applyGatewayContext(reqCtx, gatewayCtx)

	if reqCtx.HTTPStatus != http.StatusForbidden {
		t.Fatalf("expected HTTP status %d, got %d", http.StatusForbidden, reqCtx.HTTPStatus)
	}
	if reqCtx.ErrorCode != "existing_error" {
		t.Fatalf("unexpected error code: %s", reqCtx.ErrorCode)
	}
}

func TestApplyGatewayContextCopiesRoutingPolicyHash(t *testing.T) {
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	gatewayCtx := &request.GatewayContext{
		Routing: request.RoutingContext{
			SelectedProvider:  "mock",
			SelectedModel:     "mock-fast",
			RoutingReason:     "low_cost",
			RoutingPolicyHash: "routing_policy_p0_v1",
		},
	}

	applyGatewayContext(reqCtx, gatewayCtx)

	if reqCtx.RoutingPolicyHash != "routing_policy_p0_v1" {
		t.Fatalf("expected routing policy hash to be copied, got %q", reqCtx.RoutingPolicyHash)
	}
}

func TestApplyGatewayContextCopiesSafetyAndCacheMetadata(t *testing.T) {
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_test",
		TraceID:   "request_test",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	gatewayCtx := &request.GatewayContext{}
	setNestedStringField(t, gatewayCtx, "Masking", "Action", "redacted")
	setNestedStringSliceField(t, gatewayCtx, "Masking", "DetectedTypes", []string{"email"})
	setNestedIntField(t, gatewayCtx, "Masking", "DetectedCount", 1)
	setNestedStringField(t, gatewayCtx, "Masking", "RedactedPromptPreview", "Contact [EMAIL_REDACTED].")
	setNestedStringField(t, gatewayCtx, "Cache", "Status", "hit")
	setNestedStringField(t, gatewayCtx, "Cache", "Type", "exact")
	setNestedStringField(t, gatewayCtx, "Cache", "KeyHash", "hmac-sha256:cache-key-test")
	setNestedStringField(t, gatewayCtx, "Cache", "HitRequestID", "request_original")

	applyGatewayContext(reqCtx, gatewayCtx)

	if reqCtx.MaskingAction != "redacted" {
		t.Fatalf("expected masking action redacted, got %q", reqCtx.MaskingAction)
	}
	if len(reqCtx.MaskingDetectedTypes) != 1 || reqCtx.MaskingDetectedTypes[0] != "email" {
		t.Fatalf("unexpected masking detected types: %#v", reqCtx.MaskingDetectedTypes)
	}
	if reqCtx.MaskingDetectedCount != 1 {
		t.Fatalf("expected masking detected count 1, got %d", reqCtx.MaskingDetectedCount)
	}
	if reqCtx.RedactedPromptPreview != "Contact [EMAIL_REDACTED]." {
		t.Fatalf("unexpected redacted prompt preview: %q", reqCtx.RedactedPromptPreview)
	}
	if reqCtx.CacheStatus != "hit" || reqCtx.CacheType != "exact" {
		t.Fatalf("expected exact cache hit metadata, got status=%q type=%q", reqCtx.CacheStatus, reqCtx.CacheType)
	}
	if reqCtx.CacheKeyHash != "hmac-sha256:cache-key-test" || reqCtx.CacheHitRequestID != "request_original" {
		t.Fatalf("unexpected cache identity metadata: key=%q hitRequest=%q", reqCtx.CacheKeyHash, reqCtx.CacheHitRequestID)
	}
}

func setNestedStringField(t *testing.T, target any, parentName string, fieldName string, value string) {
	t.Helper()

	field := nestedSettableField(t, target, parentName, fieldName)
	if field.Kind() != reflect.String {
		t.Fatalf("GatewayContext.%s.%s must be string, got %s", parentName, fieldName, field.Kind())
	}
	field.SetString(value)
}

func setNestedStringSliceField(t *testing.T, target any, parentName string, fieldName string, value []string) {
	t.Helper()

	field := nestedSettableField(t, target, parentName, fieldName)
	if field.Kind() != reflect.Slice || field.Type().Elem().Kind() != reflect.String {
		t.Fatalf("GatewayContext.%s.%s must be []string, got %s", parentName, fieldName, field.Type())
	}
	field.Set(reflect.ValueOf(value))
}

func setNestedIntField(t *testing.T, target any, parentName string, fieldName string, value int) {
	t.Helper()

	field := nestedSettableField(t, target, parentName, fieldName)
	if field.Kind() != reflect.Int {
		t.Fatalf("GatewayContext.%s.%s must be int, got %s", parentName, fieldName, field.Kind())
	}
	field.SetInt(int64(value))
}

func nestedSettableField(t *testing.T, target any, parentName string, fieldName string) reflect.Value {
	t.Helper()

	root := reflect.ValueOf(target)
	if root.Kind() != reflect.Pointer || root.IsNil() {
		t.Fatalf("target must be a non-nil pointer")
	}
	parent := root.Elem().FieldByName(parentName)
	if !parent.IsValid() {
		t.Fatalf("GatewayContext missing %s context for P0 metadata propagation", parentName)
	}
	if parent.Kind() == reflect.Pointer {
		if parent.IsNil() {
			parent.Set(reflect.New(parent.Type().Elem()))
		}
		parent = parent.Elem()
	}
	if parent.Kind() != reflect.Struct {
		t.Fatalf("GatewayContext.%s must be a struct or struct pointer, got %s", parentName, parent.Kind())
	}
	field := parent.FieldByName(fieldName)
	if !field.IsValid() {
		t.Fatalf("GatewayContext.%s missing %s field for P0 metadata propagation", parentName, fieldName)
	}
	if !field.CanSet() {
		t.Fatalf("GatewayContext.%s.%s is not settable", parentName, fieldName)
	}
	return field
}
