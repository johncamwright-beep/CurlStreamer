"""Deploy explicitly with a private, room-scoped secret; production app is unaffected."""

from pathlib import Path
import modal

ROOT = Path(__file__).resolve().parent
app = modal.App("curlstreamer-camera-prototype")
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "fonts-dejavu-core")
    .env({"NVIDIA_DRIVER_CAPABILITIES": "compute,video,utility"})
    .pip_install_from_requirements(str(ROOT / "requirements.txt"))
    .add_local_file(str(ROOT / "engine.py"), "/prototype/engine.py")
    .add_local_file(str(ROOT / "server.py"), "/prototype/server.py")
    .add_local_file(str(ROOT / "index.html"), "/prototype/index.html")
    .add_local_dir(str(ROOT / "assets"), "/prototype/assets")
)


@app.function(
    image=image,
    gpu="L4",
    cpu=4,
    memory=16384,
    timeout=900,
    min_containers=0,
    max_containers=1,
    scaledown_window=30,
    secrets=[modal.Secret.from_name("curlstreamer-camera-prototype")],
)
@modal.concurrent(max_inputs=30)
@modal.asgi_app()
def web():
    import sys

    sys.path.insert(0, "/prototype")
    from server import create_app

    return create_app()


@app.function(
    image=image, gpu="L4", cpu=4, memory=16384, timeout=150, max_containers=1, retries=0
)
async def smoke():
    import sys, tempfile, zipfile, io

    sys.path.insert(0, "/prototype")
    from engine import Processor

    folder = Path(tempfile.mkdtemp())
    processor = Processor({}, folder)
    await processor.run(synthetic=True, seconds=20)
    if processor.error:
        # This run has no provider credentials, so its encoder log is safe evidence.
        raise RuntimeError((folder / "encoder.log").read_text()[-2000:])
    output = io.BytesIO()
    with zipfile.ZipFile(
        output, "w", zipfile.ZIP_DEFLATED, strict_timestamps=False
    ) as z:
        for path in folder.iterdir():
            if path.is_file():
                z.write(path, path.name)
    return output.getvalue()


@app.local_entrypoint()
def test(output: str):
    Path(output).write_bytes(smoke.remote())
