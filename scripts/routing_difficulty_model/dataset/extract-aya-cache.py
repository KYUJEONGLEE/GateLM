"""Extract prompt-side Aya fields from the revision-pinned Parquet cache.

The source and output live below .tmp and are never committed. Install DuckDB
in an isolated temporary environment before running this helper. Dataset
verification consumes only the extracted JSONL cache and has no Python runtime
dependency.
"""

from __future__ import annotations

import json
from pathlib import Path

import duckdb


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / ".tmp" / "routing-public-sources" / "aya-train.parquet"
OUTPUT = ROOT / ".tmp" / "routing-public-sources" / "aya-prompts.jsonl"


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"missing revision-pinned source: {SOURCE}")

    connection = duckdb.connect()
    rows = connection.execute(
        """
        select
          row_number() over () - 1 as row_idx,
          inputs,
          language,
          language_code,
          annotation_type
        from read_parquet(?)
        where language_code in ('kor', 'eng')
        """,
        [str(SOURCE)],
    ).fetchall()

    fields = ("row_idx", "inputs", "language", "language_code", "annotation_type")
    with OUTPUT.open("w", encoding="utf-8", newline="\n") as output:
        for values in rows:
            output.write(json.dumps(dict(zip(fields, values)), ensure_ascii=False, separators=(",", ":")))
            output.write("\n")
    print(f"wrote {len(rows)} prompt-side rows to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
