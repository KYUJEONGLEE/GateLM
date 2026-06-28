from __future__ import annotations

import logging


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=_parse_log_level(level),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def _parse_log_level(level: str) -> int:
    normalized = (level or "INFO").upper()
    return getattr(logging, normalized, logging.INFO)
