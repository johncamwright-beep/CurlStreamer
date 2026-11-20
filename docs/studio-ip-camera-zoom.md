# IP camera zoom in Studio

Each Tapo or other RTSP camera has independent **digital zoom** controls below the program preview, with minus, plus, a 0.1–4× slider, and **Reset 1×**. Studio pilot.61 adds zoom below 1×. Older Windows builds offer their supported 1–4× range.

At 1×, Studio uses the selected layout. Portrait mode fills the tall slot, while Auto and Stacked contain the image. Reducing zoom reveals more of the camera frame and adds black space above and below the picture. Increasing zoom magnifies the picture. The same framing supplies Studio's preview, recording, and YouTube output. Scores and sponsor images keep their existing size.

Confirmed zoom is saved with the encrypted camera preferences and restored when Studio opens another game. Automatic recovery and Disconnect/Connect preserve it. Configuring a replacement source resets its zoom to 1×.

The web controls send a correlated native message scoped to the running game, camera role, and source generation. The authenticated loopback operator validates the zoom range and source before accepting it. Stale requests cannot change a replacement camera. Camera credentials remain outside the web controls and safe snapshots.

Validation covers independent values, stale and invalid commands, origin/cookie boundaries, queued controls, slider/reset behavior, native message validation, and actual rendered pixels before zoom, at 2×, and after reset. The browser test also verifies that video advances, source generation stays unchanged, and the second camera and sponsor artwork keep their full frame. Physical camera acceptance remains a separate check after installation.
