"""Stage-separated CLI for the four-feature LightGBM tuning bridge."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from .lightgbm_dimension_tuning_bridge import (
    evaluate_test,
    freeze_selection,
    load_bridge_config,
    prepare_inputs,
    render_final_report,
    run_tuning,
)
from .lightgbm_embedding_experiment import ExperimentError


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run the family-disjoint 70/15/15 LightGBM comparison for the "
            "106D, 54D, 768D, and 810D feature candidates."
        )
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare = subparsers.add_parser("prepare-inputs")
    prepare.add_argument("--config", type=Path, required=True)
    prepare.add_argument("--go", default="go")
    tune = subparsers.add_parser("tune")
    tune.add_argument("--config", type=Path, required=True)
    tune.add_argument("--execution-approval-reference", required=True)
    freeze = subparsers.add_parser("freeze")
    freeze.add_argument("--config", type=Path, required=True)
    freeze.add_argument("--owner-decision-reference", required=True)
    freeze.add_argument("--owner-decision-timestamp", required=True)
    evaluate = subparsers.add_parser("evaluate-test")
    evaluate.add_argument("--config", type=Path, required=True)
    evaluate.add_argument("--authorization-reference", required=True)
    evaluate.add_argument("--authorization-timestamp", required=True)
    report = subparsers.add_parser("render-report")
    report.add_argument("--config", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        config = load_bridge_config(args.config)
        if args.command == "prepare-inputs":
            prepare_inputs(config, go_executable=args.go)
        elif args.command == "tune":
            run_tuning(
                config,
                execution_approval_reference=args.execution_approval_reference,
            )
        elif args.command == "freeze":
            freeze_selection(
                config,
                owner_decision_reference=args.owner_decision_reference,
                owner_decision_timestamp=args.owner_decision_timestamp,
            )
        elif args.command == "evaluate-test":
            evaluate_test(
                config,
                authorization_reference=args.authorization_reference,
                authorization_timestamp=args.authorization_timestamp,
            )
        elif args.command == "render-report":
            render_final_report(config)
        else:  # pragma: no cover - argparse enforces the command set.
            raise ValueError("unsupported command")
    except (ExperimentError, KeyError, OSError, TypeError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(f"{args.command} completed for {config.value['experimentId']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
