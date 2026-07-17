from __future__ import annotations

import os
import tempfile
from pathlib import Path

from app.core.config import LOCAL_DEPLOYMENT_MODES, Settings


RAG_TEMP_FILE_PREFIX = "gatelm-rag-"
RAG_TEMP_FILE_SUFFIX = ".source"


def prepare_rag_temp_directory(settings: Settings) -> Path:
    """Validate the configured directory and remove only stale RAG source files."""

    path = Path(settings.rag_temp_dir)
    production_like = settings.deployment_mode not in LOCAL_DEPLOYMENT_MODES
    if production_like:
        if not path.exists() or path.is_symlink() or not path.is_dir():
            raise ValueError(
                "AI_SERVICE_RAG_TEMP_DIR must be a pre-mounted directory in non-local environments"
            )
    else:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        if path.is_symlink() or not path.is_dir():
            raise ValueError("AI_SERVICE_RAG_TEMP_DIR must be a directory")

    if not os.access(path, os.W_OK | os.X_OK):
        raise ValueError("AI_SERVICE_RAG_TEMP_DIR must be writable")

    system_temp = Path(tempfile.gettempdir()).resolve(strict=False)
    if path.resolve(strict=False) != system_temp:
        _remove_stale_rag_sources(path)
    return path


def _remove_stale_rag_sources(path: Path) -> None:
    for candidate in path.glob(f"{RAG_TEMP_FILE_PREFIX}*{RAG_TEMP_FILE_SUFFIX}"):
        try:
            candidate.unlink()
        except FileNotFoundError:
            continue
        except OSError as exc:
            raise ValueError(
                "AI_SERVICE_RAG_TEMP_DIR contains a stale source that cannot be removed"
            ) from exc
