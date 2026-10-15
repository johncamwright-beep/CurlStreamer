# M4 local YouTube preparation

> Historical implementation notes. Runtime state, pending approvals and milestone status below are superseded by [current project state](PROJECT_STATE.md) and [rehearsal results](m4-controlled-rehearsal.md). Local paths are illustrative; private artifacts are not distributed.

## Node realtime relay and renderer adapter — September 8

Node now owns separate private realtime subscriptions for both camera roles. It renews tokens without exposing them, validates scoped events, deduplicates and bounds queues, and rechecks current authority before releasing events. Startup and cleanup are bounded, including never-ready subscriptions and late responses after close. The loopback bridge exposes sanitized connect metadata and event batches only. The renderer adapter uses the unchanged DirectPeer verifier and an independent verification watchdog.

Broad validation: 1,071 passed, 84 skipped. Thirteen focused relay checks cover mismatches, replay, renewal and lifecycle races; four renderer checks and four real local-HTTP bridge checks also pass. TypeScript and production build pass. Formatting remains 252 baseline files; full Playwright is blocked by occupied port 3000. These are software/mocked-realtime checks, not a live camera rehearsal.

Remaining: assemble the program canvas and trusted local-capability bootstrap into the recorder, proxy sponsor assets, and verify private browser cache/log behavior before physical-camera use. No hosted configuration or active OBS profile changed. See [program pipeline](m4-program-bridge.md).

## Restricted local program API — September 8

The Node program client now reads the fixed game's scoreboard/layout/sponsor projection with explicit validation and nested field allowlists. The private loopback bridge requires its owner capability, exact Host and same-origin context. It exposes only validated program data and check/signal/stop camera actions; no prepare, reassignment, general proxy, ticket endpoint or public authentication bootstrap exists. External sponsor URLs are withheld pending an asset proxy. Close revokes local access, aborts owned authority and fences late replies.

Twenty focused client/real-local-HTTP checks passed; broad tests passed 1,053 with 84 skipped. Standalone TypeScript passes, production build passes, full formatting remains 252 baseline files, and full Playwright is blocked by occupied port 3000. No native/media code or hosted configuration changed in this slice.

The local renderer, trusted provisioning of its local capability, Node-owned realtime subscription/event forwarding, and sponsor asset proxy are still unwired. This is an API foundation, not connected physical-camera evidence. Neither the invitation cookie nor realtime tickets are exposed through this bridge. Actual private camera/browser integration stays disabled until those remaining paths are connected and checked.

## Node program authority — September 8

Implemented `M4ProgramClient`: the one-use invitation is exchanged by Node, and its scoped M3 cookie remains in a private field. All requests use one fixed HTTPS game endpoint and canonical Origin, refuse redirects, cap response size and normalize errors. Cookie attributes and lifetime are checked; close aborts requests and fences late replies. An unpaired camera's 409 response does not discard the healthy camera's authority. The client cannot prepare or reassign cameras.

Eleven focused tests passed, including the independent-camera regression. Broad validation before that final regression: 1,043 passed, 84 skipped. TypeScript and build passed. Full Playwright remains blocked by occupied port 3000; formatting has baseline debt. No actual invitation exchange or hosted change occurred.

This is the private Node client, not completed camera integration. The fixed-game score/sponsor GET, authenticated loopback renderer, realtime subscription and sponsor-resource handling remain to be connected. Camera tickets contain scoped realtime tokens; retaining only the M3 cookie in Node does not establish credential-free CEF. Private browser invitations remain disabled.

## Browser program-source foundation — September 8

The recorder accepts a public loopback browser program through a bounded inherited input frame. Each browser instance requires a newly created isolated cache directory; source settings are not saved into an OBS profile. Full 1920x1080 rendering uses contain styling. Parent-loss monitoring starts before browser initialization, with a separate shutdown deadline.

The pinned runtime required GPU video conversion and software CEF rendering; other combinations produced black or corrupt recorded frames. The native public test pattern now passes decoded color checks. This is browser-rendering evidence, not physical-camera acceptance. Private invitation URLs remain rejected: cache, CEF logs, navigation and authenticated-program containment need verification before connecting actual cameras. Restricting the initial URL to loopback alone does not restrict subsequent redirects/subresources; only owned public fixtures are used.

Broad software checks: 1,033 passed, 84 skipped; TypeScript and production build passed. Full Playwright remains blocked by occupied port 3000. Formatting baseline remains separate from edited-file checks. Hosted migrations, M4 flags and the active OBS profile remain unchanged.

## Recorder process foundation — September 8

The native recorder now has a lifetime independent of the streaming host. A separate inherited application-close channel finalizes its MKV; stream Stop and lease expiry do not control it. It reserves a new destination, rejects overwrites, waits for the successful OBS stop signal, and reports forced shutdown as failure. The native deadline also works after parent death. Readiness channels are excluded from the spawned mux helper to avoid holding the startup handshake open.

This is explicitly **black video and silent audio**, not the physical-camera program. It is not exposed in the operator UI. Program-source integration and complete managed Studio lifecycle remain pending; both M4 streaming flags remain disabled.

Three real Node/native checks passed: recording growth and decoded finalization on explicit close; existing-file preservation; and decoded finalization after abrupt Node-parent exit. The reusable native library's recording/decode validation also passed. Broad unit tests passed (1,032, with 82 skipped before adding the separate parent-loss case), TypeScript and build passed. Full formatting still reports 252 baseline files; Playwright remains blocked by occupied port 3000. No hosted migration, real provider mutation, active OBS profile change or endurance run occurred.

Details: [recorder lifecycle](../native/m4-studio-recorder/README.md) and [media foundation](../native/m4-studio-media/README.md). Next: connect the real program source and managed application controls while preserving this recording lifetime.

Current September 8 update: provider-confirmed retirement and safe replacement cycles are implemented. Migration 0029 records owned-channel retirement only after independent resource checks; 0030 archives the old cycle, rotates its marker, advances generation and revokes old desktops before fresh preparation. Old output intents remain unusable. Validation: 1,032 broad unit tests passed (80 skipped), 28 actual local PostgreSQL retirement/replacement/delivery tests passed, and TypeScript/build passed. Full formatting retains baseline failures; full browser checks remain blocked by occupied port 3000. Hosted migrations 0025–0030 remain unapplied and both M4 flags remain disabled. Native RTMPS has isolated local evidence; production output-host, frontend recording/profile and real YouTube rehearsal remain pending. The entries below are historical; see [project state](PROJECT_STATE.md) for current status.

Status: **first implementation slice completed, 2026-09-08**. Server preparation/status/stop and durable local-OBS ownership are implemented and tested. Hosted configuration and desktop output integration are not complete. No actual YouTube resource requests or stream have occurred. Long rehearsals remain deferred to the user's combined final validation phase.

## Implemented boundary

`src/lib/providers/m4-youtube-session.ts` and `src/app/api/games/[id]/studio-m4/route.ts` implement authorized prepare/status/stop. Preparation journals creation intent before provider work, discovers or creates unlisted resources using durable markers, binds the resources and records an explicit prepared state. The operation lease ends at preparation; it is not held while awaiting a human or desktop encoder. Browser responses contain sanitized state/watch URL, never credentials or the ingest target.

The shared YouTube provider supports an explicit manual lifecycle for M4: automatic start/stop are disabled and discovered broadcasts must match the required manual, unlisted configuration. Legacy behavior remains the default for the preserved LiveKit path. Preparing M4 does not start OBS or transition YouTube live.

`supabase/migrations/0025_add_m4_local_broadcast_preparation.sql` keeps one durable YouTube journal per game and adds local-OBS transport ownership. Legacy and M4 operations cannot commandeer each other's rows. M4 operations use 30-second leases and generation/token fencing, preserve uncertain creation intents for discovery-based recovery, and reject late preparation after completion. Prepared resources retain the original channel credentials for cleanup. Stop retains resource identifiers in the journal for audit and idempotent recovery.

Authorized transport discovery routes legacy completion/deletion cleanup into M4 stop when the journal belongs to local OBS. This is server/provider cleanup dispatch; local encoder stop is not implemented yet. Ownership currently identifies the local transport and server preparation operation. A fixed authenticated desktop-session binding and encoder heartbeat/acknowledgment are still future work.

## Current setup state

- Migration 0025 is applied and tested only on the isolated local PostgreSQL copy. Hosted disposable project `example-pilot-project` remains through migration 0024.
- The pilot client ID, callback and independent vault encryption key are saved locally. The user created and saved a second client secret in the existing Google app. All four OAuth settings are present; the user confirmed the channel connected successfully. `CURLCAST_M4_LOCAL_YOUTUBE=disposable` is not enabled.
- The user chose the existing OAuth app, **CurlStreamer production**, in Google project **My First Project**. The pilot callback is saved alongside the production callback. The user confirmed the pilot channel connected after the HTTPS-loopback OAuth fix.
- No real provider creation, binding, transition or stream has been executed for M4. Unit/provider mocks are not live YouTube evidence.

## Remaining implementation

Add a separate authenticated desktop credential handoff before local output can start. The M3 Browser Source cookie and camera tokens must never receive stream-target authority. OAuth credentials remain server-only; the ingest destination must reach the local controller in memory, never browser responses, URLs, command arguments or diagnostics. Explicit RTMPS validation and OBS stream configuration/start remain outstanding.

Local confirmation must combine actual OBS output state with independent YouTube active-ingest evidence before declaring live. Local stop, provider completion and recovery must remain independently retryable, including after completion, WAN loss or process restart, while retaining local recording. A browser assertion does not prove encoder or provider state.

After hosted migration/configuration and the desktop boundary are ready, perform a short explicitly scoped unlisted rehearsal. Full-length rehearsal, endurance and cross-milestone failure drills remain deferred; implementation progress does not mark those gates passed.

## Validation evidence

- Broad software run: **762 tests passed; 44 database tests skipped**. The middleware HTTP test was excluded to avoid disturbing the running server.
- Separate actual local PostgreSQL validation: **four M4 integration tests and five unchanged legacy broadcast integration tests passed**. Coverage includes real concurrent claim transactions, lease expiry, uncertainty recovery, prepared idempotency, channel retention, organization/terminal fencing and legacy transport isolation.
- TypeScript and production build passed.
- Full repository formatting reported 256 existing failures; edited documentation is formatted separately.
- Full Playwright startup was blocked by port 3000 being in use. No browser tests ran in that attempt.

These results validate the first software/database slice, not a live YouTube broadcast, completed local encoder integration or endurance acceptance.

## OAuth proxy setup follow-up

All four pilot OAuth settings are present. The first origin fix handled HTTP loopback, but Next.js 15.5.25 reconstructs its internal request URL with the forwarded HTTPS protocol and the configured loopback hostname. The follow-up handles both HTTP and HTTPS loopback while keeping the configured public callback authoritative. The user confirmed Google channel authorization succeeded after the fix. This is account connection evidence, not evidence of ingest or streaming.

## Overnight software slice — 01:35 September 8

Added server-only youtube-ingest.ts: strictly validated primary RTMPS target with a separate key and independent provider ingest/health observation; 32 mock tests passed. Added m4-local-output.ts: one-shot injected controller core, bounded operations, lease expiry, uncertain start/stop reconciliation and redacted status; 11 mock tests passed including two independent-review race regressions. Neither module is wired to a live output or desktop credential route.

Broad unit validation: 821 passed, 44 database tests skipped, middleware HTTP test excluded. TypeScript and production build passed. Full formatting still fails on baseline files (253 file warnings plus summary); focused edited modules/docs formatted. Playwright cannot start because port3000 is in use; no E2E tests ran. No SQL changed in this slice and previous local PG results are not rerun claims.

Pinned OBS source confirms stock SetStreamServiceSettings persists keys and WebSocket debug logs can capture vendor payloads. Actual output needs a memory-only native service bridge and native watchdog. See m4-memory-output-bridge.md and m4-desktop-authority-design.md. Next autonomous step: implement desktop pairing/authority and stop-only fencing with local database tests, keeping target delivery/start disabled until native bridge containment is tested. Native compiler toolchain was not found in the initial standard locations; no installation attempted. Hosted0025 still pending; no actual provider creation or streaming.

## Desktop authority slice — 02:05 September 8

Implemented migration 0026, server provider and manager pairing / desktop exchange / heartbeat / stop routes. Approval binds a verifier challenge; exchange atomically consumes the code and issues a restricted random bearer, storing hashes only. Healthy sessions cannot be replaced; expired pre-target sessions get a new generation. Administrator access is rechecked during exchange and heartbeat. Completion fences sessions; the original bounded capability can still stop after expiry of its heartbeat or replacement. Explicit response allowlists and fixed errors exclude credentials from ordinary status responses. Only the restricted exchange returns its bearer.

No output-intent, stream target or start endpoint exists. These routes cannot attest native application identity. The native bridge and no-takeover rule after future target delivery remain required. Hosted migrations 0025 and 0026 remain unapplied; the M4 flag remains disabled. No OBS or YouTube provider operations occurred.

Validation: 862 broad unit tests passed, 50 database tests skipped (middleware HTTP excluded). Separately, six new actual local PostgreSQL authority tests and four prior M4 journal tests passed after applying 0026 to the isolated local copy; that database was stopped afterward. TypeScript and production build passed. Full formatting still reports 252 baseline files. Playwright is blocked by occupied port3000; no tests ran. The second chained YouTube E2E suite therefore did not run.

Next autonomous work: add an in-memory Node desktop pairing client and a manager approval UI that can exercise this restricted authority without starting output; keep stream-target delivery disabled. Establish a pinned native toolchain and canary harness before implementing the real memory-only OBS port. The morning user step remains a short explicitly scoped unlisted rehearsal only after hosted migrations, authorization UI and native containment are ready; do not ask for camera/endurance runs prematurely.

## Pairing client and approval screen — 02:32 September 8

Implemented Node-only M4DesktopClient with private in-memory verifier/bearer, fixed HTTPS requests that reject redirects, required HTTP Date, conservative monotonic lease deadlines, serialized heartbeat and immediate stop fencing. Twenty-one mock client tests pass. The guarded /studio-m4/[id]/pairing page checks manager access before showing the form and clears revoked/expired approvals. It does not show a false connected/live state. Three page-gating tests pass; the prior 28 authority route tests cover backend access. Actual browser layout and live pairing remain unverified.

scripts/m4-pair-desktop.mjs is an interactive authority proof. It prints only a public challenge and approval-page address; the one-use code is entered at a hidden terminal prompt. It stores no credentials, calls no OBS method and cannot start a broadcast. Its --help and real in-memory Node bundle/import smoke check pass. Do not run it against hosted infrastructure until 0025/0026 are applied and the pilot flag is deliberately enabled.

Latest validation: 886 broad tests passed, 50 database tests skipped, middleware HTTP excluded; TypeScript/build pass. Existing local PostgreSQL results remain valid historical evidence (no SQL changed in this slice). Full formatting reports252baselinefiles. E2E startup remains blocked by occupied port3000; no browser checks ran. No actual YouTube/OBS mutations or server restart occurred.

Native toolchain discovery is documented in m4-native-toolchain.md: no usable compiler, CMake or Windows SDK is installed in the inspected locations, and runtime OBS DLLs are not development dependencies. No installation was attempted. Native build/canary containment and process-death watchdog verification remain blockers for the real output bridge.

Next independent software work can bind a desktop session and generation to server output intent/quarantine, with target delivery still disabled. Do not add a plain stream-key browser response or stock OBS SetStreamServiceSettings as a shortcut. Before the morning rehearsal, establish the pinned native toolchain, build/verify the memory-only bridge, apply only approved disposable migrations, enable the pilot deliberately and perform one consolidated server restart. Long endurance remains deferred.

## Output quarantine slice and morning pause — 03:00 September 8

Migration0027, m4-output-intent provider and restricted claim route implemented. Intent binds immutable desktop session/generation and provider IDs/journal generation. Service-only delivery barrier is sticky: later lease expiry, client stop and completion cannot clear it or authorize replacement. No HTTP target/delivery/start API and no retirement API exist. Independent review found no concrete authorization, replay or quarantine escape.

925 broad software tests passed (50 database tests skipped at that invocation; middleware HTTP excluded). Separately all16related actual localPG tests passed after0027:6newquarantine+6desktop+4journal, including real delivery/replacement locking. TypeScript/buildpassed; format252baselinefiles; Playwrightblockedport3000, no testsran. LocalPGstopped; hostedthrough0024unchanged; flagdisabled; no realprovider/OBSmutations.

Overnight automation is PAUSED at the native build-tool setup boundary. M4 is not complete. Read MORNING_HANDOFF.md for the concrete resume sequence. Missing compiler/SDK and native canary/plugin validation prevent real memory-only output; no system-wide toolchain installer was run unattended. Once toolchain setup is established, continue the native bridge and once-only handoff/retirement work before any short rehearsal. Long endurance remains deferred.
