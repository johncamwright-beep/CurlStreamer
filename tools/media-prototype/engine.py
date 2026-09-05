"""Isolated video-only real-camera bridge. No production game writes or Egress."""

import asyncio
import contextlib
import json
import os
import time
from collections import deque
from pathlib import Path

from livekit import rtc
from PIL import Image, ImageOps

WIDTH, HEIGHT, FPS = 432, 768, 30
STALE_SECONDS = 3
PROFILES = {
    "720p60": {
        "width": 1280,
        "height": 720,
        "fps": 60,
        "camera_width": 288,
        "camera_height": 512,
        "bitrate": "6M",
    },
    "1080p30": {
        "width": 1920,
        "height": 1080,
        "fps": 30,
        "camera_width": 432,
        "camera_height": 768,
        "bitrate": "8M",
    },
}


def contain_frame(data, width, height, rotation=0, target=(WIDTH, HEIGHT)):
    image = Image.frombytes("RGBA", (width, height), bytes(data)).convert("RGB")
    if rotation:
        image = image.rotate(-rotation, expand=True)
    image = ImageOps.contain(image, target, Image.Resampling.BILINEAR)
    canvas = Image.new("RGB", target, "#17212f")
    canvas.paste(
        image, ((target[0] - image.width) // 2, (target[1] - image.height) // 2)
    )
    return canvas.tobytes()


def encoder_command(folder, descriptors, gpu=True, profile="720p60"):
    p = PROFILES[profile]
    scale = p["width"] / 1920
    left, right, top = (round(v * scale) for v in (224, 1264, 180))
    args = [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-y",
        "-loglevel",
        "error",
        "-filter_complex_threads",
        "1",
        "-progress",
        str(folder / "progress.txt"),
    ]
    for descriptor in descriptors:
        args += [
            "-thread_queue_size",
            "2",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-video_size",
            f"{p['camera_width']}x{p['camera_height']}",
            "-framerate",
            str(p["fps"]),
            "-i",
            f"pipe:{descriptor}",
        ]
    args += [
        "-f",
        "lavfi",
        "-i",
        f"color=c=0x071321:s={p['width']}x{p['height']}:r={p['fps']}",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=48000:cl=stereo",
    ]
    text = (
        "[2:v]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:"
        f"textfile=score.txt:reload=1:expansion=none:fontsize={round(42*scale)}:fontcolor=white:x={round(80*scale)}:y={round(65*scale)},"
    )
    text += (
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:"
        f"text='CAMERA PROTOTYPE - SILENT AUDIO':fontsize={round(30*scale)}:fontcolor=white:x={round(80*scale)}:y={round(1000*scale)}"
    )
    if gpu:
        graph = (
            text + ",format=nv12,hwupload_cuda[base];"
            "[0:v]format=nv12,hwupload_cuda[left];[1:v]format=nv12,hwupload_cuda[right];"
            f"[base][left]overlay_cuda=x={left}:y={top}[mid];[mid][right]overlay_cuda=x={right}:y={top}[v]"
        )
        codec = [
            "-c:v",
            "h264_nvenc",
            "-preset",
            "p4",
            "-tune",
            "ll",
            "-rc",
            "cbr",
            "-b:v",
            p["bitrate"],
            "-maxrate",
            p["bitrate"],
            "-bufsize",
            "16M",
        ]
    else:
        graph = (
            text + f"[base];[base][0:v]overlay=x={left}:y={top}[mid];"
            f"[mid][1:v]overlay=x={right}:y={top},format=yuv420p[v]"
        )
        codec = ["-c:v", "libx264", "-preset", "ultrafast", "-b:v", "8M"]
    return (
        args
        + ["-filter_complex", graph, "-map", "[v]", "-map", "3:a"]
        + codec
        + [
            "-g",
            str(p["fps"] * 2),
            "-bf",
            "0",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-f",
            "hls",
            "-hls_time",
            "2",
            "-hls_list_size",
            "6",
            "-hls_flags",
            "delete_segments+independent_segments+temp_file",
            "-hls_segment_filename",
            "segment%05d.ts",
            "program.m3u8",
        ]
    )


class Processor:
    def __init__(self, config, folder, profile="720p60"):
        self.config, self.folder = config, Path(folder)
        self.profile = profile
        self.settings = PROFILES[profile]
        self.size = (self.settings["camera_width"], self.settings["camera_height"])
        self.fps = self.settings["fps"]
        self.room = None
        self.process = None
        self.tasks = set()
        self.consume_tasks = {}
        self.latest = {}
        self.received = {"home": 0, "away": 0}
        self.arrivals = {"home": deque(maxlen=240), "away": deque(maxlen=240)}
        self.state = "idle"
        self.error = None
        self.started = 0
        self.stop_event = asyncio.Event()
        self.blank = Image.new("RGB", self.size, "#17212f").tobytes()
        self.deadline_seconds = 600
        self.score = "Team Red 0 - 0 Team Blue"
        self.finished_frames = None
        self.finished_at = None
        self.samples = []
        self.run_id = self.folder.name

    def update_score(self, home, away):
        self.score = f"Team Red {home} - {away} Team Blue"
        self.folder.mkdir(parents=True, exist_ok=True)
        temp = self.folder / "score.next"
        temp.write_text(self.score, encoding="utf-8")
        temp.replace(self.folder / "score.txt")

    def status(self):
        now = time.monotonic()
        frames = self.finished_frames
        values = {}
        try:
            values = dict(
                line.split("=", 1)
                for line in (self.folder / "progress.txt").read_text().splitlines()
                if "=" in line
            )
            frames = int(values.get("frame", "0"))
        except (OSError, ValueError):
            pass
        return {
            "runId": self.run_id,
            "state": self.state,
            "error": self.error,
            "frames": frames,
            "profile": self.profile,
            "targetFps": self.fps,
            "elapsed": (
                round((self.finished_at or now) - self.started) if self.started else 0
            ),
            "encoderDroppedFrames": (
                int(values["drop_frames"]) if "drop_frames" in values else None
            ),
            "encoderDuplicatedFrames": (
                int(values["dup_frames"]) if "dup_frames" in values else None
            ),
            "limitSeconds": self.deadline_seconds,
            "score": self.score,
            "cameras": {
                role: {
                    "framesReceived": self.received[role],
                    "receivedFps": self.received_fps(role, now),
                    "connected": role in self.latest
                    and now - self.latest[role][0] < STALE_SECONDS,
                }
                for role in ("home", "away")
            },
            "previewReady": (self.folder / "program.m3u8").exists(),
        }

    def received_fps(self, role, now):
        if self.state not in ("starting", "running"):
            return 0
        samples = [stamp for stamp in self.arrivals[role] if now - stamp <= 2]
        return (
            round((len(samples) - 1) / (samples[-1] - samples[0]), 1)
            if len(samples) > 1 and samples[-1] > samples[0]
            else 0
        )

    async def consume(self, track, role):
        stream = rtc.VideoStream(track, format=rtc.VideoBufferType.RGBA, capacity=1)
        try:
            async for event in stream:
                if self.stop_event.is_set():
                    break
                frame = event.frame
                if frame.width * frame.height > 3840 * 2160:
                    continue
                # SDK rotation values use quarter-turns in the protobuf enum.
                rotation = {0: 0, 1: 90, 2: 180, 3: 270}.get(int(event.rotation), 0)
                data = await asyncio.to_thread(
                    contain_frame,
                    frame.data,
                    frame.width,
                    frame.height,
                    rotation,
                    self.size,
                )
                self.latest[role] = (time.monotonic(), data)
                self.received[role] += 1
                self.arrivals[role].append(time.monotonic())
        finally:
            await stream.aclose()

    async def feed(self, writer, role):
        deadline = time.monotonic()
        try:
            while not self.stop_event.is_set():
                now = time.monotonic()
                seen, data = self.latest.get(role, (0, self.blank))
                writer.write(data if now - seen < STALE_SECONDS else self.blank)
                await asyncio.wait_for(writer.drain(), timeout=5)
                deadline += 1 / self.fps
                if deadline < time.monotonic() - 0.1:
                    deadline = time.monotonic()
                await asyncio.sleep(max(0, deadline - time.monotonic()))
        finally:
            writer.close()

    def record_sample(self):
        """Allowlisted metrics only: never config, provider exceptions or encoder logs."""
        import psutil

        sample = self.status()
        sample["sampledAt"] = time.time()
        processes = [psutil.Process()]
        if self.process and self.process.returncode is None:
            with contextlib.suppress(psutil.Error):
                processes.append(psutil.Process(self.process.pid))
        sample["memoryBytes"] = 0
        for process in processes:
            with contextlib.suppress(psutil.Error):
                sample["memoryBytes"] += process.memory_info().rss
        if self.samples:
            previous = self.samples[-1]
            elapsed = sample["sampledAt"] - previous["sampledAt"]
            sample["encodedFps"] = (
                round(
                    ((sample["frames"] or 0) - (previous["frames"] or 0)) / elapsed, 2
                )
                if elapsed > 0
                else None
            )
        else:
            sample["encodedFps"] = None
        self.samples.append(sample)
        with (self.folder / "samples.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(sample) + "\n")
        print("PROTOTYPE_METRIC " + json.dumps(sample), flush=True)
        return sample

    def report(self):
        return {"summary": self.status(), "samples": self.samples}

    async def run(self, synthetic=False, seconds=600, *, max_seconds=600):
        # Only the separate, server-side endurance runner raises this ceiling.
        if not 5 <= seconds <= max_seconds <= 9300:
            raise ValueError("invalid_test_duration")
        self.deadline_seconds = seconds
        self.state = "starting"
        self.started = time.monotonic()
        self.update_score(0, 0)
        pipes = [os.pipe(), os.pipe()]
        log = open(self.folder / "encoder.log", "wb")
        try:
            self.process = await asyncio.create_subprocess_exec(
                *encoder_command(
                    self.folder, [p[0] for p in pipes], profile=self.profile
                ),
                cwd=self.folder,
                pass_fds=tuple(p[0] for p in pipes),
                stderr=log,
                stdout=asyncio.subprocess.DEVNULL,
            )
            loop = asyncio.get_running_loop()
            for role, (read_fd, write_fd) in zip(("home", "away"), pipes):
                os.close(read_fd)
                transport, protocol = await loop.connect_write_pipe(
                    asyncio.streams.FlowControlMixin,
                    os.fdopen(write_fd, "wb", buffering=0),
                )
                writer = asyncio.StreamWriter(transport, protocol, None, loop)
                self.tasks.add(asyncio.create_task(self.feed(writer, role)))
            if synthetic:
                self.tasks.add(asyncio.create_task(self.synthetic()))
            else:
                self.room = rtc.Room()

                @self.room.on("track_subscribed")
                def subscribed(track, publication, participant):
                    role = {"prototype-home": "home", "prototype-away": "away"}.get(
                        participant.identity
                    )
                    if role and track.kind == rtc.TrackKind.KIND_VIDEO:
                        previous = self.consume_tasks.get(role)
                        if previous:
                            previous.cancel()
                        task = asyncio.create_task(self.consume(track, role))
                        self.consume_tasks[role] = task
                        self.tasks.add(task)

                await asyncio.wait_for(
                    self.room.connect(self.config["url"], self.config["subscriber"]), 20
                )
            self.state = "running"
            next_sample = 0
            while (
                not self.stop_event.is_set()
                and time.monotonic() - self.started < self.deadline_seconds
            ):
                if self.config.get("expires") and time.time() >= self.config["expires"]:
                    break
                if self.process.returncode is not None:
                    raise RuntimeError("encoder_stopped")
                for task in self.tasks:
                    if task.done() and not task.cancelled() and task.exception():
                        raise RuntimeError("camera_pipeline_failed")
                if time.monotonic() >= next_sample:
                    self.record_sample()
                    next_sample = time.monotonic() + 10
                await asyncio.sleep(0.25)
            self.state = "stopping"
        except asyncio.CancelledError:
            self.state = "stopping"
            raise
        except Exception:
            # Provider exceptions can contain bearer credentials; expose only a fixed category.
            self.error = (
                "The camera processor stopped. End the test and start a new session."
            )
            self.state = "failed"
        finally:
            self.stop_event.set()
            for task in self.tasks:
                task.cancel()
            await asyncio.gather(*self.tasks, return_exceptions=True)
            if self.room:
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(self.room.disconnect(), 5)
            if self.process and self.process.returncode is None:
                self.process.terminate()
                try:
                    await asyncio.wait_for(self.process.wait(), 5)
                except asyncio.TimeoutError:
                    self.process.kill()
                    await self.process.wait()
            log.close()
            self.latest.clear()
            self.finished_at = time.monotonic()
            if self.state != "failed":
                self.state = "stopped"
            (self.folder / "result.json").write_text(
                json.dumps(self.report(), indent=2)
            )
            print("PROTOTYPE_RESULT " + json.dumps(self.status()), flush=True)

    async def synthetic(self):
        frame = 0
        while not self.stop_event.is_set():
            for role, color in (
                ("home", (180, 40, frame % 255)),
                ("away", (40, frame % 255, 180)),
            ):
                image = Image.new("RGB", self.size, color)
                self.latest[role] = (time.monotonic(), image.tobytes())
                self.received[role] += 1
                self.arrivals[role].append(time.monotonic())
            frame += 1
            await asyncio.sleep(1 / self.fps)
