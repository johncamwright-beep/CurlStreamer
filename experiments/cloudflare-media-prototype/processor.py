"""One isolated, bounded two-camera processor. Provider credentials stay here."""
import json
import os
import queue
import subprocess
import threading
import time
from pathlib import Path
from cloudflare_api import Cloudflare

ROOT = Path('/test-output')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

class Child:
    def __init__(self, config):
        self.proc = subprocess.Popen(['/prototype/receiver-linux'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.events = queue.Queue()
        self.metric = {}
        self.connection = 'connecting'
        self.send(config)
        threading.Thread(target=self.read, daemon=True).start()

    def send(self, data):
        self.proc.stdin.write(json.dumps(data) + '\n')
        self.proc.stdin.flush()

    def read(self):
        for line in self.proc.stdout:
            try:
                event = json.loads(line)
                if event.get('event') == 'metric': self.metric = event
                elif event.get('event') == 'connection': self.connection = event.get('state')
                else: self.events.put(event)
            except ValueError: pass

    def expect(self, kind, timeout=25):
        deadline = time.monotonic()+timeout
        while time.monotonic()<deadline:
            try: event=self.events.get(timeout=1)
            except queue.Empty: continue
            if event.get('event')==kind: return event
            if event.get('event')=='error': raise RuntimeError('Camera receiver could not connect')
        raise RuntimeError('Camera connection timed out')

    def stop(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try: self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill(); self.proc.wait()

class Lab:
    def __init__(self):
        self.cf=Cloudflare(os.environ['CF_APP_ID'], os.environ['CF_APP_SECRET'])
        self.lock=threading.RLock()
        self.cameras={}
        self.encoder=None
        self.started=None
        self.created=time.monotonic()
        self.ended=False
        self.message='Ready. Start the test, then connect two camera phones.'
        self.deadline=0
        self.generation=0
        ROOT.mkdir(exist_ok=True)
        self.score='TEAM RED  0     |     TEAM BLUE  0'
        (ROOT/'score.txt').write_text(self.score)
        threading.Thread(target=self.watch,daemon=True).start()

    def start(self, seconds=600):
        with self.lock:
            if self.started: return
            if not 5 <= seconds <= 600: raise ValueError('Invalid test duration')
            self.started=time.monotonic(); self.deadline=self.started+seconds
            self.message='Waiting for both cameras. Microphones are off.'

    def attach(self, slot, offer, mid, source=None):
        with self.lock:
            if not self.started or self.ended or time.monotonic()>=self.deadline: raise ValueError('Start a new test first')
            if slot not in (1,2): raise ValueError('Choose camera 1 or 2')
            if slot in self.cameras: raise ValueError('This camera position is occupied. Disconnect it first.')
            published = None
            if source is None:
                source=self.cf.new_session()
                published=self.cf.publish(source,offer,mid,'camera')
            receiver_session=self.cf.new_session()
            try:pulled=self.cf.subscribe(receiver_session,source,'camera')
            except Exception as exc:
                print('PRIVATE_LAB subscribe failed: '+str(exc),flush=True)
                raise
            port=5100+slot*4
            receiver=Child({'offer':pulled['sessionDescription'],'port':port,
                            'seconds':max(5,min(600,int(self.deadline-time.monotonic())))})
            try:
                answer=receiver.expect('answer')['sessionDescription']
                self.cf.answer(receiver_session,answer)
                self.cameras[slot]={'receiver':receiver,'source':source,'source_mid':mid,'session':receiver_session,
                                    'mid':pulled['tracks'][0]['mid'],'port':port,'attached':time.monotonic()}
            except Exception as exc:
                print('PRIVATE_LAB receiver negotiation failed: '+str(exc),flush=True)
                receiver.stop()
                raise
            return published

    def publish_browser(self,slot,offer,mid):
        with self.lock:
            if not self.started or self.ended or time.monotonic()>=self.deadline:raise ValueError('Start a new test first')
            if slot in self.cameras:raise ValueError('Disconnect this camera before reconnecting.')
            source=self.cf.new_session()
            result=self.cf.publish(source,offer,mid,'camera')
            self.cameras[slot]={'receiver':None,'source':source,'source_mid':mid,'attached':time.monotonic()}
            return result

    def receive_browser(self,slot):
        with self.lock:
            if self.ended or time.monotonic()>=self.deadline:raise ValueError('The test has finished.')
            camera=self.cameras.get(slot)
            if not camera:raise ValueError('Connect the camera first.')
            if camera['receiver']:return {'connected':True}
            source=camera['source'];mid=camera['source_mid']
            del self.cameras[slot]
            try:self.attach(slot,None,mid,source)
            except Exception:
                self.cameras[slot]=camera
                raise
            return {'connected':True}

    def detach(self,slot):
        with self.lock:
            camera=self.cameras.pop(slot,None)
            self.stop_encoder()
            if camera:
                if camera['receiver']:camera['receiver'].stop()
                tracks=[(camera['source'],camera['source_mid'])]
                if camera.get('session'):tracks.append((camera['session'],camera['mid']))
                for session,mid in tracks:
                    try: self.cf.close_track(session,mid)
                    except Exception: pass
            self.message='Camera disconnected. Reconnect it to resume the preview.'

    def stop_encoder(self):
        if self.encoder:
            if self.encoder.poll() is None:
                self.encoder.terminate()
                try:self.encoder.wait(timeout=4)
                except subprocess.TimeoutExpired:self.encoder.kill();self.encoder.wait()
            self.encoder=None
            if hasattr(self,'log'):
                self.log.close()

    def command(self):
        args=['ffmpeg','-hide_banner','-nostdin','-y','-loglevel','warning','-stats_period','1',
              '-progress',str(ROOT/'progress.txt'),'-filter_complex_threads','1']
        for slot in (1,2):
            camera=self.cameras[slot]
            sdp=(f'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=camera\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\n'
                 f'm=video {camera["port"]} RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\na=fmtp:96 packetization-mode=1\r\na=recvonly\r\n')
            path=ROOT/f'camera{slot}.sdp';path.write_text(sdp)
            args+=['-protocol_whitelist','file,udp,rtp','-thread_queue_size','1024','-analyzeduration','2000000',
                   '-probesize','2000000','-hwaccel','cuda','-hwaccel_output_format','cuda','-threads','2','-i',str(path)]
        args+=['-f','lavfi','-i','color=c=0x071321:size=1280x720:rate=60',
               '-f','lavfi','-i','anullsrc=r=48000:cl=stereo']
        # Contain either landscape or portrait input without stretching or cropping.
        graph=(f'[2:v]drawtext=fontfile={FONT}:textfile=score.txt:reload=1:expansion=none:fontsize=28:fontcolor=white:x=50:y=40,'
               f'drawtext=fontfile={FONT}:text=PRIVATE CAMERA TEST - AUDIO OFF:fontsize=20:fontcolor=white:x=360:y=670,'
               'format=nv12,hwupload_cuda[base];'
               '[0:v]setpts=PTS-STARTPTS,scale_cuda=576:512:force_original_aspect_ratio=decrease:force_divisible_by=2:format=nv12[left];'
               '[1:v]setpts=PTS-STARTPTS,scale_cuda=576:512:force_original_aspect_ratio=decrease:force_divisible_by=2:format=nv12[right];'
               '[base][left]overlay_cuda=x=32+(576-overlay_w)/2:y=120+(512-overlay_h)/2[mid];'
               '[mid][right]overlay_cuda=x=672+(576-overlay_w)/2:y=120+(512-overlay_h)/2[v]')
        return args+['-filter_complex',graph,'-map','[v]','-map','3:a','-t',str(max(1,int(self.deadline-time.monotonic()))),
                     '-r','60','-c:v','h264_nvenc','-preset','p4','-tune','ll','-rc','cbr','-b:v','6M','-maxrate','6M',
                     '-bufsize','12M','-g','120','-bf','0','-c:a','aac','-b:a','128k','-threads','2','-f','hls',
                     '-hls_time','2','-hls_list_size','6','-hls_flags','delete_segments+independent_segments+temp_file',
                     '-hls_segment_filename',f'segment{self.generation}-%05d.ts','program.m3u8']

    def fresh(self,camera):
        if not camera['receiver']:return False
        metric=camera['receiver'].metric
        return time.time()*1000-metric.get('lastReceivedMs',0)<5000 and camera['receiver'].proc.poll() is None

    def watch(self):
        while not self.ended:
            time.sleep(1)
            with self.lock:
                if not self.started:
                    if time.monotonic()-self.created>180:
                        self.stop()
                        self.message='The unused test has expired. Open a fresh test session to continue.'
                    continue
                if time.monotonic()>=self.deadline:
                    self.stop();break
                ready=len(self.cameras)==2 and all(self.fresh(c) for c in self.cameras.values())
                if not ready and self.encoder:
                    self.stop_encoder(); self.message='Camera signal lost. Preview paused until both cameras return.'
                if ready and self.encoder is None:
                    self.generation+=1
                    (ROOT/'progress.txt').write_text('')
                    for path in ROOT.glob('*.ts'):path.unlink()
                    (ROOT/'program.m3u8').unlink(missing_ok=True)
                    self.log=(ROOT/'encoder.log').open('w')
                    self.encoder=subprocess.Popen(self.command(),cwd=ROOT,stdout=subprocess.DEVNULL,stderr=self.log)
                    self.message='Preparing the combined preview.'
                if self.encoder and self.encoder.poll() is not None:
                    print('PRIVATE_LAB encoder failure: '+(ROOT/'encoder.log').read_text()[-3500:],flush=True)
                    self.message='Video processing failed. Stop the test and report this message.'
                    # Do not restart-loop and consume credits on a persistent decoder failure.
                    self.ended=True
                    self.stop_encoder()
                    for c in self.cameras.values():
                        if c['receiver']:c['receiver'].stop()
                    break
                if self.encoder and (ROOT/'program.m3u8').exists(): self.message='Preview is live. This is a private test, not a YouTube broadcast.'

    def status(self):
        with self.lock:
            progress={}
            try: progress=dict(line.split('=',1) for line in (ROOT/'progress.txt').read_text().splitlines() if '=' in line)
            except OSError:pass
            return {'started':bool(self.started),'ended':self.ended,'message':self.message,
                    'remaining':max(0,int(self.deadline-time.monotonic())) if self.started else 600,
                    'preview':bool(self.encoder and self.encoder.poll() is None and (ROOT/'program.m3u8').exists()
                                   and time.time()-(ROOT/'program.m3u8').stat().st_mtime < 8),
                    'generation':self.generation,'encodedFrames':int(progress.get('frame','0').strip() or 0),
                    'encoderFps':float(progress.get('fps','0').strip() or 0),
                    'cameras':{str(k):{'connected':self.fresh(v), **(v['receiver'].metric if v['receiver'] else {})} for k,v in self.cameras.items()}}

    def stop(self):
        with self.lock:
            self.ended=True
            self.stop_encoder()
            for slot in list(self.cameras):self.detach(slot)
            self.message='Test finished. Cameras and cloud processing have stopped.'
