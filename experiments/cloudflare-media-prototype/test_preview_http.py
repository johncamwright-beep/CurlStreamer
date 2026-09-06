"""Real preview route contract; synthetic bytes only, no media/provider traffic."""
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
import server
from test_server import FakeLab


class PreviewHTTPTests(unittest.TestCase):
    def test_recovered_preview_preserves_mime_and_range_contract(self):
        lab = FakeLab()
        lab.status = lambda: {'preview': True}
        with tempfile.TemporaryDirectory() as folder, patch.object(server, 'ROOT', Path(folder)):
            files = {'program.m3u8': b'#EXTM3U\n#EXT-X-VERSION:3\n', 'segment1-00000.ts': bytes(range(256)) * 2}
            for name, content in files.items():
                (Path(folder) / name).write_bytes(content)
            client = TestClient(server.create_app(lab, 'offline-master', int(time.time()+60)), base_url='https://testserver')
            auth = client.post('/auth', json={'token': server.token_for('offline-master', 'control')}).json()
            client.cookies.clear()
            recovered = client.post('/resume-control', json={'ticket': auth['recoveryTicket']})
            self.assertEqual(recovered.status_code, 200)
            self.assertFalse(recovered.json()['canStart'])
            for name, content in files.items():
                with self.subTest(name=name):
                    response = client.get('/hls/'+name, headers={'Range': 'bytes=0-15'})
                    self.assertEqual(response.status_code, 206)
                    self.assertEqual(response.content, content[:16])
                    self.assertEqual(response.headers['content-range'], f'bytes 0-15/{len(content)}')
                    self.assertEqual(response.headers['content-length'], '16')
                    expected = 'application/vnd.apple.mpegurl' if name.endswith('m3u8') else 'video/mp2t'
                    self.assertEqual(response.headers['content-type'], expected)
                    self.assertEqual(response.headers['cache-control'], 'no-store')
                    self.assertEqual(client.get('/hls/'+name, headers={'Range': 'bytes=999999-'}).status_code, 416)

    def test_camera_or_page_header_alone_cannot_fetch_preview(self):
        lab = FakeLab()
        lab.status = lambda: {'preview': True}
        client = TestClient(server.create_app(lab, 'offline-master', int(time.time()+60)), base_url='https://testserver')
        camera = client.post('/auth', json={'token': server.token_for('offline-master', 'camera1')}).json()
        self.assertEqual(client.get('/hls/program.m3u8', headers={'X-Lab-Page': camera['pageAccess']}).status_code, 403)
        auth = client.post('/auth', json={'token': server.token_for('offline-master', 'control')}).json()
        client.cookies.clear()
        self.assertEqual(client.get('/hls/program.m3u8', headers={'X-Lab-Page': auth['pageAccess']}).status_code, 403)


if __name__ == '__main__':
    unittest.main()
