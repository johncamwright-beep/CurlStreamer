"""Exercise HLS-to-RTMP packet copy against a private loopback sink, never YouTube."""

from pathlib import Path
import modal

ROOT = Path(__file__).resolve().parent
app = modal.App("curlstreamer-output-smoke")
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "fonts-dejavu-core")
    .env({"NVIDIA_DRIVER_CAPABILITIES": "compute,video,utility"})
    .pip_install_from_requirements(str(ROOT / "requirements.txt"))
    .add_local_file(str(ROOT / "engine.py"), "/prototype/engine.py")
    .add_local_file(str(ROOT / "youtube_output.py"), "/prototype/youtube_output.py")
)


@app.function(
    image=image, gpu="L4", cpu=4, memory=16384, timeout=120, retries=0, max_containers=1
)
async def smoke():
    import asyncio, json, sys, tempfile

    sys.path.insert(0, "/prototype")
    from engine import Processor
    from youtube_output import relay_command

    folder = Path(tempfile.mkdtemp())
    processor = Processor({}, folder)
    job = asyncio.create_task(processor.run(synthetic=True, seconds=60))
    sink = relay = None
    try:
        for _ in range(35):
            if (folder / "program.m3u8").exists():
                break
            if job.done():
                raise RuntimeError("processor_failed")
            await asyncio.sleep(1)
        else:
            raise RuntimeError("preview_not_ready")
        endpoint = "rtmp://127.0.0.1:19350/live/test-only"
        sink = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-listen",
            "1",
            "-i",
            endpoint,
            "-t",
            "12",
            "-c",
            "copy",
            str(folder / "received.flv"),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.sleep(0.5)
        relay = await asyncio.create_subprocess_exec(
            *relay_command(folder, endpoint),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL
        )
        await asyncio.wait_for(sink.wait(), 35)
        if sink.returncode:
            raise RuntimeError("test_sink_failed")
        probe = await asyncio.create_subprocess_exec(
            "ffprobe",
            "-v",
            "error",
            "-count_frames",
            "-show_streams",
            "-of",
            "json",
            str(folder / "received.flv"),
            stdout=asyncio.subprocess.PIPE,
        )
        out, _ = await probe.communicate()
        streams = json.loads(out)["streams"]
        video = next(s for s in streams if s["codec_type"] == "video")
        audio = next(s for s in streams if s["codec_type"] == "audio")
        assert video["codec_name"] == "h264" and audio["codec_name"] == "aac"
        assert video["width"] == 1280 and video["height"] == 720
        assert int(video["nb_read_frames"]) >= 600
        return json.dumps(
            {
                "passed": True,
                "video": video,
                "audio": audio,
                "scope": "Local RTMP receiver accepted copied 720p60 H264/AAC packets. Not a YouTube or TLS integration test.",
            }
        )
    finally:
        for process in (relay, sink):
            if process and process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), 5)
                except asyncio.TimeoutError:
                    process.kill()
                    await process.wait()
        processor.stop_event.set()
        await job


@app.local_entrypoint()
def main(output: str):
    Path(output).write_text(smoke.remote())
