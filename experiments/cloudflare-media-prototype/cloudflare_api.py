"""Server-only SFU client for the isolated two-camera experiment.

The browser must never supply arbitrary provider paths or receive the app secret.
No provider response text or SDP is logged. Creating tracks is not retried blindly.
"""
import json
import re
import urllib.error
import urllib.request


class ConnectionError(RuntimeError):
    pass


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value):
        raise ValueError('Invalid connection identifier')
    return value


def description(value, kind):
    if (not isinstance(value, dict) or value.get('type') != kind
            or not isinstance(value.get('sdp'), str)
            or not value['sdp'].startswith('v=0') or len(value['sdp']) > 128000):
        raise ValueError('Invalid connection description')
    return {'type': kind, 'sdp': value['sdp']}


class Cloudflare:
    def __init__(self, app_id, app_secret, transport=None):
        self.base = 'https://rtc.live.cloudflare.com/v1/apps/' + identifier(app_id)
        if not isinstance(app_secret, str) or len(app_secret) < 20 or '\n' in app_secret or '\r' in app_secret:
            raise ValueError('Invalid app credential')
        self._secret = app_secret
        self._transport = transport or self._http
        self._sessions = set()

    def _http(self, method, path, body):
        request = urllib.request.Request(
            self.base + path,
            data=json.dumps(body).encode() if body is not None else b'',
            method=method,
            headers={'Authorization': 'Bearer ' + self._secret, 'Content-Type': 'application/json',
                     'User-Agent': 'CurlStreamer-Camera-Test/1.0'},
        )
        # Do not forward the bearer credential to a redirect target.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
                raw = response.read(256001)
                if len(raw) > 256000:
                    raise ConnectionError('The camera service returned an oversized response.')
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            category = 'Check the test app credentials.' if error.code in (401, 403) else 'Try again after checking the connection.'
            raise ConnectionError('The camera service could not complete the request. ' + category) from None
        except (OSError, ValueError):
            raise ConnectionError('The camera service did not return a valid response.') from None

    def _call(self, method, path, body=None):
        result = self._transport(method, path, body)
        if not isinstance(result, dict) or result.get('errorCode'):
            raise ConnectionError('The camera service could not complete the connection.')
        tracks = result.get('tracks', [])
        if not isinstance(tracks, list) or any(not isinstance(t, dict) or t.get('errorCode') for t in tracks):
            if isinstance(tracks,list):
                codes=[t.get('errorCode') for t in tracks if isinstance(t,dict) and t.get('errorCode')]
                safe=[code for code in codes if isinstance(code,str) and re.fullmatch(r'[a-zA-Z_]{1,60}',code)]
                print('PRIVATE_LAB provider track error codes: '+','.join(safe),flush=True)
            raise ConnectionError('One of the camera tracks could not connect.')
        return result

    def _session(self, session_id):
        identifier(session_id)
        if session_id not in self._sessions:
            raise ValueError('Connection does not belong to this test')
        return '/sessions/' + session_id

    def new_session(self):
        result = self._call('POST', '/sessions/new')
        session_id = identifier(result.get('sessionId'))
        self._sessions.add(session_id)
        return session_id

    def publish(self, session_id, offer, mid, track_name):
        return self._call('POST', self._session(session_id) + '/tracks/new', {
            'sessionDescription': description(offer, 'offer'),
            'tracks': [{'location': 'local', 'mid': identifier(mid), 'trackName': identifier(track_name)}],
        })

    def subscribe(self, session_id, source_session, track_name):
        self._session(source_session)
        return self._call('POST', self._session(session_id) + '/tracks/new', {
            'tracks': [{'location': 'remote', 'sessionId': source_session, 'trackName': identifier(track_name)}],
        })

    def answer(self, session_id, answer):
        return self._call('PUT', self._session(session_id) + '/renegotiate', {
            'sessionDescription': description(answer, 'answer'),
        })

    def close_track(self, session_id, mid):
        return self._call('PUT', self._session(session_id) + '/tracks/close', {
            'tracks': [{'mid': identifier(mid)}], 'force': True,
        })
