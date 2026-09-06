"""Bounded, allowlisted metadata only; stdout is retained by the deployment log service."""
import json
import math
import secrets
import threading
import time

EVENTS = {"instance_created", "run_started", "camera_published", "receiver_attached", "camera_receiving", "sample", "encoder_started", "encoder_stopped", "cleanup", "failure", "run_ended", "control_resumed"}
REASONS = {"manual_stop", "deadline", "absolute_expiry", "unused_timeout", "container_shutdown", "encoder_failure", "subscribe_failed", "receiver_failed"}
NUMBERS = {"slot", "attempt", "durationSeconds", "durationMs", "generation", "encodedFrames", "encoderFps", "configuredWidth", "configuredHeight", "targetFps", "track"}
for slot in (1, 2):
    NUMBERS.update(f"camera{slot}{field}" for field in ("Packets", "PayloadBytes", "MarkedFrames", "PacketAgeMs"))
BOOLEANS = {"receiving", "previewPlaylistFresh", "providerAcknowledged", "camera1Receiving", "camera2Receiving"}
ENUMS = {"reason": REASONS, "target": {"receiver", "provider_track", "encoder"}, "result": {"attempted", "confirmed", "unknown"}}
ENUMS.update({"trackKind": {"publisher", "subscriber"}, "failureCategory": {"timeout", "network", "authentication", "rate_limited", "upstream_error", "http_error", "invalid_response", "provider_rejected", "invalid_identifier", "process_error", "unexpected_error"}})

def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 1e15

class Evidence:
    def __init__(self, sink=None, monotonic=time.monotonic, wall=time.time):
        self.instance = secrets.token_hex(12)  # Correlation only; never accepted as authorization.
        self.clock, self.wall = monotonic, wall
        self.created = self.clock()
        self.sink = sink or (lambda row: print("PRIVATE_LAB_EVIDENCE " + json.dumps(row, allow_nan=False, separators=(",", ":")), flush=True))
        self.lock = threading.RLock()
        self.count = 0
        self.finished = False
        self.last_sample = None
        self.receiving = {}
        self.emit("instance_created", durationSeconds=600)

    def emit(self, event, **fields):
        with self.lock:
            if event not in EVENTS or self.finished or (self.count >= 512 and event != "run_ended"):
                return
            safe = {}
            for key, value in fields.items():
                if key in NUMBERS and number(value): safe[key] = value
                elif key in BOOLEANS and isinstance(value, bool): safe[key] = value
                elif key in ENUMS and isinstance(value, str) and value in ENUMS[key]: safe[key] = value
            row = {"schema": 1, "instance": self.instance, "event": event,
                   "atUnixMs": int(self.wall() * 1000), "elapsedMs": int((self.clock() - self.created) * 1000), **safe}
            self.count += 1
            if event == "run_ended": self.finished = True
            try: self.sink(row)
            except Exception: pass  # Log delivery cannot keep a test running or expose raw exceptions.

    def sample(self, status, force=False):
        with self.lock:
            fields = {"generation": status.get("generation"), "encodedFrames": status.get("encodedFrames"),
                      "encoderFps": status.get("encoderFps"), "previewPlaylistFresh": bool(status.get("preview")),
                      "configuredWidth": 1280, "configuredHeight": 720, "targetFps": 60}
            for slot in (1, 2):
                camera = status.get("cameras", {}).get(str(slot), {})
                receiving = camera.get("connected") is True
                if self.receiving.get(slot) != receiving:
                    self.receiving[slot] = receiving
                    self.emit("camera_receiving", slot=slot, receiving=receiving)
                fields[f"camera{slot}Receiving"] = receiving
                for key, source in (("Packets", "packets"), ("PayloadBytes", "payloadBytes"), ("MarkedFrames", "markedFrames")):
                    fields[f"camera{slot}{key}"] = camera.get(source)
                last = camera.get("lastReceivedMs")
                if number(last) and last > 0: fields[f"camera{slot}PacketAgeMs"] = max(0, int(self.wall() * 1000 - last))
            if force or self.last_sample is None or self.clock() - self.last_sample >= 10:
                self.last_sample = self.clock()
                self.emit("sample", **fields)
