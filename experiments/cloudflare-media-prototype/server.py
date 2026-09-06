"""Expiring, role-scoped phone test. No public broadcast, accounts or game writes."""
import base64
import json
import hashlib
import hmac
import os
import re
import secrets
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from processor import Lab, ROOT
from evidence import Evidence

ROLES=('control','camera1','camera2')
ASSETS=Path('/prototype')
PROVENANCE=ASSETS/'build-provenance.json'
PROVENANCE_ASSETS=('cloudflare_api.py','processor.py','server.py','evidence.py','index.html','style.css',
                   'client.js','camera-session.js','hls.min.js','receiver-linux')

def build_provenance(value=None,asset_root=ASSETS):
    if value is None:
        try:value=json.loads((asset_root/'build-provenance.json').read_text())
        except (OSError,json.JSONDecodeError):return {'schema':1,'verified':False}
    try:
        assets=value['assets']
        actual={name:hashlib.sha256((asset_root/name).read_bytes()).hexdigest() for name in PROVENANCE_ASSETS}
        package=hashlib.sha256(json.dumps({'schema':1,'gitHead':value['gitHead'],'assets':actual},
                                         sort_keys=True,separators=(',',':')).encode()).hexdigest()
        valid=(value['schema']==1 and re.fullmatch(r'[0-9a-f]{40}',value['gitHead']) and
               re.fullmatch(r'[0-9a-f]{64}',value['packageSha256']) and isinstance(assets,dict) and assets and
               set(assets)==set(PROVENANCE_ASSETS) and
               all(isinstance(name,str) and re.fullmatch(r'[0-9a-f]{64}',digest) for name,digest in assets.items()) and
               assets==actual and value['packageSha256']==package)
    except (KeyError,TypeError,OSError):valid=False
    return ({'schema':1,'verified':True,'gitHead':value['gitHead'],'packageSha256':value['packageSha256'],
             'assets':{name:assets[name] for name in PROVENANCE_ASSETS}}
            if valid else {'schema':1,'verified':False})

def token_for(master,role):
    return hmac.new(master.encode(),role.encode(),hashlib.sha256).hexdigest()

class Auth(BaseModel):
    token: str = Field(min_length=32,max_length=128)
class Resume(BaseModel):
    ticket: str = Field(min_length=80,max_length=512)
class Ownership(BaseModel):
    connectionId: str = Field(pattern=r'^[A-Za-z0-9_-]{32,128}$')
class Claim(BaseModel):
    sequence: int = Field(ge=1,le=9007199254740991)
class Attach(Ownership):
    offer: dict
    mid: str = Field(pattern=r'^[A-Za-z0-9_-]{1,128}$')
class Score(BaseModel):
    red: int = Field(ge=0,le=99)
    blue: int = Field(ge=0,le=99)

def create_app(lab=None,master=None,expires=None,provenance=None,asset_root=ASSETS):
    lab=lab or Lab()
    master=master or os.environ['LAB_ACCESS_KEY']
    expires=expires or int(os.environ['LAB_EXPIRES_AT'])
    tokens={role:token_for(master,role) for role in ROLES}
    preview_token=token_for(master,'preview-control-v1')
    provenance=build_provenance(provenance,asset_root)
    pages={}
    recovered_pages={}
    evidence=getattr(lab,"evidence",None) or Evidence()
    lab.absolute_expires=expires
    owners={}
    ownership_lock=threading.RLock()
    @asynccontextmanager
    async def lifespan(app):
        yield
        lab.stop("container_shutdown")
    app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None,lifespan=lifespan)

    @app.middleware('http')
    async def guard(request,call_next):
        if time.time()>expires:
            lab.stop("absolute_expiry")
            return JSONResponse({'detail':'This private test link has expired.'},status_code=410)
        try: length=int(request.headers.get('content-length','0') or '0')
        except ValueError:return JSONResponse({'detail':'Invalid request size.'},status_code=400)
        if length<0 or length>130000:
            return JSONResponse({'detail':'Request is too large.'},status_code=413)
        if request.method=='POST':
            if 'content-length' not in request.headers:
                return JSONResponse({'detail':'Request size is required.'},status_code=411)
            origin=request.headers.get('origin')
            if origin and origin != str(request.base_url).rstrip('/'):
                return JSONResponse({'detail':'Open the private test page to continue.'},status_code=403)
            if 'application/json' not in request.headers.get('content-type',''):
                return JSONResponse({'detail':'Invalid request format.'},status_code=415)
        response=await call_next(request)
        response.headers['Cache-Control']='no-store'
        response.headers['Referrer-Policy']='no-referrer'
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Permissions-Policy']='camera=(self), microphone=()'
        response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"
        return response

    def page(request):
        selected=pages.get(request.headers.get('x-lab-page',''))
        if selected is None:raise HTTPException(401,'Open your private test link to connect.')
        return selected

    def role(request):return page(request)['role']

    def owned(request,body):
        selected=role(request)
        if selected not in ('camera1','camera2'):raise HTTPException(403)
        slot=int(selected[-1])
        owner=owners.get(slot)
        if owner is None or owner['page']!=request.headers.get('x-lab-page') or not hmac.compare_digest(owner['connectionId'],body.connectionId):
            raise HTTPException(409,'This camera connection has been replaced or disconnected.')
        return slot

    def control(request):
        if role(request)!='control':raise HTTPException(403,'Use the control phone for this action.')

    @app.get('/')
    def index():return FileResponse(ASSETS/'index.html')
    @app.get('/assets/{name}')
    def asset(name:str):
        if name not in ('client.js','camera-session.js','style.css','hls.min.js'):raise HTTPException(404)
        return FileResponse(ASSETS/name)
    def issue_page(selected,can_start=True):
        if len(pages)>=64:raise HTTPException(429,'This test has reached its page limit.')
        access=secrets.token_urlsafe(32)
        pages[access]={'role':selected,'sequence':0,'canStart':can_start}
        return access

    def page_response(selected,access,ticket=None):
        response=JSONResponse({'role':selected,'pageAccess':access,'canStart':pages[access]['canStart'],
                               'instance':evidence.instance,'expiresAt':expires,
                               **({'recoveryTicket':ticket} if ticket else {})})
        if selected=='control':
            response.set_cookie('lab_preview',preview_token,path='/hls',httponly=True,secure=True,samesite='strict',max_age=max(1,int(expires-time.time())))
        return response

    def recovery_ticket():
        payload=base64.urlsafe_b64encode(json.dumps({'purpose':'control-resume-v1','expires':expires,'nonce':secrets.token_hex(16)},separators=(',',':')).encode()).decode().rstrip('=')
        return payload+'.'+hmac.new(master.encode(),('resume:'+payload).encode(),hashlib.sha256).hexdigest()

    @app.post('/resume-control')
    def resume_control(body:Resume):
        try:
            payload,signature=body.ticket.split('.')
            expected=hmac.new(master.encode(),('resume:'+payload).encode(),hashlib.sha256).hexdigest()
            if not hmac.compare_digest(signature,expected):raise ValueError()
            value=json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
            if value['purpose']!='control-resume-v1' or value['expires']!=expires or time.time()>=value['expires']:raise ValueError()
            nonce=value['nonce']
            if not isinstance(nonce,str) or not re.fullmatch(r'[0-9a-f]{32}',nonce):raise ValueError()
        except (ValueError,KeyError,TypeError):raise HTTPException(401,'Reopen your fresh private control link.') from None
        with ownership_lock:
            access=recovered_pages.get(nonce)
            if access is None:
                access=issue_page('control',can_start=False)
                recovered_pages[nonce]=access
        evidence.emit('control_resumed')
        return page_response('control',access)

    @app.post('/auth')
    def auth(body:Auth):
        selected=next((r for r,t in tokens.items() if hmac.compare_digest(t,body.token)),None)
        if not selected:raise HTTPException(401,'This private link is not valid.')
        with ownership_lock:
            access=issue_page(selected)
        return page_response(selected,access,recovery_ticket() if selected=='control' else None)
    @app.get('/status')
    def status(request:Request):
        return {'role':role(request),'canStart':page(request)['canStart'],'instance':evidence.instance,'expiresAt':expires,**lab.status()}
    @app.get('/build')
    def build(request:Request):
        control(request);return provenance
    @app.get('/links')
    def links(request:Request):
        control(request)
        if not page(request)['canStart']:raise HTTPException(403,'Recovered control cannot issue new camera links.')
        return {r:str(request.base_url)+'#'+tokens[r] for r in ('camera1','camera2')}
    @app.post('/start')
    def start(request:Request):
        control(request)
        if not page(request)['canStart']:raise HTTPException(403,'Recovered control cannot start a new test. Open a fresh private link.')
        lab.start();return lab.status()
    @app.post('/camera-claim')
    def claim(request:Request,body:Claim):
        with ownership_lock:
            selected=page(request)
            if selected['role'] not in ('camera1','camera2'):raise HTTPException(403)
            if lab.ended:raise HTTPException(409,'This test has finished.')
            if body.sequence<=selected['sequence']:raise HTTPException(409,'This camera attempt has been superseded.')
            selected['sequence']=body.sequence
            slot=int(selected['role'][-1])
            lab.detach(slot)
            connection=secrets.token_urlsafe(32)
            owners[slot]={'page':request.headers.get('x-lab-page'),'connectionId':connection}
            return {'connectionId':connection}
    @app.post('/camera-start')
    def camera_start(request:Request,body:Ownership):
        with ownership_lock:
            owned(request,body)
            if lab.ended:raise HTTPException(409,'This test has finished. Reopen a fresh test session to continue.')
            lab.start()
            return lab.status()
    @app.post('/stop')
    def stop(request:Request):
        control(request);lab.stop();return lab.status()
    @app.post('/score')
    def score(request:Request,body:Score):
        control(request)
        if lab.ended:raise HTTPException(409,'The test has finished.')
        text=f'TEAM RED  {body.red}     |     TEAM BLUE  {body.blue}'
        tmp=ROOT/'score.next';tmp.write_text(text);tmp.replace(ROOT/'score.txt')
        return {'saved':True}
    @app.post('/attach')
    def attach(request:Request,body:Attach):
        with ownership_lock:
            slot=owned(request,body)
            try:return lab.publish_browser(slot,body.offer,body.mid)
            except ValueError as exc:raise HTTPException(409,str(exc)) from None
            except Exception:raise HTTPException(502,'The camera service could not connect. Disconnect and try again.') from None
    @app.post('/receive')
    def receive(request:Request,body:Ownership):
        with ownership_lock:
            slot=owned(request,body)
            try:return lab.receive_browser(slot)
            except ValueError as exc:raise HTTPException(409,str(exc)) from None
            except Exception:raise HTTPException(502,'The cloud receiver could not connect. Disconnect and try again.') from None
    @app.post('/disconnect')
    def disconnect(request:Request,body:Ownership):
        with ownership_lock:
            slot=owned(request,body)
            del owners[slot]
            lab.detach(slot)
            return {'disconnected':True}
    @app.get('/hls/{name}')
    def hls(request:Request,name:str):
        if not hmac.compare_digest(request.cookies.get('lab_preview',''),preview_token):raise HTTPException(403)
        if not lab.status()['preview']:raise HTTPException(409,'Preview is not live.')
        if not re.fullmatch(r'(program\.m3u8|segment\d+-\d{5}\.ts)',name):raise HTTPException(404)
        path=ROOT/name
        if not path.is_file():raise HTTPException(404)
        return FileResponse(path,media_type='application/vnd.apple.mpegurl' if name.endswith('.m3u8') else 'video/mp2t')
    return app
