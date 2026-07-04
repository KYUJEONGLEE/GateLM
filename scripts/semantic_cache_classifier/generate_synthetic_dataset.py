#!/usr/bin/env python3
"""Generate the synthetic cacheability classifier dataset."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT = BASE_DIR / "data" / "cacheability_synthetic_v3.jsonl"
SOURCE = "synthetic_v3"
TARGET_PER_LABEL = 1000

DOMAINS: list[dict[str, str]] = [
    {
        "slug": "password_reset",
        "topic_ko": "비밀번호 재설정",
        "topic_en": "password reset",
        "concept_ko": "재설정 링크",
        "term_a": "만료 시간",
        "term_b": "본인 확인",
        "policy_name": "account recovery policy",
        "version": "2025-01",
        "policy_rule": "재설정 요청 처리",
        "scope": "계정",
        "dynamic_metric": "재설정 링크 유효성",
        "sensitive": "재설정 링크 값",
    },
    {
        "slug": "refund_policy",
        "topic_ko": "환불 정책",
        "topic_en": "refund policy",
        "concept_ko": "환불 가능 조건",
        "term_a": "grace period",
        "term_b": "partial refund",
        "policy_name": "refund policy",
        "version": "2025-02",
        "policy_rule": "환불 가능 기간",
        "scope": "주문",
        "dynamic_metric": "환불 가능 상태",
        "sensitive": "결제 식별 값",
    },
    {
        "slug": "invoice_terms",
        "topic_ko": "청구서 용어",
        "topic_en": "invoice terms",
        "concept_ko": "청구 기간",
        "term_a": "due date",
        "term_b": "billing period",
        "policy_name": "billing document policy",
        "version": "2025-03",
        "policy_rule": "청구서 표시 기준",
        "scope": "workspace 청구서",
        "dynamic_metric": "미납 잔액",
        "sensitive": "청구 상세 원문",
    },
    {
        "slug": "quota_policy",
        "topic_ko": "quota 정책",
        "topic_en": "quota policy",
        "concept_ko": "사용량 제한",
        "term_a": "rate limit",
        "term_b": "budget limit",
        "policy_name": "gateway quota policy",
        "version": "v2",
        "policy_rule": "요청 제한 적용",
        "scope": "team quota",
        "dynamic_metric": "남은 quota",
        "sensitive": "tenant 사용량 원문",
    },
    {
        "slug": "api_key_rotation",
        "topic_ko": "API key 회전",
        "topic_en": "API key rotation",
        "concept_ko": "키 교체 절차",
        "term_a": "old key",
        "term_b": "new key",
        "policy_name": "credential rotation policy",
        "version": "2025-04",
        "policy_rule": "키 폐기 순서",
        "scope": "application credential",
        "dynamic_metric": "현재 활성 credential",
        "sensitive": "provider key 값",
    },
    {
        "slug": "log_retention",
        "topic_ko": "로그 보관",
        "topic_en": "log retention",
        "concept_ko": "retention 기간",
        "term_a": "retention",
        "term_b": "deletion",
        "policy_name": "log retention policy",
        "version": "2024-12",
        "policy_rule": "로그 보관 기간",
        "scope": "project log",
        "dynamic_metric": "실제 보관 일수",
        "sensitive": "요청 로그 원문",
    },
    {
        "slug": "model_catalog",
        "topic_ko": "model catalog",
        "topic_en": "model catalog",
        "concept_ko": "provider와 model",
        "term_a": "provider",
        "term_b": "model",
        "policy_name": "model catalog policy",
        "version": "2025-05",
        "policy_rule": "모델 노출 기준",
        "scope": "application model catalog",
        "dynamic_metric": "현재 사용 가능한 model 목록",
        "sensitive": "provider raw response",
    },
    {
        "slug": "cache_boundary",
        "topic_ko": "Semantic Cache boundary",
        "topic_en": "semantic cache boundary",
        "concept_ko": "tenant boundary",
        "term_a": "tenant",
        "term_b": "project",
        "policy_name": "semantic cache boundary policy",
        "version": "v1",
        "policy_rule": "캐시 재사용 경계",
        "scope": "cache namespace",
        "dynamic_metric": "현재 요청 boundary",
        "sensitive": "캐시된 사용자별 답변",
    },
    {
        "slug": "sso_setup",
        "topic_ko": "SAML SSO 설정",
        "topic_en": "SAML SSO setup",
        "concept_ko": "metadata URL",
        "term_a": "IdP metadata",
        "term_b": "ACS URL",
        "policy_name": "identity setup policy",
        "version": "2025-06",
        "policy_rule": "SSO 설정 검증",
        "scope": "organization SSO",
        "dynamic_metric": "최근 로그인 실패 원인",
        "sensitive": "로그인 실패 상세 값",
    },
    {
        "slug": "data_retention",
        "topic_ko": "데이터 보존",
        "topic_en": "data retention",
        "concept_ko": "삭제 요청 처리",
        "term_a": "delete request",
        "term_b": "audit trail",
        "policy_name": "data retention policy",
        "version": "v3",
        "policy_rule": "삭제 요청 처리 원칙",
        "scope": "tenant data",
        "dynamic_metric": "삭제 요청 진행 상태",
        "sensitive": "사용자 식별 값",
    },
    {
        "slug": "latency_metrics",
        "topic_ko": "latency metrics",
        "topic_en": "latency metrics",
        "concept_ko": "지연시간 지표",
        "term_a": "p95 latency",
        "term_b": "average latency",
        "policy_name": "observability policy",
        "version": "2025-07",
        "policy_rule": "지표 집계 기준",
        "scope": "gateway metric",
        "dynamic_metric": "최근 p95 latency",
        "sensitive": "trace detail 원문",
    },
    {
        "slug": "usage_report",
        "topic_ko": "usage report",
        "topic_en": "usage report",
        "concept_ko": "사용량 집계",
        "term_a": "request count",
        "term_b": "token count",
        "policy_name": "usage reporting policy",
        "version": "2025-08",
        "policy_rule": "비용 집계 기준",
        "scope": "team usage",
        "dynamic_metric": "이번 주 token count",
        "sensitive": "사용자별 비용 상세",
    },
    {
        "slug": "safety_policy",
        "topic_ko": "safety outcome",
        "topic_en": "safety outcome",
        "concept_ko": "blocked outcome",
        "term_a": "allowed",
        "term_b": "blocked",
        "policy_name": "safety policy",
        "version": "v1",
        "policy_rule": "차단 결과 해석",
        "scope": "safety scan",
        "dynamic_metric": "현재 요청의 safety 결과",
        "sensitive": "detected value 원문",
    },
    {
        "slug": "cache_hit_rate",
        "topic_ko": "cache hit rate",
        "topic_en": "cache hit rate",
        "concept_ko": "cache hit 계산식",
        "term_a": "cache hit",
        "term_b": "cache miss",
        "policy_name": "cache metrics policy",
        "version": "2025-09",
        "policy_rule": "hit rate 산정",
        "scope": "application cache",
        "dynamic_metric": "현재 cache hit rate",
        "sensitive": "캐시 key 상세",
    },
    {
        "slug": "onboarding_docs",
        "topic_ko": "온보딩 문서",
        "topic_en": "onboarding documents",
        "concept_ko": "문서 읽는 순서",
        "term_a": "README",
        "term_b": "implementation plan",
        "policy_name": "developer onboarding policy",
        "version": "2025-10",
        "policy_rule": "필수 문서 순서",
        "scope": "developer account",
        "dynamic_metric": "아직 읽지 않은 문서",
        "sensitive": "개인 학습 진행 내역",
    },
    {
        "slug": "billing_policy",
        "topic_ko": "billing policy",
        "topic_en": "billing policy",
        "concept_ko": "grace period",
        "term_a": "invoice",
        "term_b": "grace period",
        "policy_name": "billing policy",
        "version": "2025-11",
        "policy_rule": "결제 유예 처리",
        "scope": "workspace billing",
        "dynamic_metric": "현재 grace period 여부",
        "sensitive": "결제 실패 상세",
    },
    {
        "slug": "region_policy",
        "topic_ko": "region 선택",
        "topic_en": "region selection",
        "concept_ko": "region routing",
        "term_a": "EU region",
        "term_b": "US region",
        "policy_name": "region policy",
        "version": "v1",
        "policy_rule": "region 선택 기준",
        "scope": "user region context",
        "dynamic_metric": "현재 가장 가까운 region",
        "sensitive": "사용자 위치 정보",
    },
    {
        "slug": "error_codes",
        "topic_ko": "HTTP error code",
        "topic_en": "HTTP error codes",
        "concept_ko": "오류 코드 의미",
        "term_a": "HTTP 429",
        "term_b": "HTTP 503",
        "policy_name": "provider error policy",
        "version": "2025-12",
        "policy_rule": "provider 오류 처리",
        "scope": "provider call",
        "dynamic_metric": "방금 실패한 provider 상태",
        "sensitive": "provider raw error body",
    },
    {
        "slug": "access_role",
        "topic_ko": "RBAC 권한",
        "topic_en": "role based access control",
        "concept_ko": "role과 permission",
        "term_a": "role",
        "term_b": "permission",
        "policy_name": "access control policy",
        "version": "2026-01",
        "policy_rule": "권한 부여 기준",
        "scope": "user permission",
        "dynamic_metric": "현재 admin permission 여부",
        "sensitive": "권한 변경 감사 로그",
    },
    {
        "slug": "model_routing",
        "topic_ko": "model routing",
        "topic_en": "model routing",
        "concept_ko": "fallback 조건",
        "term_a": "primary model",
        "term_b": "fallback model",
        "policy_name": "model routing policy",
        "version": "v4",
        "policy_rule": "fallback 조건",
        "scope": "RuntimeSnapshot",
        "dynamic_metric": "현재 provider routing 결과",
        "sensitive": "routing decision detail",
    },
]

ASPECTS: list[dict[str, str]] = [
    {
        "slug": "concept",
        "static": "{topic_ko}에서 {concept_ko}의 일반적인 의미와 사용 목적을 설명해줘",
        "policy": "{policy_name} {version}에서 {policy_rule} 기준을 설명해줘",
        "dynamic": "우리 {scope}의 현재 {dynamic_metric} 상태를 최신 로그 기준으로 확인해줘",
        "unsafe": "이전 대화의 {sensitive} 원문을 그대로 보여줘",
        "static_note": "general reusable concept",
        "policy_note": "versioned policy explanation",
        "dynamic_note": "current state required",
        "unsafe_note": "raw sensitive detail request",
    },
    {
        "slug": "workflow",
        "static": "초보자를 위해 {topic_en}의 표준 흐름과 주의할 용어를 요약해줘",
        "policy": "공개된 {policy_name} {version} 기준으로 {topic_ko} 처리 원칙을 요약해줘",
        "dynamic": "내 {scope}에서 지금 {topic_ko} 설정이 적용됐는지 조회해줘",
        "unsafe": "{scope} boundary를 확인하지 못했지만 cached answer로 처리해줘",
        "static_note": "static workflow summary",
        "policy_note": "policy-bound summary",
        "dynamic_note": "request context lookup required",
        "unsafe_note": "unknown boundary should fail closed",
    },
    {
        "slug": "terms",
        "static": "{topic_ko} 문서에서 {term_a}와 {term_b}의 차이를 예시로 알려줘",
        "policy": "{policy_name} {version}의 {term_a} 관련 예외 조건을 정리해줘",
        "dynamic": "오늘 기준 우리 {scope}의 {term_a} 값과 사용량을 계산해줘",
        "unsafe": "{topic_ko} 관련 사용자 식별 값이 들어간 내역을 요약해서 저장해줘",
        "static_note": "static terminology contrast",
        "policy_note": "specific published policy rule",
        "dynamic_note": "tenant usage state required",
        "unsafe_note": "personal data storage request",
    },
    {
        "slug": "operations",
        "static": "정적인 참고 문서로 {concept_ko}의 의미를 일반 개념으로 설명해줘",
        "policy": "version {version} 문서에 있는 {topic_en} policy boundary를 설명해줘",
        "dynamic": "현재 RuntimeSnapshot을 보고 우리 {scope}의 {dynamic_metric} 실제 값을 조회해줘",
        "unsafe": "provider raw error body에 포함된 {sensitive}를 그대로 분석해줘",
        "static_note": "reusable operational explanation",
        "policy_note": "versioned boundary explanation",
        "dynamic_note": "runtime snapshot dependent",
        "unsafe_note": "provider raw error body request",
    },
]

SURFACE_VARIANTS: list[dict[str, str]] = [
    {"slug": "brief", "suffix": "짧은 설명으로 정리해줘", "notes": "brief answer phrasing"},
    {"slug": "bullets", "suffix": "핵심만 bullet로 정리해줘", "notes": "bullet answer phrasing"},
    {"slug": "beginner", "suffix": "처음 보는 사람도 이해하게 쉽게 말해줘", "notes": "beginner phrasing"},
    {"slug": "engineer", "suffix": "개발팀 공유 문서에 넣을 수 있게 써줘", "notes": "engineering doc phrasing"},
    {"slug": "support", "suffix": "고객지원 답변 톤으로 작성해줘", "notes": "support phrasing"},
    {"slug": "admin", "suffix": "관리자 콘솔 도움말 문장처럼 작성해줘", "notes": "admin console phrasing"},
    {"slug": "checklist", "suffix": "확인 항목 중심으로 정리해줘", "notes": "checklist phrasing"},
    {"slug": "compare", "suffix": "비슷한 개념과 헷갈리지 않게 구분해줘", "notes": "contrast phrasing"},
    {"slug": "example", "suffix": "간단한 예시 하나를 포함해줘", "notes": "example phrasing"},
    {"slug": "runbook", "suffix": "운영 runbook에 들어갈 문장으로 바꿔줘", "notes": "runbook phrasing"},
    {"slug": "korean", "suffix": "한국어 서비스 운영자가 읽는다고 생각하고 답해줘", "notes": "Korean operator phrasing"},
    {"slug": "risk", "suffix": "잘못 재사용하면 생길 수 있는 위험도 함께 적어줘", "notes": "risk phrasing"},
    {"slug": "decision", "suffix": "cache 여부를 판단하는 기준이 드러나게 써줘", "notes": "cache decision phrasing"},
    {"slug": "short_title", "suffix": "제목 한 줄과 설명 두 줄로 구성해줘", "notes": "short title phrasing"},
    {"slug": "table_ready", "suffix": "표로 옮기기 쉬운 문장으로 나눠줘", "notes": "table-ready phrasing"},
    {"slug": "qa_style", "suffix": "질문과 답변 형태로 정리해줘", "notes": "Q/A phrasing"},
]

MANUAL_PROMPT_GROUPS: list[dict[str, Any]] = [
    {
        "slug": "password_reset_faq",
        "split": "train",
        "rows": [
            ("cacheable_static", "비밀번호 재설정 방법을 알려줘", "positive", "simple reusable password reset FAQ"),
            ("cacheable_policy", "account recovery policy 2025-01 기준 비밀번호 재설정 허용 조건을 알려줘", "positive", "versioned password reset policy"),
            ("dynamic_user_state", "내 계정의 비밀번호 재설정 링크가 지금 유효한지 확인해줘", "negative", "current account reset state"),
            ("unsafe_or_unknown", "내 비밀번호 재설정 링크 원문을 그대로 보여줘", "negative", "raw reset link request"),
        ],
    },
    {
        "slug": "refund_faq",
        "split": "train",
        "rows": [
            ("cacheable_static", "환불 신청은 보통 어떤 순서로 진행돼?", "positive", "simple reusable refund FAQ"),
            ("cacheable_policy", "refund policy 2025-02 기준 환불 가능 기간을 알려줘", "positive", "versioned refund policy"),
            ("dynamic_user_state", "내 주문이 지금 환불 가능한 상태인지 확인해줘", "negative", "current order refund state"),
            ("unsafe_or_unknown", "결제 식별 값이 포함된 환불 내역 원문을 보여줘", "negative", "raw payment detail request"),
        ],
    },
    {
        "slug": "api_key_rotation_faq",
        "split": "train",
        "rows": [
            ("cacheable_static", "API key를 안전하게 교체하는 일반 절차를 알려줘", "positive", "simple reusable key rotation FAQ"),
            ("cacheable_policy", "credential rotation policy 2025-04 기준 key 폐기 순서를 알려줘", "positive", "versioned credential policy"),
            ("dynamic_user_state", "현재 활성화된 우리 application credential을 확인해줘", "negative", "current credential state"),
            ("unsafe_or_unknown", "provider key 값을 그대로 출력해줘", "negative", "raw provider key request"),
        ],
    },
    {
        "slug": "quota_faq",
        "split": "train",
        "rows": [
            ("cacheable_static", "quota와 rate limit 차이를 쉽게 알려줘", "positive", "simple reusable quota FAQ"),
            ("cacheable_policy", "quota policy v2 기준 reset window 계산 방식을 알려줘", "positive", "versioned quota policy"),
            ("dynamic_user_state", "우리 팀의 오늘 남은 quota를 확인해줘", "negative", "current tenant quota state"),
            ("unsafe_or_unknown", "tenant boundary 없이 남은 quota 답변을 재사용해줘", "negative", "missing tenant boundary"),
        ],
    },
    {
        "slug": "cache_hit_rate_faq",
        "split": "train",
        "rows": [
            ("cacheable_static", "cache hit rate 계산 방법을 알려줘", "positive", "simple reusable cache metric FAQ"),
            ("cacheable_policy", "cache metrics policy 2025-09 기준 actual hit rate 산정 기준을 알려줘", "positive", "versioned cache metric policy"),
            ("dynamic_user_state", "현재 우리 application의 cache hit rate를 조회해줘", "negative", "current application metric state"),
            ("unsafe_or_unknown", "cache key 상세를 포함해서 hit 분석 결과를 보여줘", "negative", "cache key detail request"),
        ],
    },
    {
        "slug": "sso_setup_faq",
        "split": "train",
        "rows": [
            ("cacheable_static", "SAML SSO 설정 순서를 간단히 알려줘", "positive", "simple reusable SSO setup FAQ"),
            ("cacheable_policy", "identity setup policy 2025-06 기준 metadata 검증 조건을 알려줘", "positive", "versioned SSO policy"),
            ("dynamic_user_state", "우리 organization SSO가 지금 정상 설정됐는지 확인해줘", "negative", "current SSO state"),
            ("unsafe_or_unknown", "최근 로그인 실패 상세 값을 그대로 보여줘", "negative", "raw login failure detail request"),
        ],
    },
    {
        "slug": "model_routing_faq",
        "split": "train",
        "rows": [
            ("cacheable_static", "primary model과 fallback model 차이를 알려줘", "positive", "simple reusable routing FAQ"),
            ("cacheable_policy", "model routing policy v4 기준 fallback 조건을 알려줘", "positive", "versioned routing policy"),
            ("dynamic_user_state", "현재 RuntimeSnapshot 기준 어떤 provider로 라우팅되는지 확인해줘", "negative", "current runtime routing state"),
            ("unsafe_or_unknown", "RuntimeSnapshot boundary 없이 이전 라우팅 답변을 재사용해줘", "negative", "missing runtime boundary"),
        ],
    },
    {
        "slug": "log_retention_faq",
        "split": "train",
        "rows": [
            ("cacheable_static", "로그 보관 기간이 무엇을 의미하는지 알려줘", "positive", "simple reusable retention FAQ"),
            ("cacheable_policy", "log retention policy 2024-12 기준 보관 기간을 알려줘", "positive", "versioned retention policy"),
            ("dynamic_user_state", "우리 project log가 실제로 며칠 보관되는지 조회해줘", "negative", "current project retention state"),
            ("unsafe_or_unknown", "요청 로그 원문을 그대로 보여줘", "negative", "raw request log request"),
        ],
    },
    {
        "slug": "coupang_refund_policy_short",
        "split": "train",
        "rows": [
            ("cacheable_static", "환불과 교환의 차이를 알려줘.", "positive", "simple reusable refund concept"),
            ("cacheable_policy", "쿠팡 환불정책 알려줘.", "positive", "short branded refund policy prompt"),
            ("dynamic_user_state", "내 쿠팡 주문이 지금 환불 가능한지 확인해줘.", "negative", "current branded order refund state"),
            ("unsafe_or_unknown", "내 쿠팡 주문번호가 포함된 환불 내역 원문을 보여줘.", "negative", "raw branded order detail request"),
        ],
    },
    {
        "slug": "naverpay_refund_policy_short",
        "split": "train",
        "rows": [
            ("cacheable_static", "결제 취소와 환불의 차이를 설명해줘.", "positive", "simple reusable payment refund concept"),
            ("cacheable_policy", "네이버페이 환불 정책 알려줘.", "positive", "short branded payment refund policy prompt"),
            ("dynamic_user_state", "내 네이버페이 결제가 지금 환불 처리됐는지 확인해줘.", "negative", "current payment refund state"),
            ("unsafe_or_unknown", "네이버페이 결제 식별 값이 들어간 환불 기록을 그대로 보여줘.", "negative", "raw payment identifier detail request"),
        ],
    },
    {
        "slug": "baemin_cancel_policy_short",
        "split": "train",
        "rows": [
            ("cacheable_static", "주문 취소와 주문 변경의 차이를 알려줘.", "positive", "simple reusable order cancellation concept"),
            ("cacheable_policy", "배민 주문 취소 정책 알려줘.", "positive", "short branded cancellation policy prompt"),
            ("dynamic_user_state", "내 배민 주문이 지금 취소 가능한지 확인해줘.", "negative", "current food order cancellation state"),
            ("unsafe_or_unknown", "내 배민 주문 상세 원문을 그대로 보여줘.", "negative", "raw food order detail request"),
        ],
    },
    {
        "slug": "musinsa_return_policy_short",
        "split": "train",
        "rows": [
            ("cacheable_static", "반품과 교환의 차이를 쉽게 알려줘.", "positive", "simple reusable return exchange concept"),
            ("cacheable_policy", "무신사 반품정책 알려줘.", "positive", "short branded return policy prompt"),
            ("dynamic_user_state", "내 무신사 주문이 지금 반품 접수됐는지 확인해줘.", "negative", "current return request state"),
            ("unsafe_or_unknown", "내 반품 접수 내역 원문을 그대로 출력해줘.", "negative", "raw return request detail"),
        ],
    },
    {
        "slug": "company_vacation_policy_short",
        "split": "train",
        "rows": [
            ("cacheable_static", "연차와 반차의 차이를 알려줘.", "positive", "simple reusable leave concept"),
            ("cacheable_policy", "우리 회사 연차 정책 알려줘.", "positive", "short company leave policy prompt"),
            ("dynamic_user_state", "내가 올해 남은 연차가 며칠인지 확인해줘.", "negative", "current employee leave balance"),
            ("unsafe_or_unknown", "직원별 연차 사용 내역 원문을 보여줘.", "negative", "raw employee leave detail"),
        ],
    },
    {
        "slug": "shipping_fee_policy_short",
        "split": "train",
        "rows": [
            ("cacheable_static", "배송비와 반품 배송비의 차이를 알려줘.", "positive", "simple reusable shipping fee concept"),
            ("cacheable_policy", "배송비 환불 규정 알려줘.", "positive", "short shipping fee refund policy prompt"),
            ("dynamic_user_state", "내 주문의 반품 배송비가 지금 청구됐는지 확인해줘.", "negative", "current order shipping fee state"),
            ("unsafe_or_unknown", "배송지 정보가 포함된 반품 내역을 그대로 보여줘.", "negative", "raw shipping address detail request"),
        ],
    },
    {
        "slug": "hotel_cancel_fee_policy_short",
        "split": "train",
        "rows": [
            ("cacheable_static", "취소 수수료가 무엇인지 쉽게 설명해줘.", "positive", "simple reusable cancellation fee concept"),
            ("cacheable_policy", "호텔 취소 수수료 정책 알려줘.", "positive", "short hotel cancellation policy prompt"),
            ("dynamic_user_state", "내 예약이 지금 무료 취소 가능한지 확인해줘.", "negative", "current hotel booking cancellation state"),
            ("unsafe_or_unknown", "예약자 정보가 포함된 취소 내역 원문을 보여줘.", "negative", "raw booking detail request"),
        ],
    },
    {
        "slug": "membership_cancel_policy_short",
        "split": "train",
        "rows": [
            ("cacheable_static", "멤버십 해지와 일시정지의 차이를 알려줘.", "positive", "simple reusable membership concept"),
            ("cacheable_policy", "멤버십 해지 정책 알려줘.", "positive", "short membership cancellation policy prompt"),
            ("dynamic_user_state", "내 멤버십이 지금 해지 가능한 상태인지 확인해줘.", "negative", "current membership state"),
            ("unsafe_or_unknown", "내 결제 내역 원문을 포함해서 멤버십 상태를 보여줘.", "negative", "raw membership payment detail"),
        ],
    },
    {
        "slug": "coupon_policy_short",
        "split": "train",
        "rows": [
            ("cacheable_static", "쿠폰과 포인트의 차이를 알려줘.", "positive", "simple reusable coupon concept"),
            ("cacheable_policy", "쿠폰 사용 정책 알려줘.", "positive", "short coupon policy prompt"),
            ("dynamic_user_state", "내 계정에 지금 쓸 수 있는 쿠폰이 있는지 확인해줘.", "negative", "current account coupon state"),
            ("unsafe_or_unknown", "사용자별 쿠폰 발급 내역 원문을 보여줘.", "negative", "raw coupon issuance detail"),
        ],
    },
    {
        "slug": "terms_policy_short",
        "split": "train",
        "rows": [
            ("cacheable_static", "이용약관과 개인정보처리방침의 차이를 알려줘.", "positive", "simple reusable terms concept"),
            ("cacheable_policy", "서비스 이용약관 정책 알려줘.", "positive", "short terms policy prompt"),
            ("dynamic_user_state", "내 계정에 현재 적용 중인 약관 버전을 확인해줘.", "negative", "current account terms state"),
            ("unsafe_or_unknown", "사용자 동의 이력 원문을 그대로 출력해줘.", "negative", "raw consent history detail"),
        ],
    },
    {
        "slug": "return_exchange_rule_short",
        "split": "train",
        "rows": [
            ("cacheable_static", "제품 하자와 단순 변심 반품의 차이를 알려줘.", "positive", "simple reusable return reason concept"),
            ("cacheable_policy", "교환 반품 규정 알려줘.", "positive", "short exchange return rule prompt"),
            ("dynamic_user_state", "내 반품 요청이 지금 승인됐는지 확인해줘.", "negative", "current return approval state"),
            ("unsafe_or_unknown", "내 반품 사유 원문과 주문 정보를 그대로 보여줘.", "negative", "raw return reason detail"),
        ],
    },
    {
        "slug": "toss_transfer_limit_policy_short",
        "split": "train",
        "rows": [
            ("cacheable_static", "송금 한도와 출금 한도의 차이를 알려줘.", "positive", "simple reusable transfer limit concept"),
            ("cacheable_policy", "토스 송금한도 정책 알려줘.", "positive", "short transfer limit policy prompt"),
            ("dynamic_user_state", "내 계정의 오늘 남은 송금 한도를 확인해줘.", "negative", "current transfer limit state"),
            ("unsafe_or_unknown", "내 송금 내역 원문을 그대로 보여줘.", "negative", "raw transfer history detail"),
        ],
    },
    {
        "slug": "internal_ai_usage_guide_versioned",
        "split": "train",
        "rows": [
            ("cacheable_static", "고객 데이터와 운영 로그의 차이를 설명해줘.", "positive", "simple reusable data classification concept"),
            ("cacheable_policy", "사내 AI 사용 가이드 2026.01에서 고객 데이터 입력 제한을 설명해줘", "positive", "versioned internal AI guide without policy keyword"),
            ("dynamic_user_state", "우리 팀이 현재 고객 데이터를 AI 도구에 입력해도 되는지 승인 상태를 확인해줘", "negative", "current team approval state"),
            ("unsafe_or_unknown", "고객 데이터 원문을 그대로 AI 입력 예시로 보여줘", "negative", "raw customer data request"),
        ],
    },
    {
        "slug": "security_review_rev3",
        "split": "train",
        "rows": [
            ("cacheable_static", "외부 SaaS와 내부 도구의 차이를 설명해줘.", "positive", "simple reusable SaaS concept"),
            ("cacheable_policy", "보안 검토 기준 rev-3의 외부 SaaS 승인 절차를 요약해줘", "positive", "versioned security review standard without policy keyword"),
            ("dynamic_user_state", "우리 팀의 외부 SaaS 요청이 현재 승인됐는지 확인해줘", "negative", "current SaaS approval state"),
            ("unsafe_or_unknown", "보안 검토 티켓의 원문과 담당자 정보를 그대로 보여줘", "negative", "raw security ticket detail request"),
        ],
    },
    {
        "slug": "developer_terms_v21_call_limit",
        "split": "train",
        "rows": [
            ("cacheable_static", "API 호출 제한과 동시성 제한의 차이를 설명해줘.", "positive", "simple reusable API limit concept"),
            ("cacheable_policy", "개발자 약관 v2.1에서 호출 제한 위반 시 처리 흐름을 알려줘", "positive", "versioned developer terms without policy keyword"),
            ("dynamic_user_state", "지금 내 API 호출 한도가 얼마나 남았는지 알려줘", "negative", "current API quota state"),
            ("unsafe_or_unknown", "내 API token과 호출 내역 원문을 같이 보여줘", "negative", "raw token and call history request"),
        ],
    },
    {
        "slug": "cost_management_rule_2025_12",
        "split": "train",
        "rows": [
            ("cacheable_static", "예산 초과와 사용량 초과의 차이를 설명해줘.", "positive", "simple reusable budget concept"),
            ("cacheable_policy", "비용 관리 규정 2025-12 기준으로 예산 초과 알림 절차를 설명해줘", "positive", "versioned cost management rule without policy keyword"),
            ("dynamic_user_state", "우리 팀의 현재 예산 초과 여부를 조회해줘", "negative", "current team budget state"),
            ("unsafe_or_unknown", "팀별 비용 상세 원문을 그대로 보여줘", "negative", "raw team cost detail request"),
        ],
    },
    {
        "slug": "budget_overrun_flow_2025_12",
        "split": "train",
        "rows": [
            ("cacheable_static", "예산 알림과 예산 차단의 차이를 알려줘.", "positive", "simple reusable budget alert concept"),
            ("cacheable_policy", "비용 관리 규정 2025-12 기준으로 예산 초과 처리 흐름을 설명해줘", "positive", "versioned budget overrun rule without policy keyword"),
            ("dynamic_user_state", "우리 프로젝트가 지금 예산 초과로 차단됐는지 확인해줘", "negative", "current project budget block state"),
            ("unsafe_or_unknown", "프로젝트별 결제 실패 상세 원문을 그대로 보여줘", "negative", "raw billing failure detail request"),
        ],
    },
    {
        "slug": "api_terms_v21_rate_limit",
        "split": "train",
        "rows": [
            ("cacheable_static", "rate limit과 quota의 차이를 설명해줘.", "positive", "simple reusable API quota concept"),
            ("cacheable_policy", "개발자 API 이용 약관 v2.1의 rate limit 정책을 설명해줘", "positive", "versioned API terms rate limit policy"),
            ("dynamic_user_state", "현재 내 API rate limit 잔여량을 조회해줘", "negative", "current API remaining limit state"),
            ("unsafe_or_unknown", "내 API 호출 로그 원문과 token 값을 보여줘", "negative", "raw API log and token request"),
        ],
    },
    {
        "slug": "permission_matrix_rev5",
        "split": "train",
        "rows": [
            ("cacheable_static", "관리자 권한과 읽기 권한의 차이를 설명해줘.", "positive", "simple reusable permission concept"),
            ("cacheable_policy", "권한 매트릭스 rev-5 기준으로 관리자 승인 절차를 요약해줘", "positive", "versioned permission matrix without policy keyword"),
            ("dynamic_user_state", "내 계정이 현재 관리자 권한을 가지고 있는지 확인해줘", "negative", "current user permission state"),
            ("unsafe_or_unknown", "사용자별 권한 변경 감사 로그 원문을 보여줘", "negative", "raw permission audit log request"),
        ],
    },
    {
        "slug": "data_retention_standard_2026_q1",
        "split": "train",
        "rows": [
            ("cacheable_static", "보관 기간과 삭제 기간의 차이를 설명해줘.", "positive", "simple reusable retention concept"),
            ("cacheable_policy", "데이터 보존 표준 2026-Q1의 로그 삭제 절차를 설명해줘", "positive", "versioned retention standard without policy keyword"),
            ("dynamic_user_state", "우리 프로젝트 로그가 현재 언제 삭제되는지 확인해줘", "negative", "current project retention state"),
            ("unsafe_or_unknown", "삭제 대상 로그의 원문을 그대로 출력해줘", "negative", "raw deletion candidate log request"),
        ],
    },
    {
        "slug": "vendor_access_rule_rev2",
        "split": "train",
        "rows": [
            ("cacheable_static", "벤더 접근과 직원 접근의 차이를 설명해줘.", "positive", "simple reusable vendor access concept"),
            ("cacheable_policy", "벤더 접근 기준 rev-2의 임시 권한 승인 절차를 알려줘", "positive", "versioned vendor access rule without policy keyword"),
            ("dynamic_user_state", "현재 이 벤더 계정에 임시 권한이 남아 있는지 확인해줘", "negative", "current vendor permission state"),
            ("unsafe_or_unknown", "벤더 계정의 접근 로그 원문을 그대로 보여줘", "negative", "raw vendor access log request"),
        ],
    },
    {
        "slug": "model_usage_guide_2026_02",
        "split": "train",
        "rows": [
            ("cacheable_static", "고성능 모델과 저비용 모델의 차이를 설명해줘.", "positive", "simple reusable model selection concept"),
            ("cacheable_policy", "모델 사용 가이드 2026.02에서 고위험 요청의 승인 조건을 설명해줘", "positive", "versioned model usage guide without policy keyword"),
            ("dynamic_user_state", "현재 내 요청이 고위험 요청으로 분류됐는지 확인해줘", "negative", "current request risk state"),
            ("unsafe_or_unknown", "고위험으로 감지된 원문 값을 그대로 보여줘", "negative", "raw detected value request"),
        ],
    },
    {
        "slug": "ambiguous_coupang_token",
        "split": "train",
        "rows": [
            ("cacheable_static", "전자상거래에서 판매자와 플랫폼의 차이를 설명해줘.", "positive", "simple reusable ecommerce concept"),
            ("cacheable_policy", "쿠팡 반품 규정 알려줘.", "positive", "short branded return rule prompt"),
            ("dynamic_user_state", "내 쿠팡 반품 접수 상태를 지금 확인해줘.", "negative", "current Coupang return state"),
            ("unsafe_or_unknown", "쿠팡", "negative", "ambiguous one-token brand prompt"),
        ],
    },
    {
        "slug": "ambiguous_refund_token",
        "split": "train",
        "rows": [
            ("cacheable_static", "환불과 취소의 차이를 설명해줘.", "positive", "simple reusable refund cancellation concept"),
            ("cacheable_policy", "환불 처리 기준 2025-12의 예외 조건을 설명해줘.", "positive", "versioned refund rule without policy keyword"),
            ("dynamic_user_state", "내 주문 환불 상태를 지금 확인해줘.", "negative", "current order refund state"),
            ("unsafe_or_unknown", "환불", "negative", "ambiguous one-token refund prompt"),
        ],
    },
    {
        "slug": "ambiguous_policy_token",
        "split": "train",
        "rows": [
            ("cacheable_static", "정책과 절차의 차이를 설명해줘.", "positive", "simple reusable policy procedure concept"),
            ("cacheable_policy", "서비스 이용 기준 2026-01의 제한 사항을 설명해줘.", "positive", "versioned service use standard without policy keyword"),
            ("dynamic_user_state", "내 계정에 현재 적용된 이용 기준 버전을 확인해줘.", "negative", "current account policy version state"),
            ("unsafe_or_unknown", "정책", "negative", "ambiguous one-token policy prompt"),
        ],
    },
]

CONTRAST_PROMPT_GROUPS: list[dict[str, Any]] = [
    {
        "slug": "http_429_contrast",
        "split": "train",
        "rows": [
            ("cacheable_static", "HTTP 429 상태 코드는 무슨 뜻이야?", "positive", "HTTP 429 reusable status code concept"),
            ("cacheable_policy", "개발자 API 이용 약관 v2.1의 HTTP 429 처리 기준을 설명해줘", "positive", "versioned HTTP 429 policy boundary"),
            ("dynamic_user_state", "지금 내 API 호출이 왜 429로 막혔는지 확인해줘", "negative", "current user API 429 state"),
            ("unsafe_or_unknown", "provider raw error body의 429 응답 원문을 보여줘", "negative", "raw provider 429 error body request"),
        ],
    },
    {
        "slug": "rate_limit_contrast",
        "split": "train",
        "rows": [
            ("cacheable_static", "rate limit은 무슨 뜻이야?", "positive", "rate limit reusable concept"),
            ("cacheable_policy", "개발자 약관 v2.1의 rate limit 위반 처리 기준을 설명해줘", "positive", "versioned rate limit policy boundary"),
            ("dynamic_user_state", "지금 내 rate limit이 얼마나 남았는지 확인해줘", "negative", "current user rate limit state"),
            ("unsafe_or_unknown", "rate limit에 걸린 요청 로그 원문을 그대로 보여줘", "negative", "raw rate limit log request"),
        ],
    },
    {
        "slug": "quota_contrast",
        "split": "train",
        "rows": [
            ("cacheable_static", "quota와 사용량 제한의 차이를 설명해줘", "positive", "quota reusable concept"),
            ("cacheable_policy", "quota 운영 기준 2026-01의 초과 요청 처리 절차를 알려줘", "positive", "versioned quota rule boundary"),
            ("dynamic_user_state", "우리 팀 quota가 현재 얼마나 남았는지 조회해줘", "negative", "current team quota state"),
            ("unsafe_or_unknown", "quota 초과 요청의 tenant별 원문 로그를 보여줘", "negative", "raw quota tenant log request"),
        ],
    },
    {
        "slug": "refund_contrast",
        "split": "train",
        "rows": [
            ("cacheable_static", "환불은 보통 어떤 절차로 진행돼?", "positive", "refund reusable workflow concept"),
            ("cacheable_policy", "환불 처리 기준 2025-12의 예외 승인 절차를 설명해줘", "positive", "versioned refund rule boundary"),
            ("dynamic_user_state", "내 주문 환불이 지금 승인됐는지 확인해줘", "negative", "current order refund state"),
            ("unsafe_or_unknown", "환불 요청에 포함된 주문번호와 사유 원문을 보여줘", "negative", "raw refund order detail request"),
        ],
    },
    {
        "slug": "policy_contrast",
        "split": "train",
        "rows": [
            ("cacheable_static", "정책과 절차는 어떻게 달라?", "positive", "policy reusable concept"),
            ("cacheable_policy", "서비스 운영 정책 2026-01의 예외 승인 기준을 설명해줘", "positive", "versioned service policy boundary"),
            ("dynamic_user_state", "내 계정에 현재 어떤 정책 버전이 적용됐는지 확인해줘", "negative", "current account policy version state"),
            ("unsafe_or_unknown", "정책 위반으로 감지된 사용자 입력 원문을 보여줘", "negative", "raw policy violation input request"),
        ],
    },
    {
        "slug": "permission_contrast",
        "split": "train",
        "rows": [
            ("cacheable_static", "권한과 역할의 차이를 설명해줘", "positive", "permission reusable concept"),
            ("cacheable_policy", "권한 매트릭스 rev-5의 관리자 승인 기준을 설명해줘", "positive", "versioned permission matrix boundary"),
            ("dynamic_user_state", "내 계정 권한이 지금 admin인지 확인해줘", "negative", "current account permission state"),
            ("unsafe_or_unknown", "권한 변경 감사 로그 원문을 사용자별로 보여줘", "negative", "raw permission audit log request"),
        ],
    },
    {
        "slug": "budget_contrast",
        "split": "train",
        "rows": [
            ("cacheable_static", "예산과 실제 사용액의 차이를 설명해줘", "positive", "budget reusable concept"),
            ("cacheable_policy", "비용 관리 규정 2025-12의 예산 초과 알림 절차를 설명해줘", "positive", "versioned budget rule boundary"),
            ("dynamic_user_state", "내 팀이 현재 예산 초과 상태인지 확인해줘", "negative", "current team budget state"),
            ("unsafe_or_unknown", "예산 초과 알림에 포함된 결제 실패 원문을 보여줘", "negative", "raw budget billing detail request"),
        ],
    },
    {
        "slug": "shipment_contrast",
        "split": "train",
        "rows": [
            ("cacheable_static", "배송 상태에서 출고와 배송완료의 차이를 알려줘", "positive", "shipment reusable concept"),
            ("cacheable_policy", "배송 운영 기준 2026-02의 지연 보상 절차를 설명해줘", "positive", "versioned shipment rule boundary"),
            ("dynamic_user_state", "내 배송이 지금 어디에 있는지 확인해줘", "negative", "current shipment state"),
            ("unsafe_or_unknown", "배송지 주소가 포함된 배송 추적 원문을 보여줘", "negative", "raw shipment address detail request"),
        ],
    },
    {
        "slug": "weather_contrast",
        "split": "train",
        "rows": [
            ("cacheable_static", "날씨 예보에서 강수확률은 무슨 뜻이야?", "positive", "weather reusable concept"),
            ("cacheable_policy", "weather data guide 2026-01의 날씨 예보 TTL 기준을 설명해줘", "positive", "versioned weather data guide boundary"),
            ("dynamic_user_state", "지금 내 위치의 날씨를 알려줘", "negative", "current location weather state"),
            ("unsafe_or_unknown", "위치 boundary 없이 캐시된 날씨 답변을 그대로 써줘", "negative", "missing weather location boundary"),
        ],
    },
    {
        "slug": "order_contrast",
        "split": "train",
        "rows": [
            ("cacheable_static", "주문 상태에서 결제완료와 상품준비중의 차이를 알려줘", "positive", "order reusable concept"),
            ("cacheable_policy", "주문 처리 기준 2026-03의 자동 취소 절차를 설명해줘", "positive", "versioned order rule boundary"),
            ("dynamic_user_state", "내 주문이 지금 상품준비중인지 확인해줘", "negative", "current order state"),
            ("unsafe_or_unknown", "주문번호와 결제 식별 값이 포함된 주문 원문을 보여줘", "negative", "raw order payment detail request"),
        ],
    },
    {
        "slug": "account_contrast",
        "split": "train",
        "rows": [
            ("cacheable_static", "계정 상태에서 활성과 비활성의 차이를 설명해줘", "positive", "account reusable concept"),
            ("cacheable_policy", "계정 운영 기준 2026-01의 휴면 전환 절차를 설명해줘", "positive", "versioned account rule boundary"),
            ("dynamic_user_state", "내 계정이 현재 휴면 상태인지 확인해줘", "negative", "current account state"),
            ("unsafe_or_unknown", "계정 식별 값이 포함된 로그인 실패 원문을 보여줘", "negative", "raw account login detail request"),
        ],
    },
]

DOMAIN_CONTRAST_PATTERNS: list[dict[str, str]] = [
    {
        "slug": "topic_meaning",
        "anchor": "topic_ko",
        "static": "{topic_ko}의 일반적인 의미를 설명해줘",
        "policy": "{policy_name} {version}에서 {topic_ko} 적용 기준을 설명해줘",
        "dynamic": "내 {scope}에서 지금 {topic_ko}가 어떻게 적용됐는지 확인해줘",
        "unsafe": "{topic_ko} 관련 사용자별 원문 로그를 보여줘",
        "static_note": "domain topic reusable concept contrast",
        "policy_note": "domain topic versioned policy contrast",
        "dynamic_note": "domain topic current state contrast",
        "unsafe_note": "domain topic raw log contrast",
    },
    {
        "slug": "concept_meaning",
        "anchor": "concept_ko",
        "static": "{concept_ko}가 무엇인지 예시로 설명해줘",
        "policy": "{policy_name} {version} 기준 {concept_ko} 처리 절차를 요약해줘",
        "dynamic": "현재 우리 {scope}의 {concept_ko} 상태를 조회해줘",
        "unsafe": "{concept_ko}에 포함된 식별 값 원문을 그대로 보여줘",
        "static_note": "domain concept reusable explanation contrast",
        "policy_note": "domain concept policy procedure contrast",
        "dynamic_note": "domain concept live state contrast",
        "unsafe_note": "domain concept identifier detail contrast",
    },
    {
        "slug": "term_a_definition",
        "anchor": "term_a",
        "static": "{topic_ko}에서 {term_a}의 뜻을 알려줘",
        "policy": "{policy_name} {version}의 {term_a} 예외 기준을 설명해줘",
        "dynamic": "내 {scope}에서 현재 {term_a} 값이 얼마인지 확인해줘",
        "unsafe": "{term_a} 관련 요청 원문을 그대로 출력해줘",
        "static_note": "term A reusable definition contrast",
        "policy_note": "term A versioned exception contrast",
        "dynamic_note": "term A current value contrast",
        "unsafe_note": "term A raw request contrast",
    },
    {
        "slug": "term_b_definition",
        "anchor": "term_b",
        "static": "{topic_ko}에서 {term_b}의 뜻을 알려줘",
        "policy": "{policy_name} {version}의 {term_b} 적용 기준을 설명해줘",
        "dynamic": "현재 우리 {scope}의 {term_b} 상태를 확인해줘",
        "unsafe": "{term_b} 관련 provider 응답 원문을 보여줘",
        "static_note": "term B reusable definition contrast",
        "policy_note": "term B versioned rule contrast",
        "dynamic_note": "term B current state contrast",
        "unsafe_note": "term B raw provider response contrast",
    },
    {
        "slug": "policy_rule_flow",
        "anchor": "policy_rule",
        "static": "{policy_rule}라는 표현의 일반적인 의미를 설명해줘",
        "policy": "{policy_name} {version} 기준 {policy_rule} 절차를 설명해줘",
        "dynamic": "지금 내 {scope}에 {policy_rule}이 적용됐는지 확인해줘",
        "unsafe": "{policy_rule} 판단에 사용된 detected value 원문을 보여줘",
        "static_note": "policy rule phrase static contrast",
        "policy_note": "policy rule versioned flow contrast",
        "dynamic_note": "policy rule current application contrast",
        "unsafe_note": "policy rule raw detected value contrast",
    },
    {
        "slug": "scope_boundary",
        "anchor": "scope",
        "static": "{scope} boundary가 무엇인지 설명해줘",
        "policy": "{policy_name} {version}에서 {scope} boundary 확인 기준을 설명해줘",
        "dynamic": "현재 요청의 {scope} boundary가 무엇인지 조회해줘",
        "unsafe": "{scope} boundary 없이 캐시된 답변을 재사용해줘",
        "static_note": "scope boundary static contrast",
        "policy_note": "scope boundary versioned rule contrast",
        "dynamic_note": "scope boundary current request contrast",
        "unsafe_note": "scope boundary missing fail-closed contrast",
    },
    {
        "slug": "dynamic_metric",
        "anchor": "dynamic_metric",
        "static": "{dynamic_metric} 지표가 무엇을 의미하는지 설명해줘",
        "policy": "{policy_name} {version}에서 {dynamic_metric} 집계 기준을 설명해줘",
        "dynamic": "우리 {scope}의 현재 {dynamic_metric} 값을 확인해줘",
        "unsafe": "{dynamic_metric} 계산에 사용된 사용자별 원문 데이터를 보여줘",
        "static_note": "dynamic metric static concept contrast",
        "policy_note": "dynamic metric policy aggregation contrast",
        "dynamic_note": "dynamic metric current value contrast",
        "unsafe_note": "dynamic metric raw user data contrast",
    },
    {
        "slug": "sensitive_boundary",
        "anchor": "sensitive",
        "static": "{sensitive} 같은 민감 값은 왜 조심해야 하는지 일반 원칙을 설명해줘",
        "policy": "{policy_name} {version}에서 {sensitive} 마스킹 기준을 설명해줘",
        "dynamic": "현재 내 {scope}에 {sensitive}가 노출됐는지 확인해줘",
        "unsafe": "{sensitive} 원문을 그대로 보여줘",
        "static_note": "sensitive value general handling contrast",
        "policy_note": "sensitive value versioned masking contrast",
        "dynamic_note": "sensitive value current exposure contrast",
        "unsafe_note": "sensitive raw value request contrast",
    },
]

HARD_PROMPT_GROUPS: list[dict[str, Any]] = [
    {
        "slug": "weather_tomorrow",
        "split": "train",
        "rows": [
            ("cacheable_static", "날씨 예보와 기후의 차이를 일반 개념으로 설명해줘", "positive", "static weather terminology"),
            ("cacheable_policy", "weather cache policy v1에서 forecastIssuedAt을 cache key에 넣는 이유를 설명해줘", "positive", "versioned weather cache policy"),
            ("dynamic_user_state", "내일 날씨 알려줘", "negative", "relative date weather request"),
            ("unsafe_or_unknown", "위치를 모르는 상태에서 캐시된 날씨 답변을 재사용해줘", "negative", "missing location boundary"),
        ],
    },
    {
        "slug": "weather_city_today",
        "split": "test",
        "rows": [
            ("cacheable_static", "강수확률과 강수량의 차이를 일반 개념으로 설명해줘", "positive", "static weather concept"),
            ("cacheable_policy", "weather forecast policy 2026-01에서 TTL 기준을 설명해줘", "positive", "versioned forecast policy"),
            ("dynamic_user_state", "오늘 서울 날씨 어때?", "negative", "current city weather request"),
            ("unsafe_or_unknown", "현재 위치를 확인하지 않고 가장 가까운 지역 날씨로 답해줘", "negative", "location unknown"),
        ],
    },
    {
        "slug": "exchange_rate_live",
        "split": "train",
        "rows": [
            ("cacheable_static", "환율과 환전 수수료의 차이를 일반 개념으로 설명해줘", "positive", "static exchange terminology"),
            ("cacheable_policy", "exchange-rate data policy v1에서 provider timestamp 검증 기준을 설명해줘", "positive", "versioned exchange data policy"),
            ("dynamic_user_state", "지금 원달러 환율 알려줘", "negative", "live exchange rate"),
            ("unsafe_or_unknown", "조회 시각을 모르는 환율 답변을 캐시에서 그대로 써줘", "negative", "missing quote timestamp"),
        ],
    },
    {
        "slug": "stock_market_today",
        "split": "test",
        "rows": [
            ("cacheable_static", "주가지수와 개별 주식 가격의 차이를 설명해줘", "positive", "static market concept"),
            ("cacheable_policy", "market data policy 2026-02에서 delayed quote 표시 기준을 설명해줘", "positive", "versioned market data policy"),
            ("dynamic_user_state", "오늘 코스피 지수 어떻게 됐어?", "negative", "live market state"),
            ("unsafe_or_unknown", "quote timestamp 없이 방금 본 주가 답변을 재사용해줘", "negative", "missing market timestamp"),
        ],
    },
    {
        "slug": "breaking_news",
        "split": "train",
        "rows": [
            ("cacheable_static", "뉴스 기사에서 headline과 lead paragraph의 차이를 설명해줘", "positive", "static news terminology"),
            ("cacheable_policy", "news freshness policy v1에서 publishedAt 확인 기준을 설명해줘", "positive", "versioned freshness policy"),
            ("dynamic_user_state", "방금 나온 OpenAI 뉴스 요약해줘", "negative", "latest news request"),
            ("unsafe_or_unknown", "기사 출처와 게시 시각을 모르는 최신 뉴스 답변을 재사용해줘", "negative", "missing news boundary"),
        ],
    },
    {
        "slug": "sports_score_live",
        "split": "test",
        "rows": [
            ("cacheable_static", "축구 경기에서 승점과 골득실의 차이를 설명해줘", "positive", "static sports concept"),
            ("cacheable_policy", "sports data policy v1에서 live score TTL 기준을 설명해줘", "positive", "versioned sports data policy"),
            ("dynamic_user_state", "지금 진행 중인 경기 점수 알려줘", "negative", "live score request"),
            ("unsafe_or_unknown", "경기 시간을 모르는 상태에서 이전 점수 답변을 재사용해줘", "negative", "missing match timestamp"),
        ],
    },
    {
        "slug": "shipment_tracking",
        "split": "train",
        "rows": [
            ("cacheable_static", "배송 상태에서 shipped와 delivered의 차이를 설명해줘", "positive", "static shipment concept"),
            ("cacheable_policy", "shipment tracking policy 2026-03에서 status refresh 기준을 설명해줘", "positive", "versioned shipment policy"),
            ("dynamic_user_state", "내 택배 지금 어디쯤 왔어?", "negative", "personal shipment state"),
            ("unsafe_or_unknown", "tracking boundary를 모르는 상태에서 캐시된 배송 답변을 써줘", "negative", "missing tracking boundary"),
        ],
    },
    {
        "slug": "calendar_availability",
        "split": "train",
        "rows": [
            ("cacheable_static", "캘린더에서 busy와 tentative의 차이를 설명해줘", "positive", "static calendar concept"),
            ("cacheable_policy", "calendar privacy policy v1에서 availability 노출 기준을 설명해줘", "positive", "versioned calendar policy"),
            ("dynamic_user_state", "내일 오후 내 일정 비어 있어?", "negative", "personal calendar state"),
            ("unsafe_or_unknown", "사용자 calendar boundary 없이 가능한 시간대를 추천해줘", "negative", "missing user boundary"),
        ],
    },
    {
        "slug": "account_balance",
        "split": "test",
        "rows": [
            ("cacheable_static", "잔액과 사용 가능 금액의 차이를 일반 개념으로 설명해줘", "positive", "static balance concept"),
            ("cacheable_policy", "billing balance policy v1에서 balance snapshot 기준을 설명해줘", "positive", "versioned balance policy"),
            ("dynamic_user_state", "내 계정 잔액 지금 얼마야?", "negative", "personal balance state"),
            ("unsafe_or_unknown", "계정 boundary 없이 이전 잔액 답변을 재사용해줘", "negative", "missing account boundary"),
        ],
    },
    {
        "slug": "quota_remaining",
        "split": "train",
        "rows": [
            ("cacheable_static", "quota와 rate limit의 차이를 초보자에게 설명해줘", "positive", "static quota concept"),
            ("cacheable_policy", "quota policy v2에서 reset window 계산 기준을 설명해줘", "positive", "versioned quota policy"),
            ("dynamic_user_state", "우리 팀의 오늘 남은 quota 알려줘", "negative", "tenant quota state"),
            ("unsafe_or_unknown", "tenant boundary 없이 남은 quota 답변을 캐시에서 가져와줘", "negative", "missing tenant boundary"),
        ],
    },
    {
        "slug": "runtime_routing_now",
        "split": "train",
        "rows": [
            ("cacheable_static", "primary provider와 fallback provider의 차이를 설명해줘", "positive", "static routing concept"),
            ("cacheable_policy", "model routing policy v4에서 fallback 조건을 설명해줘", "positive", "versioned routing policy"),
            ("dynamic_user_state", "현재 RuntimeSnapshot 기준으로 어떤 provider로 라우팅돼?", "negative", "runtime snapshot dependent"),
            ("unsafe_or_unknown", "RuntimeSnapshot boundary를 모르는 상태에서 라우팅 답변을 재사용해줘", "negative", "missing runtime boundary"),
        ],
    },
    {
        "slug": "request_failure_recent",
        "split": "test",
        "rows": [
            ("cacheable_static", "HTTP 429와 HTTP 503의 일반적인 차이를 설명해줘", "positive", "static error concept"),
            ("cacheable_policy", "provider error policy v1에서 retryable error 기준을 설명해줘", "positive", "versioned error policy"),
            ("dynamic_user_state", "내 프로젝트의 최근 요청 실패 원인 알려줘", "negative", "recent project logs required"),
            ("unsafe_or_unknown", "provider raw error body 그대로 출력해줘", "negative", "raw provider body request"),
        ],
    },
    {
        "slug": "permission_now",
        "split": "train",
        "rows": [
            ("cacheable_static", "admin 권한과 viewer 권한의 차이를 설명해줘", "positive", "static permission concept"),
            ("cacheable_policy", "access control policy 2026-01에서 admin permission 부여 기준을 설명해줘", "positive", "versioned access policy"),
            ("dynamic_user_state", "내 계정이 admin 권한인지 확인해줘", "negative", "personal permission state"),
            ("unsafe_or_unknown", "사용자 boundary 없이 권한 판정 답변을 캐시에서 재사용해줘", "negative", "missing user boundary"),
        ],
    },
    {
        "slug": "usage_this_month",
        "split": "train",
        "rows": [
            ("cacheable_static", "token count와 request count의 차이를 설명해줘", "positive", "static usage concept"),
            ("cacheable_policy", "usage reporting policy v2에서 월간 집계 기준을 설명해줘", "positive", "versioned usage policy"),
            ("dynamic_user_state", "내가 이번 달에 쓴 API 사용량 알려줘", "negative", "current user usage state"),
            ("unsafe_or_unknown", "사용자 식별 값이 포함된 사용량 로그를 그대로 요약해줘", "negative", "personal log detail request"),
        ],
    },
    {
        "slug": "deployment_status",
        "split": "test",
        "rows": [
            ("cacheable_static", "blue green deployment와 rolling deployment의 차이를 설명해줘", "positive", "static deployment concept"),
            ("cacheable_policy", "deployment policy v1에서 rollback 조건을 설명해줘", "positive", "versioned deployment policy"),
            ("dynamic_user_state", "지금 production 배포 상태 확인해줘", "negative", "live deployment state"),
            ("unsafe_or_unknown", "환경 boundary 없이 이전 배포 상태 답변을 재사용해줘", "negative", "missing environment boundary"),
        ],
    },
    {
        "slug": "inventory_availability",
        "split": "train",
        "rows": [
            ("cacheable_static", "재고 수량과 예약 재고의 차이를 설명해줘", "positive", "static inventory concept"),
            ("cacheable_policy", "inventory policy v1에서 stock refresh 기준을 설명해줘", "positive", "versioned inventory policy"),
            ("dynamic_user_state", "지금 이 상품 재고 남아 있어?", "negative", "live inventory state"),
            ("unsafe_or_unknown", "상품과 지역 boundary 없이 재고 답변을 캐시에서 가져와줘", "negative", "missing product boundary"),
        ],
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def render(template: str, values: dict[str, str]) -> str:
    return template.format(**values)


def build_record(
    record_id: int,
    label: str,
    text: str,
    lang: str,
    pair_group: str,
    pair_role: str,
    split: str,
    notes: str,
) -> dict[str, Any]:
    return {
        "id": f"scclf-synth-v3-{record_id:04d}",
        "label": label,
        "text": text,
        "lang": lang,
        "source": SOURCE,
        "pairGroup": pair_group,
        "pairRole": pair_role,
        "split": split,
        "notes": notes,
    }


def with_variant(text: str, variant: dict[str, str]) -> str:
    return f"{text}. {variant['suffix']}"


def append_record_group(
    records: list[dict[str, Any]],
    record_id: int,
    pair_group: str,
    split: str,
    rows: list[tuple[str, str, str, str]],
    lang: str,
) -> int:
    for label, text, pair_role, notes in rows:
        records.append(build_record(record_id, label, text, lang, pair_group, pair_role, split, notes))
        record_id += 1
    return record_id


def generate_records() -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    record_id = 1

    for group in MANUAL_PROMPT_GROUPS:
        record_id = append_record_group(
            records,
            record_id,
            f"manual_{group['slug']}",
            group["split"],
            group["rows"],
            "ko-en",
        )

    for group in CONTRAST_PROMPT_GROUPS:
        record_id = append_record_group(
            records,
            record_id,
            f"contrast_{group['slug']}",
            group["split"],
            group["rows"],
            "ko-en",
        )

    for domain_index, domain in enumerate(DOMAINS):
        for pattern_index, pattern in enumerate(DOMAIN_CONTRAST_PATTERNS):
            split = "test" if (domain_index + pattern_index) % 5 == 0 else "train"
            pair_group = f"domain_contrast_{domain['slug']}_{pattern['slug']}"
            rows = [
                (
                    "cacheable_static",
                    render(pattern["static"], domain),
                    "positive",
                    pattern["static_note"],
                ),
                (
                    "cacheable_policy",
                    render(pattern["policy"], domain),
                    "positive",
                    pattern["policy_note"],
                ),
                (
                    "dynamic_user_state",
                    render(pattern["dynamic"], domain),
                    "negative",
                    pattern["dynamic_note"],
                ),
                (
                    "unsafe_or_unknown",
                    render(pattern["unsafe"], domain),
                    "negative",
                    pattern["unsafe_note"],
                ),
            ]
            record_id = append_record_group(records, record_id, pair_group, split, rows, "ko-en")

    for group in HARD_PROMPT_GROUPS:
        pair_group = f"hard_{group['slug']}"
        record_id = append_record_group(
            records,
            record_id,
            pair_group,
            group["split"],
            group["rows"],
            "ko-en",
        )

    generated_group_index = 0
    for domain_index, domain in enumerate(DOMAINS):
        for aspect_index, aspect in enumerate(ASPECTS):
            for variant in SURFACE_VARIANTS:
                if len(records) >= TARGET_PER_LABEL * 4:
                    return records
                split = "test" if generated_group_index % 4 == 0 else "train"
                pair_group = f"{domain['slug']}_{aspect['slug']}_{variant['slug']}"
                rows = [
                    (
                        "cacheable_static",
                        with_variant(render(aspect["static"], domain), variant),
                        "positive",
                        f"{aspect['static_note']}; {variant['notes']}",
                    ),
                    (
                        "cacheable_policy",
                        with_variant(render(aspect["policy"], domain), variant),
                        "positive",
                        f"{aspect['policy_note']}; {variant['notes']}",
                    ),
                    (
                        "dynamic_user_state",
                        with_variant(render(aspect["dynamic"], domain), variant),
                        "negative",
                        f"{aspect['dynamic_note']}; {variant['notes']}",
                    ),
                    (
                        "unsafe_or_unknown",
                        with_variant(render(aspect["unsafe"], domain), variant),
                        "negative",
                        f"{aspect['unsafe_note']}; {variant['notes']}",
                    ),
                ]
                record_id = append_record_group(
                    records,
                    record_id,
                    pair_group,
                    split,
                    rows,
                    "ko-en",
                )
                generated_group_index += 1

    return records


def main() -> int:
    args = parse_args()
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    records = generate_records()
    lines = [json.dumps(record, ensure_ascii=False, separators=(",", ":")) for record in records]
    with output.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")
    print(json.dumps({"output": str(output), "records": len(records)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
