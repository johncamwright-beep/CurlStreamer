"""Bounded synthetic publishers and evidence checks for the real WebRTC path."""

import asyncio
import contextlib
import json
import logging
import time
from pathlib import Path

from livekit import rtc
from PIL import Image, ImageDraw


def validate_duration(config, seconds):
    if not isinstance(seconds, int) or not 60 <= seconds <= 9000:
        raise ValueError("duration_must_be_60_to_9000_seconds")
    if config.get("expires", 0) < time.time() + seconds + 180:
        raise ValueError("test_credentials_expire_too_soon")


async def publish_camera(config, role, deadline, counters):
    room = rtc.Room()
    try:
        await asyncio.wait_for(
            room.connect(
                config["url"], config[role], rtc.RoomOptions(auto_subscribe=False)
            ),
            25,
        )
        source = rtc.VideoSource(720, 1280)
        track = rtc.LocalVideoTrack.create_video_track("synthetic-camera", source)
        await room.local_participant.publish_track(
            track,
            rtc.TrackPublishOptions(
                source=rtc.TrackSource.SOURCE_CAMERA,
                video_codec=rtc.VideoCodec.H264,
                simulcast=False,
                video_encoding=rtc.VideoEncoding(max_bitrate=4000000, max_framerate=60),
            ),
        )
        base = Image.new(
            "RGBA", (720, 1280), "#365486" if role == "home" else "#8a3546"
        )
        ImageDraw.Draw(base).text(
            (30, 50), "SYNTHETIC " + role.upper(), fill="white", font_size=35
        )
        tick = time.monotonic()
        n = 0
        while time.monotonic() < deadline:
            frame = base.copy()
            draw = ImageDraw.Draw(frame)
            x, y = (n * 12) % 620, 250 + (n * 3) % 850
            draw.ellipse((x, y, x + 90, y + 90), fill="yellow")
            source.capture_frame(
                rtc.VideoFrame(720, 1280, rtc.VideoBufferType.RGBA, frame.tobytes())
            )
            counters[role] += 1
            n += 1
            tick += 1 / 60
            if tick < time.monotonic() - 0.1:
                tick = time.monotonic()
            await asyncio.sleep(max(0, tick - time.monotonic()))
    finally:
        with contextlib.suppress(Exception):
            await asyncio.wait_for(room.disconnect(), 10)


async def publish_pair(config, seconds):
    logging.disable(logging.CRITICAL)
    started = time.monotonic()
    deadline = started + seconds
    counters = {"home": 0, "away": 0}
    events = []
    tasks = {
        role: asyncio.create_task(publish_camera(config, role, deadline, counters))
        for role in counters
    }
    next_reconnect = started + 30
    next_metric = started + 10
    last_metric = started
    last_counts = dict(counters)
    try:
        while time.monotonic() < deadline:
            if time.monotonic() >= next_metric:
                now = time.monotonic()
                print(
                    "PROTOTYPE_SOURCE "
                    + json.dumps(
                        {
                            "elapsed": round(now - started),
                            "framesPublished": dict(counters),
                            "submittedFps": {
                                role: round(
                                    (counters[role] - last_counts[role])
                                    / (now - last_metric),
                                    1,
                                )
                                for role in counters
                            },
                        }
                    ),
                    flush=True,
                )
                last_metric, last_counts, next_metric = now, dict(counters), now + 10
            for task in tasks.values():
                if task.done() and not task.cancelled() and task.exception():
                    raise RuntimeError("synthetic_publisher_failed")
            if time.monotonic() >= next_reconnect and deadline - time.monotonic() > 25:
                tasks["home"].cancel()
                await asyncio.gather(tasks["home"], return_exceptions=True)
                events.append({"event": "home_disconnected", "at": time.time()})
                print("PROTOTYPE_PUBLISHER " + json.dumps(events[-1]), flush=True)
                await asyncio.sleep(15)
                tasks["home"] = asyncio.create_task(
                    publish_camera(config, "home", deadline, counters)
                )
                events.append({"event": "home_reconnected", "at": time.time()})
                print("PROTOTYPE_PUBLISHER " + json.dumps(events[-1]), flush=True)
                next_reconnect = time.monotonic() + 900
            await asyncio.sleep(0.5)
        return {
            "framesPublished": counters,
            "events": events,
            "elapsed": time.monotonic() - started,
        }
    finally:
        for task in tasks.values():
            task.cancel()
        await asyncio.gather(*tasks.values(), return_exceptions=True)


def assess(report, seconds):
    samples = report["samples"]
    summary = report["summary"]
    both = [s for s in samples if all(c["connected"] for c in s["cameras"].values())]
    stale = [
        i
        for i, s in enumerate(samples)
        if s["elapsed"] > 25
        and not s["cameras"]["home"]["connected"]
        and s["cameras"]["away"]["connected"]
    ]
    recovered = any(
        any(s["cameras"]["home"]["connected"] for s in samples[i + 1 :]) for i in stale
    )
    steady = [
        s["encodedFps"]
        for s in samples
        if s["elapsed"] > 20 and s["encodedFps"] is not None
    ]
    checks = {
        "completedDuration": summary["elapsed"] >= seconds - 2,
        "processorStopped": summary["state"] == "stopped" and summary["error"] is None,
        "bothCamerasReceived": bool(both),
        "reconnectObserved": recovered,
        "scoreUpdated": summary["score"] != "Team Red 0 - 0 Team Blue",
        "encoderKeptPace": bool(steady) and min(steady) >= 54,
    }
    return {
        "checks": checks,
        "passed": all(checks.values()),
        "minimumSampledOutputFps": min(steady) if steady else None,
        "maximumMemoryBytes": max((s["memoryBytes"] for s in samples), default=0),
        "measurement": "Two synthetic 720x1280 cameras over LiveKit into one 720p60 processor; no microphones or YouTube. Not a phone endurance or multi-game density test.",
    }


async def receive(config, folder, seconds):
    from engine import Processor

    processor = Processor(config, folder)
    job = asyncio.create_task(processor.run(seconds=seconds, max_seconds=9300))
    while not job.done():
        await asyncio.sleep(2)
        if processor.state == "running":
            elapsed = int(time.monotonic() - processor.started)
            processor.update_score(1 + (elapsed // 30) % 10, (elapsed // 60) % 10)
    await job
    report = processor.report()
    report["assessment"] = assess(report, seconds)
    (Path(folder) / "result.json").write_text(json.dumps(report, indent=2))
    return report
