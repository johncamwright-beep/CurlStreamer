"""Private CLI-only endurance run; independent of browser lifetime. No web endpoint."""

from pathlib import Path
import modal

ROOT = Path(__file__).resolve().parent
app = modal.App("curlstreamer-network-endurance")
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "fonts-dejavu-core")
    .env({"NVIDIA_DRIVER_CAPABILITIES": "compute,video,utility"})
    .pip_install_from_requirements(str(ROOT / "requirements.txt"))
    .add_local_file(str(ROOT / "engine.py"), "/prototype/engine.py")
    .add_local_file(str(ROOT / "endurance.py"), "/prototype/endurance.py")
)
secret = modal.Secret.from_name("curlstreamer-endurance")


@app.function(
    image=image,
    cpu=4,
    memory=4096,
    timeout=9300,
    max_containers=1,
    retries=0,
    secrets=[secret],
)
async def publishers(seconds: int):
    import sys, os, json

    sys.path.insert(0, "/prototype")
    from endurance import publish_pair

    try:
        return await publish_pair(json.loads(os.environ["PROTOTYPE_CONFIG"]), seconds)
    except Exception:
        raise RuntimeError("synthetic_publisher_failed") from None


@app.function(
    image=image,
    gpu="L4",
    cpu=4,
    memory=16384,
    timeout=9300,
    max_containers=1,
    retries=0,
    secrets=[secret],
)
async def receiver(seconds: int):
    import sys, os, json, tempfile, io, zipfile

    sys.path.insert(0, "/prototype")
    from endurance import receive, validate_duration

    config = json.loads(os.environ["PROTOTYPE_CONFIG"])
    validate_duration(config, seconds)
    folder = Path(tempfile.mkdtemp(prefix="endurance-"))
    # Start and cancel the source from the cloud receiver, so a local CLI
    # disconnection cannot orphan or prematurely end the camera generator.
    sender = await publishers.spawn.aio(seconds + 30)
    try:
        report = await receive(config, folder, seconds)
    finally:
        await sender.cancel.aio(terminate_containers=True)
    output = io.BytesIO()
    # Explicit allowlist: never archive config, environment or provider logs.
    with zipfile.ZipFile(
        output, "w", zipfile.ZIP_DEFLATED, strict_timestamps=False
    ) as z:
        for name in (
            "result.json",
            "samples.jsonl",
            "progress.txt",
            "score.txt",
            "program.m3u8",
        ):
            if (folder / name).exists():
                z.write(folder / name, name)
        for path in folder.glob("segment*.ts"):
            z.write(path, path.name)
    print("ENDURANCE_ASSESSMENT " + json.dumps(report["assessment"]), flush=True)
    return output.getvalue()


@app.local_entrypoint()
async def main(output: str, seconds: int = 90):
    import asyncio, json, zipfile, io

    if not 60 <= seconds <= 9000:
        raise ValueError("duration_must_be_60_to_9000_seconds")
    call = await receiver.spawn.aio(seconds)
    print("ENDURANCE_CALL " + call.object_id, flush=True)
    data = await call.get.aio()
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    Path(output).write_bytes(data)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        report = json.loads(z.read("result.json"))
    print(json.dumps(report["assessment"], indent=2), flush=True)
    if not report["assessment"]["passed"]:
        raise RuntimeError("endurance_checks_failed_see_saved_report")
