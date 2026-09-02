# Rink test plan

## Setup and acceptance

Use two physical, vertically mounted camera phones on opposite glass and one scoring phone with DJI Mic 3 receiver/four transmitters. Put devices on independent combinations of rink Wi-Fi and cellular. Confirm permissions, rear 720×1280 tracks, zero camera audio tracks, scorer zero video tracks, framing, level, battery/power, role collision, late join, and program safe areas at 1920×1080.

## Two-to-three-hour soak (target 150 minutes)

- Stream and score a representative 8/10-end game. Every 10 minutes record battery, thermals, quality, A/V continuity, latency, and egress/YouTube health.
- At least 20 times enter/leave both sponsor styles, navigate/pause the carousel, and verify neither camera disconnects nor restarts. Confirm privacy mute and immediate restoration of the exact prior audio state every time.
- Cycle one camera network, background/foreground phones, join one camera late, unplug/reconnect DJI, refresh scorer during a sponsor break, and disconnect scorer long enough to exercise the safety timeout. Scoring must remain usable during audio failure.
- Upload mixed transparent/wide/tall images on slow service and one corrupt/oversized file. Verify partial success, no crop, failed-image skip, order, disable/remove/rotate, and cross-view timing.
- Stop requires confirmation; repeat start/stop requests and simulate egress/RTMP failure. Record raw times and user-facing messages.

Pass only with upright complete feeds, synchronized state, no unintended audio, no track teardown during sponsor mode, and no unrecovered disconnect. Hardware execution remains required before pilot release.
