from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app.main import run


class AiServiceLauncherConfigTests(unittest.TestCase):
    def test_launcher_passes_access_log_setting_to_uvicorn(self) -> None:
        env = {
            "AI_SERVICE_HOST": "127.0.0.9",
            "AI_SERVICE_PORT": "8011",
            "AI_SERVICE_LOG_LEVEL": "debug",
            "AI_SERVICE_ACCESS_LOG_ENABLED": "true",
        }
        with patch.dict(os.environ, env), patch("uvicorn.run") as uvicorn_run:
            run()

        uvicorn_run.assert_called_once()
        self.assertEqual(uvicorn_run.call_args.kwargs["host"], "127.0.0.9")
        self.assertEqual(uvicorn_run.call_args.kwargs["port"], 8011)
        self.assertEqual(uvicorn_run.call_args.kwargs["log_level"], "debug")
        self.assertTrue(uvicorn_run.call_args.kwargs["access_log"])


if __name__ == "__main__":
    unittest.main()
