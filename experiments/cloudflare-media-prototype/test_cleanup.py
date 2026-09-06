"""Offline teardown fault injection: no provider requests or child processes."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import urllib.error
from unittest.mock import Mock, call, patch

from cloudflare_api import Cloudflare, ConnectionError
from evidence import Evidence
import processor


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        folder = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.stack.enter_context(patch.object(processor, 'ROOT', Path(folder)))
        self.stack.enter_context(patch.dict(os.environ, {'CF_APP_ID': 'fixture', 'CF_APP_SECRET': 'fixture-not-a-real-credential'}))
        self.stack.enter_context(patch.object(processor.threading.Thread, 'start'))
        self.lab = processor.Lab()
        self.rows = []
        self.lab.evidence = Evidence(self.rows.append)
        self.lab.cf = Mock()

    def camera(self, slot):
        receiver = Mock()
        receiver.metric = {}
        receiver.proc.poll.return_value = None
        self.lab.cameras[slot] = {'receiver': receiver, 'source': f'source{slot}', 'source_mid': '0', 'session': f'subscriber{slot}', 'mid': '1'}
        return receiver

    def test_partial_failures_still_close_all_tracks_and_end_once(self):
        one, two = self.camera(1), self.camera(2)
        one.stop.side_effect = subprocess.TimeoutExpired('PRIVATE-SENTINEL', 3)
        self.lab.cf.close_track.side_effect = [ConnectionError('PRIVATE-SENTINEL', 'timeout'), {}, RuntimeError('PRIVATE-SENTINEL'), {}]
        self.lab.stop('deadline')
        self.lab.stop('manual_stop')
        self.lab.detach(1)
        self.assertEqual(self.lab.cf.close_track.call_args_list, [call('source1', '0'), call('subscriber1', '1'), call('source2', '0'), call('subscriber2', '1')])
        one.stop.assert_called_once()
        two.stop.assert_called_once()
        outcomes = [r for r in self.rows if r.get('target') == 'provider_track' and r.get('result') == 'unknown']
        self.assertEqual([r['trackKind'] for r in outcomes], ['publisher', 'subscriber'] * 2)
        self.assertEqual([r['providerAcknowledged'] for r in outcomes], [False, True, False, True])
        self.assertEqual(outcomes[0]['failureCategory'], 'timeout')
        self.assertEqual(outcomes[2]['failureCategory'], 'unexpected_error')
        self.assertTrue(all(r['durationMs'] >= 0 for r in outcomes))
        self.assertEqual(sum(r['event'] == 'run_ended' for r in self.rows), 1)
        self.assertEqual(self.rows[-1]['reason'], 'deadline')
        self.assertNotIn('PRIVATE-SENTINEL', json.dumps(self.rows))

    def test_encoder_kill_timeout_does_not_skip_receivers_or_claim_success(self):
        receiver = self.camera(1)
        encoder = Mock()
        encoder.poll.return_value = None
        encoder.wait.side_effect = subprocess.TimeoutExpired('PRIVATE-SENTINEL', 3)
        self.lab.encoder = encoder
        self.lab.stop('deadline')
        self.assertEqual(encoder.wait.call_args_list, [call(timeout=4), call(timeout=3)])
        encoder.kill.assert_called_once()
        receiver.stop.assert_called_once()
        self.assertEqual(self.lab.cf.close_track.call_count, 2)
        self.assertTrue(any(r.get('target') == 'encoder' and r.get('result') == 'unknown' and r.get('failureCategory') == 'timeout' for r in self.rows))
        self.assertFalse(any(r['event'] == 'encoder_stopped' for r in self.rows))
        self.assertEqual(self.rows[-1]['event'], 'run_ended')

    def test_receiver_kill_wait_is_bounded_and_already_exited_is_noop(self):
        proc = Mock()
        proc.poll.return_value = None
        proc.wait.side_effect = [subprocess.TimeoutExpired('fixture', 3), 0]
        processor.stop_process(proc, 3)
        self.assertEqual(proc.wait.call_args_list, [call(timeout=3), call(timeout=3)])
        proc.poll.return_value = 0
        processor.stop_process(proc, 3)
        proc.terminate.assert_called_once()
        proc.kill.assert_called_once()

    def test_encoder_log_io_error_cannot_skip_resource_cleanup(self):
        receiver = self.camera(1)
        self.lab.encoder = Mock()
        self.lab.encoder.poll.return_value = 0
        self.lab.log = Mock()
        self.lab.log.close.side_effect = OSError('PRIVATE-SENTINEL')
        self.lab.stop('deadline')
        receiver.stop.assert_called_once()
        self.assertEqual(self.lab.cf.close_track.call_count, 2)
        self.assertTrue(any(r.get('target') == 'encoder_log' and r.get('result') == 'unknown' for r in self.rows))
        self.assertTrue(any(r['event'] == 'encoder_stopped' for r in self.rows))
        self.assertEqual(self.rows[-1]['reason'], 'deadline')
        self.assertNotIn('PRIVATE-SENTINEL', json.dumps(self.rows))

    def test_failed_encoder_stop_during_detach_ends_run_instead_of_restart(self):
        self.camera(1)
        other = self.camera(2)
        encoder = Mock()
        encoder.poll.return_value = None
        encoder.terminate.side_effect = OSError('PRIVATE-SENTINEL')
        self.lab.encoder = encoder
        self.lab.detach(1)
        self.assertTrue(self.lab.ended)
        other.stop.assert_called_once()
        self.assertEqual(self.lab.cf.close_track.call_count, 4)
        self.assertEqual(self.rows[-1]['reason'], 'encoder_failure')

    def test_only_cleanup_uses_shorter_socket_timeout(self):
        cf = Cloudflare('fixture', 'fixture-not-a-real-credential')
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'{"sessionId":"owned"}'
        with patch('urllib.request.build_opener') as factory:
            factory.return_value.open.return_value = response
            cf.new_session()
            cf.publish('owned', {'type': 'offer', 'sdp': 'v=0'}, '0', 'camera')
            cf.close_track('owned', '0')
            self.assertEqual([c.kwargs['timeout'] for c in factory.return_value.open.call_args_list], [15, 15, 5])

    def test_uncertain_receiver_detach_ends_run_before_replacement_can_claim_port(self):
        one, two = self.camera(1), self.camera(2)
        one.stop.side_effect = subprocess.TimeoutExpired('PRIVATE-SENTINEL', 3)
        self.lab.detach(1)
        self.assertTrue(self.lab.ended)
        self.assertEqual(self.lab.cameras, {})
        two.stop.assert_called_once()
        self.assertEqual(self.lab.cf.close_track.call_count, 4)
        outcomes = [r for r in self.rows if r.get('target') == 'receiver' and r.get('slot') == 1]
        self.assertEqual([r['result'] for r in outcomes], ['attempted', 'unknown'])
        self.assertEqual(self.rows[-1]['reason'], 'receiver_failed')
        with self.assertRaises(ValueError):
            self.lab.publish_browser(1, {'type': 'offer', 'sdp': 'v=0'}, '0')
        self.lab.cf.new_session.assert_not_called()

    def test_http_failures_are_categorized_without_body_or_credentials(self):
        cf = Cloudflare('fixture', 'fixture-not-a-real-credential')
        cf._sessions.add('owned')
        cases = [(TimeoutError('PRIVATE-SENTINEL'), 'timeout'),
                 (urllib.error.URLError(TimeoutError('PRIVATE-SENTINEL')), 'timeout'),
                 (urllib.error.URLError('PRIVATE-SENTINEL'), 'network'),
                 (urllib.error.HTTPError('PRIVATE-SENTINEL', 503, 'PRIVATE-SENTINEL', {}, None), 'upstream_error'),
                 (urllib.error.HTTPError('PRIVATE-SENTINEL', 403, 'PRIVATE-SENTINEL', {}, None), 'authentication')]
        for error, expected in cases:
            with self.subTest(expected=expected), patch('urllib.request.build_opener') as factory:
                factory.return_value.open.side_effect = error
                with self.assertRaises(ConnectionError) as caught:
                    cf.close_track('owned', '0')
                self.assertEqual(caught.exception.category, expected)
                self.assertNotIn('PRIVATE-SENTINEL', str(caught.exception))
                self.assertEqual(factory.return_value.open.call_count, 1)

    def test_provider_rejection_and_unknown_failure_enum_never_leak(self):
        cf = Cloudflare('fixture', 'fixture-not-a-real-credential', lambda *args: {'tracks': [{'errorCode': 'PRIVATE_SENTINEL'}]})
        cf._sessions.add('owned')
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream), self.assertRaises(ConnectionError) as caught:
            cf.close_track('owned', '0')
        self.assertEqual(caught.exception.category, 'provider_rejected')
        self.lab.evidence.emit('cleanup', failureCategory='PRIVATE_SENTINEL', trackKind='PRIVATE_SENTINEL', result='unknown')
        self.assertNotIn('PRIVATE_SENTINEL', stream.getvalue() + json.dumps(self.rows))


if __name__ == '__main__':
    unittest.main()
