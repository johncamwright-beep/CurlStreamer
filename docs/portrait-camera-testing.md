# Portrait camera testing

Test on current physical iPhone Safari and Android Chrome over HTTPS; emulation is insufficient. Mount each phone vertically, select every exposed rear lens, and inspect `MediaStreamTrack.getSettings()`, intrinsic `videoWidth/videoHeight`, and LiveKit subscriber dimensions after device rotation/reconnect. Confirm the requested 720×1280, 30 fps, 9:16 constraints degrade gracefully.

Verify the complete top/bottom frame remains visible with `object-fit: contain`, house/framing guides align, landscape warning follows physical orientation, no audio track exists, wake lock behavior is explained, and switching Wi-Fi/cellular reconnects. Record devices/OS/browser versions and screenshots. Feed received tracks through Web Egress and confirm metadata normalization keeps both upright; do not approve production from CSS simulations alone.
