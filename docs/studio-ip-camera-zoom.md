# IP camera zoom in Studio

Each Tapo or other RTSP camera has independent **digital zoom** controls below the program preview: minus, plus, a 1–4× slider, and **Reset 1×**. Phone cameras retain their existing hardware zoom controls.

At 1×, Studio contains the complete camera image in its original aspect ratio. Increasing digital zoom magnifies the center of that camera's picture. The same composition supplies Studio's preview, recording, and YouTube output; scores and sponsor images are unaffected. Zoom changes neither restart the camera decoder nor create a new connection.

Zoom is retained through automatic recovery and the Reconnect camera action within the current Studio session. Configuring a replacement source resets its zoom to 1×.

The web controls send a correlated native message scoped to the running game, camera role, and source generation. The authenticated loopback operator validates the zoom range and source before accepting it. Stale requests cannot change a replacement camera. Camera credentials remain outside the web controls and safe snapshots.

Validation covers independent values, stale and invalid commands, origin/cookie boundaries, queued controls, slider/reset behavior, native message validation, and actual rendered pixels before zoom, at 2×, and after reset. The browser test also verifies that video advances, source generation stays unchanged, and the second camera and sponsor artwork keep their full frame. Physical camera acceptance remains a separate check after installation.
