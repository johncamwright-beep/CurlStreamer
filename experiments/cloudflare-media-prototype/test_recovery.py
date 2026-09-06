import time
import unittest
from fastapi.testclient import TestClient
from server import create_app, token_for
from test_server import FakeLab

MASTER = "offline-recovery-test-master"

class RecoveryTests(unittest.TestCase):
    def setUp(self): self.expires = int(time.time()) + 600
    def client(self, master=MASTER, expires=None):
        lab = FakeLab()
        lab.status = lambda: {"started": True, "ended": False, "remaining": 321, "preview": False}
        return TestClient(create_app(lab, master, expires or self.expires), base_url="https://testserver"), lab
    def authenticate(self, client, role):
        response = client.post("/auth", json={"token": token_for(MASTER, role)})
        self.assertEqual(response.status_code, 200)
        return response.json()
    def test_control_resumes_across_instances_without_start_authority_or_action_replay(self):
        first, _ = self.client()
        original = self.authenticate(first, "control")
        second, lab = self.client()
        second.headers["X-Lab-Page"] = original["pageAccess"]
        self.assertEqual(second.get("/status").status_code, 401)
        resumed = second.post("/resume-control", json={"ticket": original["recoveryTicket"]})
        self.assertEqual(resumed.status_code, 200)
        body = resumed.json()
        preview = second.cookies.get("lab_preview")
        self.assertIsNotNone(preview)
        self.assertNotEqual(preview, token_for(MASTER,"control"))
        self.assertEqual(second.post("/auth",json={"token":preview}).status_code,401)
        self.assertEqual(body["role"], "control")
        self.assertFalse(body["canStart"])
        self.assertNotEqual(body["pageAccess"], original["pageAccess"])
        self.assertNotEqual(body["instance"], original["instance"])
        second.headers["X-Lab-Page"] = body["pageAccess"]
        self.assertEqual(second.get("/status").json()["remaining"], 321)
        self.assertEqual(second.post("/start", json={}).status_code, 403)
        self.assertEqual(second.get("/links").status_code, 403)
        self.assertEqual(lab.calls, [])
        self.assertEqual(second.post("/stop", json={}).status_code, 200)
        self.assertEqual(lab.calls, ["stop"])
    def test_camera_and_preview_cookie_do_not_grant_recovery_or_camera_lease_access(self):
        first, _ = self.client()
        camera = self.authenticate(first, "camera1")
        self.assertNotIn("recoveryTicket", camera)
        first.headers["X-Lab-Page"] = camera["pageAccess"]
        lease = first.post("/camera-claim", json={"sequence": 1}).json()
        original = self.authenticate(first, "control")
        second, lab = self.client()
        body = second.post("/resume-control", json={"ticket": original["recoveryTicket"]}).json()
        second.headers["X-Lab-Page"] = body["pageAccess"]
        for path in ("/camera-start", "/receive", "/disconnect"):
            self.assertEqual(second.post(path, json=lease).status_code, 403)
        second.headers["X-Lab-Page"] = camera["pageAccess"]
        self.assertEqual(second.post("/disconnect", json=lease).status_code, 401)
        second.headers.pop("X-Lab-Page")
        second.cookies.set("lab_preview", token_for(MASTER, "control"))
        self.assertEqual(second.get("/status").status_code, 401)
        self.assertEqual(lab.calls, [])
    def test_tampering_wrong_deployment_and_expiry_fail_closed(self):
        first, _ = self.client()
        ticket = self.authenticate(first, "control")["recoveryTicket"]
        for client, candidate in ((self.client()[0], ticket[:-1] + ("0" if ticket[-1] != "0" else "1")),
                                  (self.client(master="rotated-master")[0], ticket),
                                  (self.client(expires=self.expires + 60)[0], ticket)):
            self.assertEqual(client.post("/resume-control", json={"ticket": candidate}).status_code, 401)
        expired, _ = self.client(expires=int(time.time())-1)
        self.assertEqual(expired.post("/resume-control", json={"ticket": ticket}).status_code, 410)
    def test_repeated_resume_is_bounded_and_never_gains_start(self):
        client, lab = self.client()
        ticket = self.authenticate(client, "control")["recoveryTicket"]
        identities = set()
        for _ in range(66):
            response = client.post("/resume-control", json={"ticket": ticket})
            self.assertEqual(response.status_code, 200)
            identities.add(response.json()["pageAccess"])
            self.assertFalse(response.json()["canStart"])
        self.assertEqual(len(identities), 1)
        self.assertEqual(lab.calls, [])
