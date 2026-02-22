import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

import src.main as main


class FixedClock:
    def __init__(self, start: dt.datetime):
        self.current = start

    def now(self) -> dt.datetime:
        return self.current

    def advance(self, *, seconds: int = 0, minutes: int = 0):
        self.current = self.current + dt.timedelta(seconds=seconds, minutes=minutes)


class IncidentLoggingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.db = main.Db(self.base / "state.db")
        self.clock = FixedClock(dt.datetime(2026, 2, 22, 12, 0, 0))
        self.manager = main.IncidentManager(
            self.db,
            self.base / "logs" / "incidents",
            window_minutes=15,
            reset_minutes=30,
            level_l1=3,
            level_l2=5,
            level_l3=8,
            now_provider=self.clock.now,
        )

    def tearDown(self):
        self.tmp.cleanup()

    def register_once(self, *, message: str = "PHPhotosErrorDomain error 3164", stack: str = "Traceback: launchImageLibraryAsync"):
        result = self.manager.register(
            error_type="PHPhotosErrorDomain",
            message=message,
            stack=stack,
            context={
                "stage": "picker",
                "event": "picker_attempt_failed",
                "platform": "ios",
                "source": "gallery_preserve",
                "reason": message,
                "request_id": "req-123",
                "run_id": "run-123",
            },
            stage="client_picker",
            event="picker_attempt_failed",
            trace_id="trace_abc",
            request_id="req-123",
            run_id="run-123",
        )
        self.clock.advance(seconds=5)
        return result

    def test_counting_uses_15_minute_window(self):
        self.register_once()
        self.register_once()
        third = self.register_once()
        self.assertEqual(third["incident_count_15m"], 3)
        self.assertEqual(third["incident_level"], 1)

        self.clock.advance(minutes=16)
        after_window = self.register_once()
        self.assertEqual(after_window["incident_count_15m"], 1)
        self.assertEqual(after_window["incident_level"], 0)

    def test_level_transitions_l0_l1_l2_l3(self):
        levels = [self.register_once()["incident_level"] for _ in range(8)]
        self.assertEqual(levels[0], 0)
        self.assertEqual(levels[1], 0)
        self.assertEqual(levels[2], 1)
        self.assertEqual(levels[4], 2)
        self.assertEqual(levels[7], 3)

    def test_generates_markdown_report_only_at_l2_or_higher(self):
        for _ in range(4):
            out = self.register_once()
            self.assertIsNone(out["report_path"])

        l2 = self.register_once()
        self.assertIsNotNone(l2["report_path"])
        report_path = Path(str(l2["report_path"]))
        self.assertTrue(report_path.exists())

        contents = report_path.read_text(encoding="utf-8")
        self.assertIn("- horario:", contents)
        self.assertIn("- fingerprint:", contents)
        self.assertIn("- frequencia:", contents)
        self.assertIn("- impacto:", contents)
        self.assertIn("- hipotese:", contents)
        self.assertIn("- tentativas feitas:", contents)
        self.assertIn("- proximos passos:", contents)
        self.assertIn("- status:", contents)

    def test_resets_to_l0_after_30_minutes_without_repeat(self):
        for _ in range(3):
            self.register_once()

        self.clock.advance(minutes=31)
        state = self.manager.tail(limit=10)
        self.assertEqual(len(state), 1)
        self.assertEqual(state[0]["level"], 0)
        self.assertEqual(state[0]["count_15m"], 0)
        self.assertEqual(state[0]["incident_reset_applied"], True)

        after_reset = self.register_once()
        self.assertEqual(after_reset["incident_level"], 0)
        self.assertEqual(after_reset["incident_count_15m"], 1)
        self.assertEqual(after_reset["incident_reset_applied"], True)

    def test_redaction_applies_before_persist(self):
        secret_message = "Bearer abc123xyz sk-SECRETKEY1234567890"
        self.manager.register(
            error_type="RuntimeError",
            message=secret_message,
            stack="stack with token=abc",
            context={
                "authorization": "Bearer abcd",
                "api_key": "sk-AAAAAAAAAAAAAAAA",
                "token": "top-secret",
                "cookie": "session=abcd",
                "nested": {"password": "123", "safe": "ok"},
            },
            stage="client_picker",
            event="picker_attempt_failed",
            trace_id="trace_sensitive",
            request_id="req-sensitive",
            run_id="run-sensitive",
        )

        row = self.db.fetchone("select message, context_json from incident_events order by id desc limit 1")
        self.assertIsNotNone(row)
        self.assertNotIn("abc123xyz", row["message"])
        self.assertNotIn("sk-SECRETKEY1234567890", row["message"])

        context_json = json.loads(row["context_json"])
        self.assertEqual(context_json["authorization"], "***")
        self.assertEqual(context_json["api_key"], "***")
        self.assertEqual(context_json["token"], "***")
        self.assertEqual(context_json["cookie"], "***")
        self.assertEqual(context_json["nested"]["password"], "***")
        self.assertEqual(context_json["nested"]["safe"], "ok")


if __name__ == "__main__":
    unittest.main()
