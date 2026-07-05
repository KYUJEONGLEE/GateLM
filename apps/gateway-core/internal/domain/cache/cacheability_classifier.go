package cache

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	CacheabilityLabelCacheableStatic  = "cacheable_static"
	CacheabilityLabelCacheablePolicy  = "cacheable_policy"
	CacheabilityLabelDynamicUserState = "dynamic_user_state"
	CacheabilityLabelUnsafeOrUnknown  = "unsafe_or_unknown"

	CacheabilityClassifierTypeNoop     = "noop"
	CacheabilityClassifierTypeStub     = "stub"
	CacheabilityClassifierTypeFastText = "fasttext"

	DefaultCacheabilityClassifierMinConfidence = 0.90
	DefaultCacheabilityClassifierTimeout       = 30 * time.Millisecond

	CacheabilityClassifierNoopModelVersion = "cacheability-classifier.noop.v1"
	CacheabilityClassifierStubModelVersion = "cacheability-classifier.stub.v1"

	CacheabilityReasonClassifierDisabled = "classifier_disabled"
	CacheabilityReasonEmptyInput         = "empty_input"
	CacheabilityReasonStaticStub         = "stub_static_guidance"
	CacheabilityReasonPolicyStub         = "stub_policy_explanation"
	CacheabilityReasonDynamicStub        = "stub_dynamic_user_state"
	CacheabilityReasonUnknownStub        = "stub_unsafe_or_unknown"
	CacheabilityReasonFastTextSidecar    = "fasttext_sidecar"
	CacheabilityReasonRuleStaticGuidance = "rule_static_guidance"

	CacheabilityReasonClassifierMissing           = "classifier_missing"
	CacheabilityReasonClassifierError             = "classifier_error"
	CacheabilityReasonClassifierTimeout           = "classifier_timeout"
	CacheabilityReasonClassifierInvalid           = "classifier_invalid"
	CacheabilityReasonClassifierLowConfidence     = "classifier_low_confidence"
	CacheabilityReasonClassifierNotCacheable      = "classifier_not_cacheable"
	CacheabilityReasonClassifierPolicyBoundaryGap = "classifier_policy_boundary_unavailable"
)

var (
	ErrCacheabilityClassifierInvalidResult   = errors.New("cacheability classifier result is invalid")
	ErrCacheabilityClassifierInvalidConfig   = errors.New("cacheability classifier config is invalid")
	ErrCacheabilityClassifierUnsupportedType = errors.New("unsupported cacheability classifier type")
)

type CacheabilityLabel string

func (l CacheabilityLabel) Normalize() CacheabilityLabel {
	return CacheabilityLabel(strings.TrimSpace(strings.ToLower(string(l))))
}

func (l CacheabilityLabel) Valid() bool {
	switch l.Normalize() {
	case CacheabilityLabelCacheableStatic,
		CacheabilityLabelCacheablePolicy,
		CacheabilityLabelDynamicUserState,
		CacheabilityLabelUnsafeOrUnknown:
		return true
	default:
		return false
	}
}

func (l CacheabilityLabel) CacheableCandidate() bool {
	switch l.Normalize() {
	case CacheabilityLabelCacheableStatic, CacheabilityLabelCacheablePolicy:
		return true
	default:
		return false
	}
}

type CacheabilityClassificationRequest struct {
	NormalizedText string
	PromptCategory string
}

type CacheabilityClassifierResult struct {
	Label        CacheabilityLabel
	Confidence   float64
	ReasonCode   string
	ModelVersion string
}

func (r CacheabilityClassifierResult) Normalize() CacheabilityClassifierResult {
	return CacheabilityClassifierResult{
		Label:        r.Label.Normalize(),
		Confidence:   r.Confidence,
		ReasonCode:   strings.TrimSpace(r.ReasonCode),
		ModelVersion: strings.TrimSpace(r.ModelVersion),
	}
}

func (r CacheabilityClassifierResult) Validate() error {
	r = r.Normalize()
	if !r.Label.Valid() {
		return fmt.Errorf("%w: invalid label %q", ErrCacheabilityClassifierInvalidResult, r.Label)
	}
	if r.Confidence < 0 || r.Confidence > 1 {
		return fmt.Errorf("%w: invalid confidence %v", ErrCacheabilityClassifierInvalidResult, r.Confidence)
	}
	if r.ReasonCode == "" {
		return fmt.Errorf("%w: empty reasonCode", ErrCacheabilityClassifierInvalidResult)
	}
	if r.ModelVersion == "" {
		return fmt.Errorf("%w: empty modelVersion", ErrCacheabilityClassifierInvalidResult)
	}
	return nil
}

func (r CacheabilityClassifierResult) Passes(minConfidence float64) bool {
	if minConfidence <= 0 || minConfidence > 1 {
		minConfidence = DefaultCacheabilityClassifierMinConfidence
	}
	r = r.Normalize()
	return r.Validate() == nil && r.Label.CacheableCandidate() && r.Confidence >= minConfidence
}

type CacheabilityClassifier interface {
	Classify(ctx context.Context, request CacheabilityClassificationRequest) (CacheabilityClassifierResult, error)
}

type CacheabilityClassifierConfig struct {
	Enabled       bool
	Type          string
	Endpoint      string
	MinConfidence float64
	Timeout       time.Duration
}

func (c CacheabilityClassifierConfig) Normalize() CacheabilityClassifierConfig {
	c.Type = strings.TrimSpace(strings.ToLower(c.Type))
	c.Endpoint = strings.TrimSpace(c.Endpoint)
	if c.Type == "" {
		c.Type = CacheabilityClassifierTypeStub
	}
	if c.MinConfidence <= 0 || c.MinConfidence > 1 {
		c.MinConfidence = DefaultCacheabilityClassifierMinConfidence
	}
	if c.Timeout <= 0 {
		c.Timeout = DefaultCacheabilityClassifierTimeout
	}
	return c
}

func NewCacheabilityClassifier(config CacheabilityClassifierConfig) (CacheabilityClassifier, error) {
	config = config.Normalize()
	if !config.Enabled || config.Type == CacheabilityClassifierTypeNoop {
		return NoopCacheabilityClassifier{}, nil
	}
	switch config.Type {
	case CacheabilityClassifierTypeStub:
		return DeterministicStubCacheabilityClassifier{}, nil
	case CacheabilityClassifierTypeFastText:
		return NewFastTextSidecarCacheabilityClassifier(FastTextSidecarCacheabilityClassifierConfig{
			Endpoint: config.Endpoint,
			Timeout:  config.Timeout,
		})
	default:
		return nil, fmt.Errorf("%w %q", ErrCacheabilityClassifierUnsupportedType, config.Type)
	}
}

type NoopCacheabilityClassifier struct{}

func (NoopCacheabilityClassifier) Classify(ctx context.Context, _ CacheabilityClassificationRequest) (CacheabilityClassifierResult, error) {
	if err := ctx.Err(); err != nil {
		return CacheabilityClassifierResult{}, err
	}
	return CacheabilityClassifierResult{
		Label:        CacheabilityLabelUnsafeOrUnknown,
		Confidence:   0,
		ReasonCode:   CacheabilityReasonClassifierDisabled,
		ModelVersion: CacheabilityClassifierNoopModelVersion,
	}, nil
}

type DeterministicStubCacheabilityClassifier struct{}

func (DeterministicStubCacheabilityClassifier) Classify(ctx context.Context, request CacheabilityClassificationRequest) (CacheabilityClassifierResult, error) {
	if err := ctx.Err(); err != nil {
		return CacheabilityClassifierResult{}, err
	}
	text := normalizeSemanticText(request.NormalizedText)
	if text == "" {
		return CacheabilityClassifierResult{
			Label:        CacheabilityLabelUnsafeOrUnknown,
			Confidence:   0,
			ReasonCode:   CacheabilityReasonEmptyInput,
			ModelVersion: CacheabilityClassifierStubModelVersion,
		}, nil
	}
	if cacheabilityStubLooksDynamicUserState(text) {
		return CacheabilityClassifierResult{
			Label:        CacheabilityLabelDynamicUserState,
			Confidence:   0.99,
			ReasonCode:   CacheabilityReasonDynamicStub,
			ModelVersion: CacheabilityClassifierStubModelVersion,
		}, nil
	}
	if result, ok := cacheabilityRuleStaticGuidanceResult(text, request.PromptCategory, CacheabilityClassifierStubModelVersion); ok {
		return result, nil
	}
	if cacheabilityStubLooksPolicy(text) {
		return CacheabilityClassifierResult{
			Label:        CacheabilityLabelCacheablePolicy,
			Confidence:   0.95,
			ReasonCode:   CacheabilityReasonPolicyStub,
			ModelVersion: CacheabilityClassifierStubModelVersion,
		}, nil
	}
	if cacheabilityStubLooksStatic(text) {
		return CacheabilityClassifierResult{
			Label:        CacheabilityLabelCacheableStatic,
			Confidence:   0.95,
			ReasonCode:   CacheabilityReasonStaticStub,
			ModelVersion: CacheabilityClassifierStubModelVersion,
		}, nil
	}
	return CacheabilityClassifierResult{
		Label:        CacheabilityLabelUnsafeOrUnknown,
		Confidence:   0.50,
		ReasonCode:   CacheabilityReasonUnknownStub,
		ModelVersion: CacheabilityClassifierStubModelVersion,
	}, nil
}

func cacheabilityStubLooksDynamicUserState(text string) bool {
	return containsAny(text,
		"my account", "my usage", "my order", "my invoice", "my permission", "current balance",
		"latest", "real-time", "realtime", "today", "now", "this month", "current month", "session", "file", "tool result",
		"내 계정", "내 사용량", "내 주문", "내 결제", "내 권한", "현재", "최신", "오늘", "지금", "이번 달", "당월", "파일", "도구 결과",
	)
}

func cacheabilityStubLooksPolicy(text string) bool {
	return containsAny(text, "policy", "rule", "terms", "versioned", "정책", "규칙", "약관", "버전")
}

func cacheabilityStubLooksStatic(text string) bool {
	return containsAny(text,
		"how to", "what is", "explain", "guide", "faq", "reset password", "refund",
		"방법", "절차", "설명", "가이드", "도움말", "비밀번호", "재설정", "환불",
	)
}

func cacheabilityRuleStaticGuidanceResult(text string, promptCategory string, modelVersion string) (CacheabilityClassifierResult, bool) {
	category := strings.TrimSpace(strings.ToLower(promptCategory))
	if category != "" && category != SemanticCacheCategoryGeneral {
		return CacheabilityClassifierResult{}, false
	}
	text = normalizeSemanticText(text)
	if text == "" || cacheabilityStubLooksDynamicUserState(text) || !cacheabilityLooksStrictStaticGuidance(text) {
		return CacheabilityClassifierResult{}, false
	}
	return CacheabilityClassifierResult{
		Label:        CacheabilityLabelCacheableStatic,
		Confidence:   0.95,
		ReasonCode:   CacheabilityReasonRuleStaticGuidance,
		ModelVersion: strings.TrimSpace(modelVersion),
	}.Normalize(), true
}

func cacheabilityLooksStrictStaticGuidance(text string) bool {
	if containsAny(text,
		"rps", "requests per second", "초당 요청 수", "초당 요청수",
		"tps", "transactions per second", "초당 트랜잭션",
		"latency", "레이턴시", "지연 시간",
		"throughput", "처리량",
		"error rate", "에러율", "오류율", "실패율",
		"rps tps 차이", "rps와 tps 차이", "rps랑 tps 차이", "rps vs tps",
		"help center", "도움말 센터", "헬프센터", "고객센터 어디", "지원 문의 어디",
		"invoice", "billing invoice", "receipt", "청구서 어디", "청구서 메뉴", "인보이스 어디", "영수증 어디",
		"payment method", "billing card", "결제수단 어디", "결제 수단 어디", "카드 변경 어디", "카드 등록 어디",
		"invite member", "invite teammate", "team invite", "팀원 초대", "멤버 초대", "사용자 초대", "동료 초대",
		"project settings", "project configuration", "프로젝트 설정", "프로젝트 세팅",
		"api docs", "developer docs", "api reference", "api 문서", "개발자 문서", "api 레퍼런스",
		"status page", "service status", "system status", "상태 페이지", "서비스 상태", "장애 공지", "장애 현황",
		"release notes", "changelog", "what's new", "릴리즈 노트", "업데이트 내역", "변경사항", "배포 노트",
		"notification settings", "email notification", "알림 설정", "이메일 알림",
		"role permissions", "permission settings", "권한 설정", "역할 변경", "멤버 권한",
		"pricing page", "plan page", "billing plan", "요금제 어디", "요금제 확인", "가격표 어디", "플랜 확인",
		"data export", "export data", "데이터 내보내기", "내보내기 메뉴",
	) {
		return true
	}
	if containsAny(text, "사용량", "이용량", "api usage", "usage") &&
		containsAny(text, "어디", "위치", "메뉴", "화면", "확인 방법", "확인하는 방법", "보는 방법", "where", "screen", "page") {
		return true
	}
	return false
}

type FastTextSidecarCacheabilityClassifierConfig struct {
	Endpoint   string
	Timeout    time.Duration
	HTTPClient *http.Client
}

type FastTextSidecarCacheabilityClassifier struct {
	endpoint string
	client   *http.Client
}

type fastTextSidecarRequest struct {
	Text           string `json:"text"`
	PromptCategory string `json:"promptCategory,omitempty"`
}

type fastTextSidecarResponse struct {
	Label        string   `json:"label"`
	Confidence   *float64 `json:"confidence"`
	ReasonCode   string   `json:"reasonCode"`
	ModelVersion string   `json:"modelVersion"`
}

func NewFastTextSidecarCacheabilityClassifier(config FastTextSidecarCacheabilityClassifierConfig) (FastTextSidecarCacheabilityClassifier, error) {
	endpoint := strings.TrimSpace(config.Endpoint)
	if endpoint == "" {
		return FastTextSidecarCacheabilityClassifier{}, fmt.Errorf("%w: fasttext endpoint is required", ErrCacheabilityClassifierInvalidConfig)
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return FastTextSidecarCacheabilityClassifier{}, fmt.Errorf("%w: fasttext endpoint must be an absolute URL", ErrCacheabilityClassifierInvalidConfig)
	}
	timeout := config.Timeout
	if timeout <= 0 {
		timeout = DefaultCacheabilityClassifierTimeout
	}
	client := config.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: timeout}
	}
	return FastTextSidecarCacheabilityClassifier{
		endpoint: endpoint,
		client:   client,
	}, nil
}

func (c FastTextSidecarCacheabilityClassifier) Classify(ctx context.Context, request CacheabilityClassificationRequest) (CacheabilityClassifierResult, error) {
	if err := ctx.Err(); err != nil {
		return CacheabilityClassifierResult{}, err
	}
	text := normalizeSemanticText(request.NormalizedText)
	if text == "" {
		return CacheabilityClassifierResult{
			Label:        CacheabilityLabelUnsafeOrUnknown,
			Confidence:   0,
			ReasonCode:   CacheabilityReasonEmptyInput,
			ModelVersion: CacheabilityClassifierNoopModelVersion,
		}, nil
	}
	payload, err := json.Marshal(fastTextSidecarRequest{
		Text:           text,
		PromptCategory: strings.TrimSpace(request.PromptCategory),
	})
	if err != nil {
		return CacheabilityClassifierResult{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(payload))
	if err != nil {
		return CacheabilityClassifierResult{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	resp, err := c.client.Do(httpReq)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return CacheabilityClassifierResult{}, ctxErr
		}
		return CacheabilityClassifierResult{}, fmt.Errorf("fasttext sidecar request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return CacheabilityClassifierResult{}, fmt.Errorf("fasttext sidecar returned status %d", resp.StatusCode)
	}

	var sidecarResult fastTextSidecarResponse
	decoder := json.NewDecoder(resp.Body)
	if err := decoder.Decode(&sidecarResult); err != nil {
		return CacheabilityClassifierResult{}, fmt.Errorf("%w: invalid fasttext sidecar JSON", ErrCacheabilityClassifierInvalidResult)
	}
	confidence := -1.0
	if sidecarResult.Confidence != nil {
		confidence = *sidecarResult.Confidence
	}
	result := CacheabilityClassifierResult{
		Label:        CacheabilityLabel(sidecarResult.Label),
		Confidence:   confidence,
		ReasonCode:   sidecarResult.ReasonCode,
		ModelVersion: sidecarResult.ModelVersion,
	}.Normalize()
	if !result.Passes(DefaultCacheabilityClassifierMinConfidence) {
		if override, ok := cacheabilityRuleStaticGuidanceResult(text, request.PromptCategory, result.ModelVersion); ok {
			return override, nil
		}
	}
	return result, nil
}
