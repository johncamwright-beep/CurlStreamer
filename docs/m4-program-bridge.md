# M4 private program pipeline

The pipeline separates camera invitation and realtime authentication from the renderer. The managed bootstrap, two-camera recording and YouTube rehearsal have now been verified; see [current results](m4-controlled-rehearsal.md).

- `m4-program-client.ts` exchanges the existing one-use M3 invitation in Node, keeps its cookie private, validates the fixed game's projection and permits only scoped camera actions. It cannot prepare or reassign cameras.
- `m4-program-realtime.ts` owns one private subscription per camera and renews scoped tokens in Node. It validates identity, generation, expiry and sender, rechecks current server authority, and returns bounded signal events without the realtime token or topic.
- `m4-program-bridge.ts` serves a private loopback API and the compiled program renderer. The managed recorder receives only the root loopback URL; the first navigation atomically receives a process-lifetime HttpOnly capability. Program data, sanitized connection metadata and camera events are then available only with that capability and the required same-origin context. The capability is absent from the URL, DOM, renderer JavaScript and OBS profile data. External sponsor URLs remain withheld until asset proxying is ready.
- `m4-program-camera.ts` is the renderer-side adapter. It accepts a supplied local request function, rejects credential-bearing connection metadata, and uses the existing `DirectPeer` implementation without changing its direct-path checks. An independent watchdog stops a stalled or unverified connection.

The pipeline forwards WebRTC signaling because the renderer needs it to establish the direct media path. It does not claim that SDP is non-sensitive or that all browser state is memory-only. Invitation cookies and Supabase realtime tokens are specifically kept out of these renderer responses. No module logs raw signaling or credentials.

The renderer mounts the shared `ProgramCanvas`, polls the private projection and connects both cameras through the adapter. Node starts the bridge and recorder together and supplies private invitation/Supabase configuration. External sponsors use the bounded Node proxy described in the integration notes. Owned private cache cleanup follows recorder exit. Real physical-camera evidence exists; long endurance remains deferred.
