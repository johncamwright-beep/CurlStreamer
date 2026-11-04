"""Expand user-supplied portrait footage into a square; no private photos are baked in."""
from PIL import Image
import pathlib, subprocess, math, sys
import numpy as np

root = pathlib.Path.cwd()
source = pathlib.Path(sys.argv[1])
ffmpeg = pathlib.Path(sys.argv[2])
target = root / 'public/celebrations/trump-dance.mp4'
reader = subprocess.Popen([str(ffmpeg), '-v', 'error', '-i', str(source), '-vf', 'scale=576:1024', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
writer = subprocess.Popen([str(ffmpeg), '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '1080x1080', '-r', '30', '-i', '-', '-i', str(source), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-threads', '4', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', str(target)], stdin=subprocess.PIPE)
y, x = np.mgrid[0:180, 0:180].astype(float)
for frame in range(290):
    raw = reader.stdout.read(576 * 1024 * 3)
    if len(raw) != 576 * 1024 * 3:
        raise RuntimeError('Incomplete source video')
    t = frame / 30
    background = np.zeros((180, 180, 3), dtype=float) + [9, 14, 34]
    # Smooth local light blooms: no hard white flashes or full-frame strobes.
    for side, color, phase in [(20, [10, 115, 160], 0), (160, [150, 20, 130], 2.2)]:
        cy = 90 + 54 * math.sin(t * 1.15 + phase)
        glow = np.exp(-((x-side)**2/1500 + (y-cy)**2/2300))
        pulse = .38 + .20 * (1 + math.sin(t * math.tau * 1.4 + phase))
        background += glow[:, :, None] * np.array(color) * pulse
        for line in range(4):
            band = np.exp(-((x - side - 10 * math.sin(t*.65+line))**2 / 8))
            sweep = np.exp(-((y - ((t*25+line*50) % 240 - 30))**2 / 340))
            background += (band*sweep)[:, :, None] * np.array(color) * .65
    canvas = Image.fromarray(np.clip(background,0,255).astype(np.uint8)).resize((1080,1080), Image.Resampling.BICUBIC)
    canvas.paste(Image.frombytes('RGB',(576,1024),raw),(252,28))
    writer.stdin.write(canvas.tobytes())
reader.stdout.close()
if reader.wait(): raise RuntimeError('Source decode failed')
writer.stdin.close()
if writer.wait(): raise RuntimeError('Square encode failed')
print(target)
