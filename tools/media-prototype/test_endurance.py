import asyncio
import contextlib
import io
import json
import tempfile
import time
import unittest
from pathlib import Path
from engine import Processor
from endurance import validate_duration, assess


class EnduranceTests(unittest.TestCase):
    def test_rejects_expired_credentials_and_unbounded_runs(self):
        for seconds in (59, 9001):
            with self.assertRaises(ValueError):
                validate_duration({"expires": time.time() + 20000}, seconds)
        with self.assertRaises(ValueError):
            validate_duration({"expires": time.time() + 9010}, 9000)
        validate_duration({"expires": time.time() + 10000}, 9000)

    def test_web_default_cannot_run_for_hours(self):
        with self.assertRaises(ValueError):
            asyncio.run(Processor({}, tempfile.mkdtemp()).run(seconds=9000))

    def test_saved_metrics_exclude_credentials_and_elapsed_freezes(self):
        folder = Path(tempfile.mkdtemp())
        p = Processor({"subscriber": "DO_NOT_EXPOSE", "url": "SECRET_URL"}, folder)
        p.started = time.monotonic() - 40
        p.finished_at = p.started + 30
        p.state = "stopped"
        (folder / "progress.txt").write_text(
            "frame=1700\ndrop_frames=2\ndup_frames=4\n"
        )
        with contextlib.redirect_stdout(io.StringIO()) as stdout:
            p.record_sample()
        serialized = (
            json.dumps(p.report())
            + stdout.getvalue()
            + (folder / "samples.jsonl").read_text()
        )
        self.assertNotIn("DO_NOT_EXPOSE", serialized)
        self.assertNotIn("SECRET_URL", serialized)
        self.assertEqual(p.status()["elapsed"], 30)
        self.assertEqual(p.status()["encoderDroppedFrames"], 2)

    def test_reconnect_and_pace_are_required_for_pass(self):
        def sample(home, elapsed):
            return {
                "elapsed": elapsed,
                "encodedFps": 60,
                "memoryBytes": 100,
                "cameras": {"home": {"connected": home}, "away": {"connected": True}},
            }

        report = {
            "summary": {
                "elapsed": 90,
                "state": "stopped",
                "error": None,
                "score": "Team Red 3 - 1 Team Blue",
            },
            "samples": [sample(True, 20), sample(False, 40), sample(True, 60)],
        }
        self.assertTrue(assess(report, 90)["passed"])
        report["samples"][-1]["encodedFps"] = 40
        self.assertFalse(assess(report, 90)["passed"])
        report["samples"] = [sample(True, 60)]
        self.assertFalse(assess(report, 90)["checks"]["reconnectObserved"])


if __name__ == "__main__":
    unittest.main()
