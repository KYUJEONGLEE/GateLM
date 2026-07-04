#!/usr/bin/env python3
"""Generate the synthetic cacheability classifier dataset."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT = BASE_DIR / "data" / "cacheability_synthetic_v2.jsonl"
SOURCE = "synthetic_v2"

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
        "id": f"scclf-synth-v2-{record_id:04d}",
        "label": label,
        "text": text,
        "lang": lang,
        "source": SOURCE,
        "pairGroup": pair_group,
        "pairRole": pair_role,
        "split": split,
        "notes": notes,
    }


def generate_records() -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    record_id = 1

    for domain_index, domain in enumerate(DOMAINS):
        lang = "ko-en" if any(ch.isascii() and ch.isalpha() for ch in domain["topic_en"]) else "ko"
        for aspect_index, aspect in enumerate(ASPECTS):
            split = "test" if (domain_index + aspect_index) % 4 == 0 else "train"
            pair_group = f"{domain['slug']}_{aspect['slug']}"
            rows = [
                (
                    "cacheable_static",
                    render(aspect["static"], domain),
                    "positive",
                    aspect["static_note"],
                ),
                (
                    "cacheable_policy",
                    render(aspect["policy"], domain),
                    "positive",
                    aspect["policy_note"],
                ),
                (
                    "dynamic_user_state",
                    render(aspect["dynamic"], domain),
                    "negative",
                    aspect["dynamic_note"],
                ),
                (
                    "unsafe_or_unknown",
                    render(aspect["unsafe"], domain),
                    "negative",
                    aspect["unsafe_note"],
                ),
            ]

            for label, text, pair_role, notes in rows:
                records.append(build_record(record_id, label, text, lang, pair_group, pair_role, split, notes))
                record_id += 1

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
