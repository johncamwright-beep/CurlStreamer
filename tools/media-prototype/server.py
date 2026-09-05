import asyncio
import hmac
import json
import os
import re
import tempfile
import time
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from engine import Processor


class Credentials(BaseModel):
    code: str = Field(min_length=20, max_length=100)


class Score(BaseModel):
    home: int = Field(ge=0, le=99, strict=True)
    away: int = Field(ge=0, le=99, strict=True)


class Start(BaseModel):
    profile: Literal["720p60", "1080p30"] = "720p60"


def create_app(config=None):
    config = config or json.loads(os.environ["PROTOTYPE_CONFIG"])
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    processor = None
    job = None
    lock = asyncio.Lock()
    root = Path(tempfile.mkdtemp(prefix="curlstreamer-prototype-"))

    @app.middleware("http")
    async def protection(request: Request, call_next):
        path = request.url.path
        if path.startswith("/api/") or path.startswith("/media/"):
            if time.time() >= config["expires"]:
                return JSONResponse(
                    {"detail": "This test access has expired."}, status_code=403
                )
            if path != "/api/login" and not hmac.compare_digest(
                request.cookies.get("prototype", ""), config["code"]
            ):
                return JSONResponse(
                    {"detail": "Open your private test link first."}, status_code=401
                )
            if request.method == "POST" and request.headers.get("origin") != str(
                request.base_url
            ).rstrip("/"):
                return JSONResponse(
                    {"detail": "This action must come from the test page."},
                    status_code=403,
                )
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Permissions-Policy"] = "camera=(self), microphone=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self'; connect-src 'self' https://*.livekit.cloud wss://*.livekit.cloud; media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'"
        )
        return response

    @app.get("/")
    async def index():
        return FileResponse(Path(__file__).parent / "index.html")

    @app.get("/assets/{name}")
    async def assets(name: str):
        if name not in (
            "client.js",
            "style.css",
            "livekit-client.umd.js",
            "hls.min.js",
        ):
            raise HTTPException(404)
        return FileResponse(Path(__file__).parent / "assets" / name)

    @app.post("/api/login")
    async def login(body: Credentials):
        if not hmac.compare_digest(body.code, config["code"]):
            raise HTTPException(401, "The private test code is invalid.")
        response = JSONResponse({"ok": True})
        response.set_cookie(
            "prototype",
            config["code"],
            secure=True,
            httponly=True,
            samesite="strict",
            max_age=max(0, int(config["expires"] - time.time())),
        )
        return response

    @app.post("/api/start")
    async def start(body: Start):
        nonlocal processor, job
        async with lock:
            if job and not job.done():
                return processor.status()
            folder = root / str(time.time_ns())
            processor = Processor(config, folder, body.profile)
            job = asyncio.create_task(processor.run())
            await asyncio.sleep(0)
            return processor.status()

    @app.post("/api/stop")
    async def stop():
        async with lock:
            if processor:
                processor.stop_event.set()
            if job:
                try:
                    await asyncio.wait_for(asyncio.shield(job), 10)
                except asyncio.TimeoutError:
                    raise HTTPException(503, "Stop is still being confirmed.")
            return processor.status() if processor else {"state": "idle"}

    @app.get("/api/status")
    async def status():
        return (
            processor.status()
            if processor
            else {"state": "idle", "cameras": {}, "previewReady": False}
        )

    @app.get("/api/report")
    async def report():
        if not processor:
            raise HTTPException(404, "No test report in this session.")
        return JSONResponse(
            processor.report(),
            headers={
                "Content-Disposition": 'attachment; filename="camera-test-report.json"'
            },
        )

    @app.post("/api/score")
    async def score(body: Score):
        if not processor or processor.state not in ("starting", "running"):
            raise HTTPException(409, "Start a test before changing its score.")
        processor.update_score(body.home, body.away)
        return {"score": processor.score}

    @app.get("/api/camera/{role}")
    async def camera(role: str):
        if role not in ("home", "away"):
            raise HTTPException(404)
        if not processor or processor.state != "running":
            raise HTTPException(409, "Start the processor on the control page first.")
        return {"url": config["url"], "token": config[role], "fps": processor.fps}

    @app.get("/media/{name}")
    async def media(name: str):
        if not re.fullmatch(r"(program\.m3u8|segment\d{5}\.ts)", name) or not processor:
            raise HTTPException(404)
        path = processor.folder / name
        if not path.is_file():
            raise HTTPException(404)
        return FileResponse(
            path,
            media_type=(
                "application/vnd.apple.mpegurl"
                if name.endswith("m3u8")
                else "video/mp2t"
            ),
        )

    return app
