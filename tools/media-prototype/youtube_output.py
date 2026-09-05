"""Server-only copy relay for an already encoded program. Never exposes stream keys.

Sending packets is not proof that YouTube is live; the app must verify the
YouTube broadcast lifecycle separately. Not wired to production or public routes.
"""

import asyncio
import contextlib
import re
import time
from pathlib import Path
from urllib.parse import urlsplit


def validate_destination(value):
    """Accept an API-provided YouTube RTMPS target, never an arbitrary fetch URL."""
    if not isinstance(value, str):
        raise ValueError("invalid_youtube_destination")
    try:
        target = urlsplit(value)
        valid = (
            isinstance(value, str)
            and len(value) < 400
            and not any(
                character.isspace() or ord(character) < 32 for character in value
            )
            and target.scheme == "rtmps"
            and target.hostname in {"a.rtmps.youtube.com", "b.rtmps.youtube.com"}
            and target.port in (None, 443)
            and target.username is None
            and target.password is None
            and not target.query
            and not target.fragment
            and re.fullmatch(r"/live2/[A-Za-z0-9_-]{8,200}", target.path)
        )
    except (TypeError, ValueError):
        valid = False
    if not valid:
        raise ValueError("invalid_youtube_destination")
    return value


def relay_command(folder, destination):
    # This function is private to server code and the local loopback integration test.
    return [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-re",
        "-live_start_index",
        "-2",
        "-i",
        str(Path(folder) / "program.m3u8"),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-c",
        "copy",
        "-progress",
        str(Path(folder) / "relay-progress.txt"),
        "-rw_timeout",
        "15000000",
        "-f",
        "flv",
        "-flvflags",
        "no_duration_filesize",
        destination,
    ]


class YouTubeOutput:
    def __init__(self, folder, destination):
        self.folder = Path(folder)
        self._destination = validate_destination(destination)
        self.process = None
        self.state = "idle"
        self.error = None
        self.lock = asyncio.Lock()
        self.last_progress = 0
        self.last_media_time = 0

    def status(self):
        if self.process and self.state in ("connecting", "sending"):
            if self.process.returncode is not None:
                self.state, self.error = "failed", "youtube_delivery_stopped"
            else:
                with contextlib.suppress(OSError, ValueError):
                    values = dict(
                        line.split("=", 1)
                        for line in (self.folder / "relay-progress.txt")
                        .read_text()
                        .splitlines()
                        if "=" in line
                    )
                    media_time = int(values.get("out_time_us", "0"))
                    if media_time > self.last_media_time:
                        self.last_progress = time.monotonic()
                        self.last_media_time = media_time
                        self.state = "sending"
                if time.monotonic() - self.last_progress > 20:
                    self.state, self.error = "failed", "youtube_delivery_stalled"
        return {"state": self.state, "error": self.error, "youtubeLiveConfirmed": False}

    async def start(self):
        async with self.lock:
            if self.process and self.process.returncode is None:
                return self.status()
            if not (self.folder / "program.m3u8").is_file():
                raise ValueError("program_not_ready")
            self.state, self.error = "connecting", None
            self.last_progress = time.monotonic()
            self.last_media_time = 0
            (self.folder / "relay-progress.txt").unlink(missing_ok=True)
            try:
                self.process = await asyncio.create_subprocess_exec(
                    *relay_command(self.folder, self._destination),
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL
                )
            except Exception:
                self.state, self.error = "failed", "youtube_delivery_start_failed"
            return self.status()

    async def stop(self):
        async with self.lock:
            self.state = "stopping"
            if self.process and self.process.returncode is None:
                self.process.terminate()
                try:
                    await asyncio.wait_for(self.process.wait(), 5)
                except asyncio.TimeoutError:
                    self.process.kill()
                    await self.process.wait()
            self.state = "stopped"
            return self.status()
