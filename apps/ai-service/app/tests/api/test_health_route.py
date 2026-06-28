from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from app.core.config import REMOTE_SAFETY_MODE_DISABLED, Settings
from app.main import create_app


class HealthRouteTests(unittest.TestCase):
    def test_healthz_reports_process_alive(self) -> None:
        client = TestClient(create_app(Settings(remote_safety_mode=REMOTE_SAFETY_MODE_DISABLED)))

        response = client.get("/healthz")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertEqual(response.json()["service"], "ai-service")

    def test_readyz_does_not_require_remote_safety(self) -> None:
        client = TestClient(create_app(Settings(remote_safety_mode=REMOTE_SAFETY_MODE_DISABLED)))

        response = client.get("/readyz")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "ready")
        self.assertFalse(body["dependencies"]["remoteSafety"]["required"])
        self.assertEqual(body["dependencies"]["remoteSafety"]["mode"], "disabled")


if __name__ == "__main__":
    unittest.main()
