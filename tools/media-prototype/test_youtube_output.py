import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from youtube_output import YouTubeOutput, validate_destination, relay_command


class OutputTests(unittest.TestCase):
    def test_destination_is_restricted_and_errors_do_not_echo_keys(self):
        good = "rtmps://a.rtmps.youtube.com:443/live2/private-test-key"
        self.assertEqual(validate_destination(good), good)
        for bad in (
            None,
            42,
            "rtmp://a.rtmp.youtube.com/live2/private-test-key",
            "rtmps://127.0.0.1/live2/private-test-key",
            good + "?key=private-test-key",
            good.replace(":443", ":1234"),
            good.replace("youtube.com", "youtube.com.attacker.test"),
            good.replace("/live2/", "/../"),
            good + "\nsecret",
        ):
            with self.assertRaisesRegex(ValueError, "^invalid_youtube_destination$"):
                validate_destination(bad)

    def test_copy_relay_does_not_encode_again(self):
        command = relay_command(Path("/tmp"), "test")
        self.assertEqual(command[command.index("-c") + 1], "copy")
        self.assertNotIn("h264_nvenc", command)

    def test_start_errors_are_fixed_and_stop_is_idempotent(self):
        async def scenario():
            folder = Path(tempfile.mkdtemp())
            (folder / "program.m3u8").write_text("#EXTM3U")
            output = YouTubeOutput(
                folder, "rtmps://a.rtmps.youtube.com/live2/private-test-key"
            )
            with patch(
                "asyncio.create_subprocess_exec",
                AsyncMock(side_effect=RuntimeError("private-test-key")),
            ):
                status = await output.start()
            self.assertEqual(status["error"], "youtube_delivery_start_failed")
            self.assertNotIn("private-test-key", str(status))
            self.assertFalse(status["youtubeLiveConfirmed"])
            self.assertEqual((await output.stop())["state"], "stopped")
            self.assertEqual((await output.stop())["state"], "stopped")

        asyncio.run(scenario())
