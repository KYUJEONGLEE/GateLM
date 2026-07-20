"""Extract only prompt-side KLUE MRC fields from a revision-pinned Parquet cache.

The input and output live below .tmp and are never committed. Install DuckDB in
an isolated environment before running this helper; dataset verification does
not depend on Python or DuckDB.
"""

from __future__ import annotations

import json
from pathlib import Path

import duckdb


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / ".tmp" / "routing-public-sources" / "klue-mrc-train.parquet"
OUTPUT = ROOT / ".tmp" / "routing-public-sources" / "klue-mrc-prompts.jsonl"


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"missing revision-pinned source: {SOURCE}")

    connection = duckdb.connect()
    rows = connection.execute(
        """
        select
          row_number() over () - 1 as row_idx,
          guid,
          question,
          context,
          title,
          source,
          question_type,
          is_impossible
        from read_parquet(?)
        """,
        [str(SOURCE)],
    ).fetchall()

    fields = (
        "row_idx",
        "guid",
        "question",
        "context",
        "title",
        "source",
        "question_type",
        "is_impossible",
    )
    with OUTPUT.open("w", encoding="utf-8", newline="\n") as output:
        for values in rows:
            output.write(json.dumps(dict(zip(fields, values)), ensure_ascii=False, separators=(",", ":")))
            output.write("\n")
    print(f"wrote {len(rows)} prompt-side rows to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
