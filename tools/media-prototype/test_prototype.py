import tempfile
import time
import unittest
from pathlib import Path
from PIL import Image
from fastapi.testclient import TestClient
from engine import contain_frame, Processor, encoder_command
from server import create_app


class PrototypeTests(unittest.TestCase):
    def test_landscape_is_contained_without_crop(self):
        original = Image.new("RGBA", (400, 200), "red")
        result = Image.frombytes(
            "RGB", (432, 768), contain_frame(original.tobytes(), 400, 200)
        )
        self.assertEqual(result.getpixel((216, 384)), (255, 0, 0))
        self.assertEqual(result.getpixel((216, 0)), (23, 33, 47))

    def test_rotation_happens_before_containment(self):
        original = Image.new("RGBA", (200, 400), "blue")
        result = Image.frombytes(
            "RGB", (432, 768), contain_frame(original.tobytes(), 200, 400, 90)
        )
        self.assertEqual(result.getpixel((216, 200)), (23, 33, 47))
        self.assertEqual(result.getpixel((216, 384)), (0, 0, 255))

    def test_stale_camera_is_not_reported_live(self):
        p = Processor({}, tempfile.mkdtemp())
        p.latest["home"] = (time.monotonic() - 4, b"")
        self.assertFalse(p.status()["cameras"]["home"]["connected"])

    def test_encoder_does_not_accept_a_remote_output_or_microphone(self):
        command = encoder_command(Path("/tmp"), [5, 7])
        self.assertEqual(command[-1], "program.m3u8")
        self.assertIn("anullsrc=r=48000:cl=stereo", command)
        self.assertFalse(any("rtmp" in s for s in command))

    def test_auth_origin_expiry_and_score_validation(self):
        config = {
            "code": "a" * 32,
            "expires": time.time() + 60,
            "url": "wss://example.invalid",
            "home": "test",
            "away": "test",
            "subscriber": "test",
        }
        with TestClient(create_app(config), base_url="https://testserver") as client:
            self.assertEqual(client.get("/api/status").status_code, 401)
            self.assertEqual(client.get("/media/program.m3u8").status_code, 401)
            self.assertEqual(
                client.post("/api/login", json={"code": "a" * 32}).status_code, 403
            )
            headers = {"origin": "https://testserver"}
            self.assertEqual(
                client.post(
                    "/api/login", json={"code": "b" * 32}, headers=headers
                ).status_code,
                401,
            )
            response = client.post(
                "/api/login", json={"code": "a" * 32}, headers=headers
            )
            self.assertEqual(response.status_code, 200)
            self.assertIn("HttpOnly", response.headers["set-cookie"])
            self.assertIn("Secure", response.headers["set-cookie"])
            self.assertEqual(client.get("/api/status").json()["state"], "idle")
            self.assertEqual(
                client.post(
                    "/api/score", json={"home": -1, "away": 0}, headers=headers
                ).status_code,
                422,
            )
            self.assertEqual(
                client.post(
                    "/api/score", json={"home": 1, "away": 0}, headers=headers
                ).status_code,
                409,
            )
            self.assertEqual(client.get("/api/camera/other").status_code, 404)
            config["expires"] = time.time() - 1
            self.assertEqual(client.get("/api/status").status_code, 403)


if __name__ == "__main__":
    unittest.main()
