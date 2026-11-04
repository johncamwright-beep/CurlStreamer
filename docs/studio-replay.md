# Studio replay

Replay opens a private, muted preview of a fixed snapshot of the recent program.
The operator scrubs to a start point or selects 15, 30, 45 or 60 seconds, then
chooses Play Replay. Preparing or cancelling a preview does not interrupt live
output. Presets are disabled until that much footage exists.

The program retains its recorded camera layout, scoreboard and sponsors. A
moving REPLAY transition and quiet synthetic whoosh introduce playback; REPLAY
remains visible throughout. A LIVE transition returns to current live output.
Return Live interrupts a replay early. Pausing/ending the stream overrides replay.
Decoder error or playback deadline also returns live.

## Local implementation

- The pinned OBS replay buffer shares the existing program encoders. It retains
  up to 62 seconds (keyframe allowance), with a 64 MiB encoded buffer budget.
- Only the latest 60 seconds are selectable. A saved MP4 lives in the existing
  private, per-session cache and is removed during session cleanup.
- A native decoder plays the captured program. The original camera/browser
  source stays active and is muted only while replay audio is on air.
- The buffer stops during replay and starts fresh on return, preventing a replay
  from entering the next replay window. The UI shows the brief buffering period.
- The operator preview uses a game-scoped WebView resource handler. An
  authenticated loopback endpoint serves bounded byte ranges from one cached
  snapshot. No media or replay commands go to Supabase or YouTube APIs.
- New native commands require the `program-replay-v1` package capability and
  explicit `RPV1` readiness. Older Studio builds do not expose the control.
- Optional replay initialization failure leaves normal live output available.

## Validation

`native/m4-studio-recorder/replay-validation.mjs` runs the actual pinned OBS
recorder against a local synthetic browser source. It checks capture, playback,
automatic/manual return, recording continuity, decoded picture order and audio
frequency order. A second replay verifies that the buffer contains only new live
footage. It does not start an external broadcast.

The browser tests cover preview failure, fixed snapshot offsets, presets and
explicit Play/Return Live messages on desktop and mobile. The small WebM fixture
is synthetic FFmpeg testsrc video, generated at 320×180, 2 fps, 62 seconds using
libvpx-vp9 at 40 kbit/s. No customer recording is used.
