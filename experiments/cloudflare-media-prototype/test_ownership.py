"""Offline access/lease tests: FakeLab never opens a provider connection."""
import time
import unittest
from fastapi.testclient import TestClient
from server import create_app, token_for
from test_server import FakeLab


class OwnershipTests(unittest.TestCase):
    def setUp(self):
        self.lab = FakeLab()
        self.client = TestClient(create_app(self.lab, 'ownership-test-only', time.time()+60), base_url='https://testserver')

    def page(self, role):
        response = self.client.post('/auth', json={'token': token_for('ownership-test-only', role)})
        self.assertEqual(response.status_code, 200)
        return {'X-Lab-Page': response.json()['pageAccess']}

    def claim(self, headers, sequence=1):
        response = self.client.post('/camera-claim', headers=headers, json={'sequence': sequence})
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_same_browser_pages_keep_distinct_roles(self):
        control = self.page('control')
        first = self.page('camera1')
        second = self.page('camera2')
        for headers, expected in [(control,'control'),(first,'camera1'),(second,'camera2')]:
            self.assertEqual(self.client.get('/status',headers=headers).json()['role'],expected)
        self.assertEqual(self.client.post('/stop',headers=first,json={}).status_code,403)
        # The preview cookie grants no mutation authority to a page without its identity.
        self.assertEqual(self.client.post('/stop',json={}).status_code,401)

    def test_old_tab_cannot_attach_receive_start_or_disconnect_replacement(self):
        old_page = self.page('camera1')
        old = self.claim(old_page)
        new_page = self.page('camera1')
        new = self.claim(new_page)
        self.lab.calls.clear()
        for path, body in [('/camera-start',old),('/attach',{**old,'offer':{},'mid':'0'}),('/receive',old),('/disconnect',old)]:
            self.assertEqual(self.client.post(path,headers=old_page,json=body).status_code,409)
        self.assertEqual(self.lab.calls,[])
        self.assertEqual(self.client.post('/receive',headers=new_page,json=new).status_code,200)
        self.assertEqual(self.lab.calls,[('receive',1)])

    def test_lease_from_another_page_or_slot_is_not_authority(self):
        first = self.page('camera1')
        lease = self.claim(first)
        duplicate = self.page('camera1')
        second = self.page('camera2')
        self.lab.calls.clear()
        for headers in (duplicate,second):
            self.assertEqual(self.client.post('/disconnect',headers=headers,json=lease).status_code,409)
        self.assertEqual(self.lab.calls,[])

    def test_out_of_order_claim_cannot_supersede_a_newer_attempt(self):
        headers = self.page('camera1')
        lease = self.claim(headers,2)
        self.lab.calls.clear()
        for sequence in (1,2):
            self.assertEqual(self.client.post('/camera-claim',headers=headers,json={'sequence':sequence}).status_code,409)
        self.assertEqual(self.lab.calls,[])
        self.assertEqual(self.client.post('/receive',headers=headers,json=lease).status_code,200)

    def test_disconnect_revokes_pending_mutations_and_repeated_cleanup(self):
        headers = self.page('camera1')
        lease = self.claim(headers)
        self.lab.calls.clear()
        self.assertEqual(self.client.post('/disconnect',headers=headers,json=lease).status_code,200)
        for path,body in [('/attach',{**lease,'offer':{},'mid':'0'}),('/receive',lease),('/disconnect',lease)]:
            self.assertEqual(self.client.post(path,headers=headers,json=body).status_code,409)
        self.assertEqual(self.lab.calls,[('detach',1)])

    def test_control_cannot_claim_and_page_count_is_bounded(self):
        control = self.page('control')
        self.assertEqual(self.client.post('/camera-claim',headers=control,json={'sequence':1}).status_code,403)
        for _ in range(63):self.page('camera1')
        response=self.client.post('/auth',json={'token':token_for('ownership-test-only','camera1')})
        self.assertEqual(response.status_code,429)

if __name__ == '__main__':unittest.main()
