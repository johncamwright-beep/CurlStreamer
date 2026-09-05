"""Explicit, bounded network test using synthetic cameras in the isolated room."""

import argparse
import asyncio
import json
import logging
import time
from pathlib import Path
import httpx
from livekit import rtc
from PIL import Image, ImageDraw


async def main(config_path, url, output):
    logging.disable(logging.CRITICAL)
    config = json.loads(Path(config_path).read_text())
    results = []
    rooms = {}
    tasks = {}
    stop = asyncio.Event()

    async def publisher(role):
        room = rtc.Room()
        rooms[role] = room
        await room.connect(
            config["url"], config[role], rtc.RoomOptions(auto_subscribe=False)
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
        tick = time.monotonic()
        n = 0
        try:
            while not stop.is_set():
                image = Image.new(
                    "RGBA", (720, 1280), "#365486" if role == "home" else "#8a3546"
                )
                draw = ImageDraw.Draw(image)
                draw.text(
                    (30, 50),
                    f"SYNTHETIC {role.upper()}  frame {n}",
                    fill="white",
                    font_size=35,
                )
                x = (n * 12) % 620
                draw.ellipse((x, 500, x + 90, 590), fill="yellow")
                source.capture_frame(
                    rtc.VideoFrame(720, 1280, rtc.VideoBufferType.RGBA, image.tobytes())
                )
                n += 1
                tick += 1 / 60
                if tick < time.monotonic() - 0.1:
                    tick = time.monotonic()
                await asyncio.sleep(max(0, tick - time.monotonic()))
        finally:
            await room.disconnect()

    async with httpx.AsyncClient(
        base_url=url, headers={"Origin": url}, timeout=90
    ) as client:
        response = await client.post("/api/login", json={"code": config["code"]})
        assert response.status_code == 200, f"Login HTTP {response.status_code}"
        response = await client.post("/api/start", json={"profile": "720p60"})
        assert response.status_code == 200, f"Start HTTP {response.status_code}"
        try:
            for _ in range(30):
                status = (await client.get("/api/status")).json()
                if status.get("state") == "running":
                    break
                assert status.get("state") != "failed", "Processor failed to start"
                await asyncio.sleep(1)
            else:
                raise RuntimeError("Processor did not become ready")
            tasks = {
                role: asyncio.create_task(publisher(role)) for role in ("home", "away")
            }
            for step in range(15):
                await asyncio.sleep(3)
                if step == 5:
                    tasks["home"].cancel()
                    await asyncio.gather(tasks["home"], return_exceptions=True)
                if step == 7:
                    tasks["home"] = asyncio.create_task(publisher("home"))
                    await client.post("/api/score", json={"home": 3, "away": 2})
                status = (await client.get("/api/status")).json()
                results.append(status)
                print(
                    json.dumps(
                        {
                            "step": step,
                            "state": status.get("state"),
                            "frames": status.get("frames"),
                            "cameras": status.get("cameras"),
                        }
                    ),
                    flush=True,
                )
                assert (
                    status.get("state") == "running"
                ), "Processor stopped unexpectedly"
                for task in tasks.values():
                    if task.done() and not task.cancelled() and task.exception():
                        raise RuntimeError("Synthetic publisher failed")
            folder = Path(output)
            folder.mkdir(parents=True, exist_ok=True)
            playlist = await client.get("/media/program.m3u8")
            assert playlist.status_code == 200
            (folder / "program.m3u8").write_text(playlist.text)
            for name in playlist.text.splitlines():
                if name and not name.startswith("#"):
                    assert (
                        name.startswith("segment")
                        and name.endswith(".ts")
                        and "/" not in name
                    )
                    segment = await client.get("/media/" + name)
                    assert segment.status_code == 200
                    (folder / name).write_bytes(segment.content)
            assert any(
                all(c["connected"] for c in s["cameras"].values()) for s in results
            ), "Both cameras were never received"
            assert not results[6]["cameras"]["home"][
                "connected"
            ], "Missing camera was not marked stale"
            assert results[-1]["cameras"]["home"]["connected"], "Camera did not recover"
            assert results[-1]["score"] == "Team Red 3 - 2 Team Blue"
        finally:
            stop.set()
            for task in tasks.values():
                task.cancel()
            await asyncio.gather(*tasks.values(), return_exceptions=True)
            stopped = await client.post("/api/stop", json={})
            results.append(stopped.json())
            Path(output).mkdir(parents=True, exist_ok=True)
            (Path(output) / "transport-results.json").write_text(
                json.dumps(results, indent=2)
            )
            assert (
                stopped.status_code == 200 and stopped.json()["state"] == "stopped"
            ), "Stop not confirmed"


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    asyncio.run(main(args.config, args.url, args.output))
