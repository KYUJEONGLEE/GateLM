#!/usr/bin/env python3
"""Create a CLINC150 cacheability relabeling review packet.

The generated review files may contain CLINC150 utterance text, so they are
written under build/ by default and should not be committed.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parents[1]
DEFAULT_SOURCE_URL = "https://raw.githubusercontent.com/clinc/oos-eval/master/data/data_full.json"
DEFAULT_SOURCE_FILE = REPO_ROOT / ".tmp" / "clinc150" / "data_full.json"
DEFAULT_OUTPUT_DIR = BASE_DIR / "build" / "clinc150_review"

LABELS = {
    "cacheable_static",
    "cacheable_policy",
    "dynamic_user_state",
    "unsafe_or_unknown",
}

STATIC_INTENTS = {
    "are_you_a_bot",
    "calculator",
    "calories",
    "change_accent",
    "definition",
    "do_you_have_pets",
    "food_last",
    "fun_fact",
    "gas_type",
    "goodbye",
    "greeting",
    "how_old_are_you",
    "ingredient_substitution",
    "ingredients_list",
    "jump_start",
    "meaning_of_life",
    "measurement_conversion",
    "mpg",
    "nutrition_info",
    "oil_change_how",
    "recipe",
    "spelling",
    "tell_joke",
    "thank_you",
    "tire_change",
    "translate",
    "vaccines",
    "what_are_your_hobbies",
    "what_can_i_ask_you",
    "what_is_your_name",
    "where_are_you_from",
    "who_do_you_work_for",
    "who_made_you",
    "yes",
    "no",
    "maybe",
    "repeat",
}

POLICY_LIKE_INTENTS = {
    "apr",
    "carry_on",
    "credit_limit",
    "direct_deposit",
    "expiration_date",
    "income",
    "insurance",
    "interest_rate",
    "international_fees",
    "international_visa",
    "min_payment",
    "payday",
    "plug_type",
    "pto_request",
    "replacement_card_duration",
    "rollover_401k",
    "routing",
    "taxes",
    "travel_notification",
    "w2",
}

DYNAMIC_INTENTS = {
    "accept_reservations",
    "account_blocked",
    "application_status",
    "balance",
    "bill_balance",
    "bill_due",
    "calendar",
    "card_declined",
    "credit_score",
    "current_location",
    "date",
    "directions",
    "distance",
    "exchange_rate",
    "find_phone",
    "flight_status",
    "gas",
    "how_busy",
    "last_maintenance",
    "lost_luggage",
    "order_status",
    "pto_balance",
    "pto_request_status",
    "pto_used",
    "restaurant_reviews",
    "restaurant_suggestion",
    "rewards_balance",
    "schedule_maintenance",
    "spending_history",
    "time",
    "timezone",
    "traffic",
    "transactions",
    "travel_alert",
    "travel_suggestion",
    "uber",
    "user_name",
    "weather",
    "what_song",
}

SIDE_EFFECT_OR_BOUNDARY_INTENTS = {
    "alarm",
    "book_flight",
    "book_hotel",
    "cancel",
    "cancel_reservation",
    "car_rental",
    "change_ai_name",
    "change_language",
    "change_speed",
    "change_user_name",
    "change_volume",
    "confirm_reservation",
    "credit_limit_change",
    "damaged_card",
    "flip_coin",
    "freeze_account",
    "insurance_change",
    "make_call",
    "meal_suggestion",
    "meeting_schedule",
    "new_card",
    "next_holiday",
    "next_song",
    "oil_change_when",
    "order",
    "order_checks",
    "pay_bill",
    "pin_change",
    "play_music",
    "redeem_rewards",
    "reminder",
    "reminder_update",
    "report_fraud",
    "report_lost_card",
    "reset_settings",
    "restaurant_reservation",
    "roll_dice",
    "schedule_meeting",
    "share_location",
    "shopping_list",
    "shopping_list_update",
    "smart_home",
    "sync_device",
    "text",
    "timer",
    "tire_pressure",
    "todo_list",
    "todo_list_update",
    "transfer",
    "update_playlist",
    "whisper_mode",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-file", type=Path, default=DEFAULT_SOURCE_FILE)
    parser.add_argument("--source-url", default=DEFAULT_SOURCE_URL)
    parser.add_argument("--download", action="store_true", help="Download CLINC150 data_full.json when source file is missing.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--sample-per-intent", type=int, default=5)
    return parser.parse_args()


def stable_id(text: str, intent: str, split: str) -> str:
    digest = hashlib.sha256(f"{split}\0{intent}\0{text}".encode("utf-8")).hexdigest()
    return f"clinc150-{digest[:16]}"


def stable_sort_key(row: dict[str, Any]) -> str:
    return hashlib.sha256(f"{row['intent']}\0{row['text']}".encode("utf-8")).hexdigest()


def download_if_needed(source_file: Path, source_url: str, should_download: bool) -> None:
    if source_file.exists():
        return
    if not should_download:
        raise SystemExit(f"source file not found: {source_file}. Pass --download to fetch it.")
    source_file.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(source_url, source_file)


def load_rows(source_file: Path) -> list[dict[str, Any]]:
    data = json.loads(source_file.read_text(encoding="utf-8"))
    rows: list[dict[str, Any]] = []
    for split, split_rows in data.items():
        if not isinstance(split_rows, list):
            raise ValueError(f"{split}: expected list rows")
        for index, item in enumerate(split_rows):
            if not isinstance(item, list) or len(item) != 2:
                raise ValueError(f"{split}[{index}]: expected [text, intent]")
            text, intent = item
            if not isinstance(text, str) or not isinstance(intent, str):
                raise ValueError(f"{split}[{index}]: text and intent must be strings")
            rows.append(
                {
                    "id": stable_id(text, intent, split),
                    "source": "clinc150",
                    "sourceSplit": split,
                    "intent": intent,
                    "text": " ".join(text.split()),
                }
            )
    return rows


def suggest_label(intent: str) -> dict[str, str]:
    if intent == "oos":
        return {
            "suggestedLabel": "unsafe_or_unknown",
            "mapConfidence": "medium",
            "reviewStatus": "review_required",
            "reason": "CLINC OOS means outside supported intent, not necessarily cache-unsafe; manual review required.",
        }
    if intent in SIDE_EFFECT_OR_BOUNDARY_INTENTS:
        return {
            "suggestedLabel": "unsafe_or_unknown",
            "mapConfidence": "medium",
            "reviewStatus": "review_required",
            "reason": "Intent can trigger side effects, randomness, personalization, or boundary-sensitive behavior.",
        }
    if intent in DYNAMIC_INTENTS:
        return {
            "suggestedLabel": "dynamic_user_state",
            "mapConfidence": "high",
            "reviewStatus": "review_required",
            "reason": "Intent usually depends on live external data, user state, account state, location, or current time.",
        }
    if intent in POLICY_LIKE_INTENTS:
        return {
            "suggestedLabel": "cacheable_policy",
            "mapConfidence": "medium",
            "reviewStatus": "review_required",
            "reason": "Intent is policy-like, but Gateway store eligibility still needs verified policy/version/hash boundary.",
        }
    if intent in STATIC_INTENTS:
        return {
            "suggestedLabel": "cacheable_static",
            "mapConfidence": "medium",
            "reviewStatus": "review_required",
            "reason": "Intent is generally reusable if the query has no hidden user, time, location, or context dependency.",
        }
    return {
        "suggestedLabel": "unsafe_or_unknown",
        "mapConfidence": "low",
        "reviewStatus": "review_required",
        "reason": "No explicit mapping rule. Fail closed until reviewed.",
    }


def build_intent_map(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_intent: dict[str, Counter[str]] = defaultdict(Counter)
    for row in rows:
        by_intent[row["intent"]][row["sourceSplit"]] += 1

    intent_map: list[dict[str, Any]] = []
    for intent in sorted(by_intent):
        suggestion = suggest_label(intent)
        intent_map.append(
            {
                "intent": intent,
                "counts": dict(sorted(by_intent[intent].items())),
                **suggestion,
            }
        )
    return intent_map


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "id",
        "sourceSplit",
        "intent",
        "text",
        "suggestedLabel",
        "mapConfidence",
        "reason",
        "finalLabel",
        "reviewerNotes",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fields})


def make_review_sample(rows: list[dict[str, Any]], sample_per_intent: int) -> list[dict[str, Any]]:
    by_intent: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_intent[row["intent"]].append(row)

    sample: list[dict[str, Any]] = []
    for intent in sorted(by_intent):
        candidates = sorted(by_intent[intent], key=stable_sort_key)
        sample.extend(candidates[:sample_per_intent])
    return sample


def attach_suggestions(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for row in rows:
        suggestion = suggest_label(row["intent"])
        enriched.append(
            {
                **row,
                **suggestion,
                "finalLabel": "",
                "reviewerNotes": "",
            }
        )
    return enriched


def summarize(rows: list[dict[str, Any]], sample_rows: list[dict[str, Any]], intent_map: list[dict[str, Any]]) -> dict[str, Any]:
    suggested_counts = Counter(row["suggestedLabel"] for row in rows)
    confidence_counts = Counter(row["mapConfidence"] for row in rows)
    split_counts = Counter(row["sourceSplit"] for row in rows)
    intent_counts_by_label: dict[str, int] = Counter(item["suggestedLabel"] for item in intent_map)

    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "name": "CLINC150",
            "file": "data_full.json",
            "url": DEFAULT_SOURCE_URL,
            "licenseNote": "The GitHub repository includes a Creative Commons Attribution 3.0 Unported license; UCI metadata lists CC BY 4.0. Keep attribution and do not commit raw review outputs without approval.",
            "citation": "Larson et al. 2019, An Evaluation Dataset for Intent Classification and Out-of-Scope Prediction.",
        },
        "totalRows": len(rows),
        "intentCount": len(intent_map),
        "reviewSampleRows": len(sample_rows),
        "suggestedLabelCounts": dict(sorted(suggested_counts.items())),
        "intentCountsBySuggestedLabel": dict(sorted(intent_counts_by_label.items())),
        "mapConfidenceCounts": dict(sorted(confidence_counts.items())),
        "sourceSplitCounts": dict(sorted(split_counts.items())),
        "reviewPolicy": "All suggested labels are draft labels and must be manually reviewed before use as training data.",
    }


def main() -> int:
    args = parse_args()
    if args.sample_per_intent < 1:
        raise SystemExit("--sample-per-intent must be at least 1")

    source_file = args.source_file.resolve()
    output_dir = args.output_dir.resolve()
    download_if_needed(source_file, args.source_url, args.download)

    rows = attach_suggestions(load_rows(source_file))
    intent_map = build_intent_map(rows)
    sample_rows = make_review_sample(rows, args.sample_per_intent)
    summary = summarize(rows, sample_rows, intent_map)

    write_json(output_dir / "clinc150_intent_label_map_draft.json", intent_map)
    write_jsonl(output_dir / "cacheability_clinc150_relabel_draft.jsonl", rows)
    write_csv(output_dir / "clinc150_review_sample.csv", sample_rows)
    write_json(output_dir / "clinc150_summary.json", summary)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
