import unittest
from cloudflare_api import Cloudflare, ConnectionError


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.response = {'sessionId': 'test-session'}
        def transport(method, path, body):
            self.calls.append((method, path, body))
            return self.response
        self.client = Cloudflare('test-app', 'private-test-placeholder-key', transport)

    def test_publish_uses_scoped_session_and_no_secret_in_payload(self):
        session = self.client.new_session()
        self.client.publish(session, {'type': 'offer', 'sdp': 'v=0\r\n'}, '0', 'camera1')
        self.assertEqual(self.calls[-1][1], '/sessions/test-session/tracks/new')
        self.assertNotIn('private-test-placeholder-key', str(self.calls))

    def test_cross_test_session_is_rejected_before_network(self):
        with self.assertRaises(ValueError):
            self.client.publish('unknown', {'type': 'offer', 'sdp': 'v=0'}, '0', 'camera1')
        self.assertEqual(self.calls, [])

    def test_cross_test_subscription_is_rejected(self):
        session = self.client.new_session()
        with self.assertRaises(ValueError):
            self.client.subscribe(session, 'another-test', 'camera1')
        self.assertEqual(len(self.calls), 1)

    def test_track_error_is_not_success_or_exposed(self):
        session = self.client.new_session()
        self.response = {'tracks': [{'errorCode': 'bad', 'errorDescription': 'sensitive provider detail'}]}
        with self.assertRaises(ConnectionError) as caught:
            self.client.close_track(session, '0')
        self.assertNotIn('sensitive', str(caught.exception))

    def test_path_injection_rejected(self):
        session = self.client.new_session()
        with self.assertRaises(ValueError):
            self.client.close_track(session, '../../other')
        self.assertEqual(len(self.calls), 1)

    def test_invalid_sdp_rejected(self):
        session = self.client.new_session()
        with self.assertRaises(ValueError):
            self.client.answer(session, {'type': 'offer', 'sdp': 'v=0'})
        self.assertEqual(len(self.calls), 1)

    def test_forced_close_payload(self):
        session = self.client.new_session()
        self.client.close_track(session, '0')
        self.assertEqual(self.calls[-1][2], {'tracks': [{'mid': '0'}], 'force': True})


if __name__ == '__main__':
    unittest.main()
