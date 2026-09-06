import sys
from pathlib import Path
import unittest,time
from unittest.mock import patch
from fastapi.testclient import TestClient
from server import create_app,token_for

class FakeLab:
    ended=False
    def __init__(self):self.calls=[]
    def status(self):return {'preview':False}
    def start(self):self.calls.append('start')
    def stop(self,reason='manual_stop'):self.calls.append('stop')
    def attach(self,*args):self.calls.append(('attach',args[0]));return {'ok':True}
    publish_browser=attach
    def detach(self,*args):self.calls.append(('detach',args[0]))
    def receive_browser(self,*args):self.calls.append(('receive',args[0]));return {'connected':True}

class AccessTests(unittest.TestCase):
    def setUp(self):
        self.lab=FakeLab();self.client=TestClient(create_app(self.lab,'private-test-master',time.time()+60),base_url='https://testserver')
    def auth(self,role):
        response=self.client.post('/auth',json={'token':token_for('private-test-master',role)})
        if response.status_code==200:self.client.headers['X-Lab-Page']=response.json()['pageAccess']
        return response
    def claim(self,sequence=1):
        response=self.client.post('/camera-claim',json={'sequence':sequence})
        self.assertEqual(response.status_code,200)
        self.lab.calls.clear()
        return response.json()
    def test_unauthenticated_cannot_read_status_or_start(self):
        self.assertEqual(self.client.get('/status').status_code,401)
        self.assertEqual(self.client.post('/start',json={}).status_code,401)
        self.assertEqual(self.lab.calls,[])
    def test_camera_cannot_start_stop_score_or_read_program(self):
        self.assertEqual(self.auth('camera1').status_code,200)
        for path,body in [('/start',{}),('/stop',{}),('/score',{'red':1,'blue':2})]:
            self.assertEqual(self.client.post(path,json=body).status_code,403)
        self.assertEqual(self.client.get('/hls/program.m3u8').status_code,403)
        self.assertEqual(self.lab.calls,[])
    def test_camera_can_start_bounded_test_without_control_page(self):
        self.auth('camera1')
        lease=self.claim()
        self.assertEqual(self.client.post('/camera-start',json=lease).status_code,200)
        self.assertEqual(self.lab.calls,['start'])
    def test_ended_test_cannot_be_reopened_by_camera(self):
        self.lab.ended=True
        self.auth('camera1')
        self.assertEqual(self.client.post('/camera-start',json={'connectionId':'x'*32}).status_code,409)
        self.assertEqual(self.lab.calls,[])
    def test_unauthenticated_cannot_start_camera_test(self):
        self.assertEqual(self.client.post('/camera-start',json={'connectionId':'x'*32}).status_code,401)
        self.assertEqual(self.lab.calls,[])
    def test_camera_slot_comes_from_role_not_user_payload(self):
        self.auth('camera2')
        lease=self.claim()
        self.assertEqual(self.client.post('/attach',json={**lease,'offer':{},'mid':'0','slot':1}).status_code,200)
        self.assertEqual(self.lab.calls,[('attach',2)])
    def test_control_cannot_claim_a_camera(self):
        self.auth('control')
        self.assertEqual(self.client.post('/attach',json={'connectionId':'x'*32,'offer':{},'mid':'0'}).status_code,403)
        self.assertEqual(self.client.post('/start',json={}).status_code,200)
        self.assertEqual(self.lab.calls,['start'])
    def test_cross_origin_post_rejected(self):
        self.auth('control')
        self.assertEqual(self.client.post('/stop',json={},headers={'Origin':'https://elsewhere.example'}).status_code,403)
        self.assertEqual(self.lab.calls,[])
    def test_expired_link_stops_lab_and_denies_access(self):
        self.auth('control')
        with patch('server.time.time',return_value=time.time()+120):
            self.assertEqual(self.client.get('/status').status_code,410)
        self.assertEqual(self.lab.calls,['stop'])
    def test_cookie_is_private_and_secure(self):
        header=self.auth('control').headers['set-cookie']
        self.assertIn('Path=/hls',header)
        for flag in ('HttpOnly','Secure','SameSite=strict'):self.assertIn(flag,header)
    def test_malformed_and_oversized_requests_rejected(self):
        self.auth('camera1')
        self.assertEqual(self.client.post('/attach',json={'connectionId':'x'*32,'offer':{},'mid':'../../secret'}).status_code,422)
        self.assertEqual(self.client.post('/attach',json={'offer':{'sdp':'x'*140000},'mid':'0'}).status_code,413)
        self.assertEqual(self.lab.calls,[])

if __name__=='__main__':unittest.main()
