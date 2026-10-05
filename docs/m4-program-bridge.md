# M4 private program pipeline

The pipeline separates camera invitation and realtime authentication from the renderer. The managed bootstrap, two-camera recording and YouTube rehearsal have now been verified; see [current results](m4-controlled-rehearsal.md).

- `m4-program-client.ts` exchanges the existing one-use M3 invitation in Node, keeps its cookie private, validates the fixed game's projection and permits only scoped camera actions. It cannot prepare or reassign cameras.
- `m4-program-realtime.ts` owns one private subscription per camera and renews scoped tokens in Node. It validates identity, generation, expiry and sender, rechecks current server authority, and returns bounded signal events without the realtime token or topic.
- `m4-program-bridge.ts` serves a private loopback API and the compiled program renderer. The managed recorder receives only the root loopback URL; the first navigation atomically receives a process-lifetime HttpOnly capability. Program data, sanitized connection metadata and camera events are then available only with that capability and the required same-origin context. The capability is absent from the URL, DOM, renderer JavaScript and OBS profile data. External sponsor URLs remain withheld until asset proxying is ready.
- `m4-program-camera.ts` is the renderer-side adapter. It accepts a supplied local request function, rejects credential-bearing connection metadata, and uses the existing `DirectPeer` implementation without changing its direct-path checks. An independent watchdog stops a stalled or unverified connection.

The pipeline forwards WebRTC signaling because the renderer needs it to establish the direct media path. It does not claim that SDP is non-sensitive or that all browser state is memory-only. Invitation cookies and Supabase realtime tokens are specifically kept out of these renderer responses. No module logs raw signaling or credentials.

The renderer mounts the shared `ProgramCanvas`, polls the private projection and connects both cameras through the adapter. Node starts the bridge and recorder together and supplies private invitation/Supabase configuration. External sponsors use the bounded Node proxy described in the integration notes. Owned private cache cleanup follows recorder exit. Physical device endurance must be assessed separately from synthetic validation.

## Composed picture health and recovery

The October 5 freeze showed active IP capture workers and fresh OBS preview timestamps, but identical composed frames and stale camera observations. A running recorder or fresh raw callback does not prove that the browser picture is advancing. Renderer termination versus a hang was not established by the original logs.

The renderer now sends an independent, bounded heartbeat with its animation-frame counter. A small dark paint marker in the program corner alternates every half-second; the native raw-frame callback checks its actual pixels. Together these distinguish stalled JavaScript, stalled browser paint and a stalled preview request, including when cameras and sponsors legitimately show a static picture.

After startup grace, the program owner attempts a browser-source `refreshnocache` operation when heartbeat or paint progress is stale. Recovery is serial, has bounded command acknowledgements, and permits at most three refreshes in ten minutes. An accepted refresh is not recorded as recovered until heartbeat and native paint proof become fresh. The operation retains the recorder, recording file, encoders, stream output, broadcast link and IP receiver workers. It does not start YouTube. A failure beyond the retry limit requires operator troubleshooting.

Authenticated renderer reloads retain the existing HttpOnly capability and require document-navigation fetch headers. Image and CORS requests cannot reset the renderer. Every new document receives a public UUID epoch. Heartbeat, camera-frame and audio observations must match it; delayed reports from the retired document cannot restore its status. Second uncredentialed root navigations, owner-only health reports and cross-origin requests remain denied.

Connection diagnostics use the fixed `program` layer with `renderer_stale`, `paint_stale`, `refresh_requested`, `refresh_failed`, `recovery_exhausted` and `recovered` codes. No raw CEF errors, URLs, camera credentials or stream keys are logged. Capture-active tiles report that they are waiting for program video until actual renderer observations are fresh.

Game metadata requests have a three-second deadline. Each IP camera draws decoded frames into one reusable canvas and closes each ImageBitmap immediately after drawing. The canvas resizes only when frame dimensions change and is cleared and detached when its source ends. This avoids creating a new display image, blob URL and duplicate decode for every frame, while retaining the shared contain sizing and upright stacked landscape layout. Frame updates do not trigger per-frame React state changes.

The two-second camera attempt deadline also covers decoding. The browser decoder itself has no cancellation API: a late bitmap is closed without publishing, and outstanding decode work is bounded. The Windows picture-in-picture preview retries an image that has not completed after three seconds, retains the last good picture, and requests five frames per second instead of fifteen. This reduces preview copying by about two thirds without changing the 30 fps broadcast output or media sizing. Synthetic renderer endurance and physical camera/YouTube endurance are separate checks.
