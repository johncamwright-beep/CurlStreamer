"""Build generic source-video foreground atlases; never reads a player's photo.
Uses the approved blade/core/flare mask and frame-74 foreground arm correction.
Run with the project Python runtime (Pillow/numpy) from the repository root.
"""
from PIL import Image, ImageDraw, ImageFilter
from collections import deque
import numpy as np, json, subprocess, pathlib
ROOT=pathlib.Path.cwd()
SOURCE=ROOT/'public/celebrations/lightsaber.mp4'
FF=ROOT/'work/ffmpeg/ffmpeg.exe'
BOUNDS=ROOT/'work/cameron-starwars/analysis/big-render-bounds.json'
OUT=ROOT/'public/celebrations'
W,H=1440,1080
reference=json.loads(BOUNDS.read_text())
reader=subprocess.Popen([str(FF),'-v','error','-i',str(SOURCE),'-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
sheets=[];sheet=Image.new('RGBA',(2048,2048));sx=sy=row_height=0
manifest=[]
for frame,bound in enumerate(reference):
 raw=reader.stdout.read(W*H*3)
 if len(raw)!=W*H*3:raise RuntimeError(f'Short source frame {frame}')
 src=np.frombuffer(raw,np.uint8).reshape(H,W,3)
 # Extra margin permits independently sized player cutouts around the same chin.
 x0=max(0,bound['x']-64);y0=max(0,bound['y']-64)
 x1=min(W,bound['x']+bound['width']+64);y1=min(H,bound['y']+bound['height']+64)
 roi=src[y0:y1,x0:x1].astype(np.float32)
 r,g,b=roi[:,:,0],roi[:,:,1],roi[:,:,2]
 green=np.clip((g-np.maximum(r,b)-12)/45,0,1)*np.clip((g-100)/70,0,1)
 red=np.clip((r-np.maximum(g,b)-75)/50,0,1)*np.clip((r-225)/25,0,1)
 white=np.clip((np.minimum(np.minimum(r,g),b)-200)/45,0,1)
 if np.mean(np.min(src,axis=2)>200)<.15:
  active=(green>.15)|(red>.15);candidate=active|(white>0)
  seen=active.copy();queue=deque(zip(*np.where(active)));rh,rw=active.shape
  while queue:
   yy,xx=queue.popleft()
   for ny,nx in ((yy-1,xx),(yy+1,xx),(yy,xx-1),(yy,xx+1)):
    if 0<=ny<rh and 0<=nx<rw and candidate[ny,nx] and not seen[ny,nx]:
     seen[ny,nx]=True;queue.append((ny,nx))
  white*=seen
 mask=np.maximum(np.maximum(green,red),white)
 mask=np.asarray(Image.fromarray(np.uint8(mask*255)).filter(ImageFilter.GaussianBlur(.7)))
 if frame==74:
  arm=Image.new('L',(W,H));ImageDraw.Draw(arm).polygon([(115,244),(170,180),(295,104),(397,80),(430,110),(405,149),(305,163),(240,226),(194,285),(140,290)],fill=255)
  mask=np.maximum(mask,np.asarray(arm.filter(ImageFilter.GaussianBlur(3)))[y0:y1,x0:x1])
 alpha=Image.fromarray(mask);bbox=alpha.getbbox()
 if not bbox:manifest.append(None);continue
 patch=Image.fromarray(src[y0:y1,x0:x1]).convert('RGBA');patch.putalpha(alpha);patch=patch.crop(bbox)
 width,height=patch.size
 if sx+width>2048:sx=0;sy+=row_height+2;row_height=0
 if sy+height>2048:
  sheets.append(sheet);sheet=Image.new('RGBA',(2048,2048));sx=sy=row_height=0
 sheet.paste(patch,(sx,sy))
 manifest.append(dict(sheet=len(sheets),x=sx,y=sy,width=width,height=height,sourceX=x0+bbox[0],sourceY=y0+bbox[1]))
 sx+=width+2;row_height=max(row_height,height)
 if frame%30==0:print(f'Foreground {frame}/185',flush=True)
sheets.append(sheet)
reader.stdout.close();reader.wait()
for index,image in enumerate(sheets):
 image.save(OUT/f'lightsaber-foreground-{index}.png',optimize=True)
(ROOT/'src/lib/lightsaber-foreground.json').write_text(json.dumps({'sheets':[f'/celebrations/lightsaber-foreground-{i}.png' for i in range(len(sheets))],'frames':manifest},separators=(',',':')))
print(f'Wrote {len(sheets)} generic foreground atlases',flush=True)
