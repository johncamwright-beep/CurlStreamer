# M4 desktop authority design

Status: **pairing and lease authority implemented and locally tested**, 2026-09-08. Output intent, credential delivery and native integration remain planned. Migration 0026 and the restricted desktop routes implement pairing, exchange, heartbeat and stop-only authority; they do not implement a native output port or prove live YouTube output. The existing M4 local-output controller is an unconnected, dependency-injected, one-shot core exercised with a mock encoder. Migration 0025 preparation remains separate from the new desktop session history; output binding must be added before target delivery.

## Separate authority

Use a desktop capability independent of organizer tokens, camera claims and the M3 program cookie. Only a verified owner/team administrator or valid same-game organizer may approve pairing. A browser or source cookie must never acquire stream-target authority.

An append-only migration should add:

- Desktop sessions: immutable session ID, game/organization, monotonic generation, desktop public-key fingerprint, bearer-secret hash, state, absolute expiry, heartbeat deadline and revoked timestamp.
- Pairings: hashed random code, desktop verifier challenge/public key, fixed game/organization/session/generation, five-minute expiry and consumed timestamp.
- Output journal fields: fixed desktop session/generation, unique encoder intent ID, phase, target-delivery timestamp and cleanup disposition. Keep the provider-operation lease separate from the desktop heartbeat.

Store no raw bearer, stream key, OAuth credentials or SDP in these records. Suggested initial bounds are a four-hour absolute desktop capability, five-second heartbeat and thirty-second server lease. The local watchdog must use a shorter monotonic deadline with a measured stop margin; those timings remain to be validated.

## Pairing contract

1. The local helper generates an in-memory verifier/keypair and pairing request.
2. An authorized manager approves the exact desktop challenge for the game. Approval delivers no stream credentials.
3. The desktop exchanges the one-use code and verifier. One database transaction consumes the pairing and activates the fixed session. The restricted bearer is returned only to that authenticated exchange; the server retains only its hash.
4. Every subsequent desktop request revalidates the bearer, fixed session/generation, organization/game, lease, absolute expiry and operation phase.

A lost exchange response requires fresh pairing rather than storing/replaying the raw bearer. The protocol protects capability delivery; it cannot attest that a requester is genuine OBS through a user-agent header or desktop flag.

Proposed endpoints:

| Endpoint/action                                 | Purpose                                                         |
| ----------------------------------------------- | --------------------------------------------------------------- |
| Manager `POST /studio-m4/desktop-pairing`       | Approve a pending desktop challenge.                            |
| Desktop `POST /studio-m4/desktop/exchange`      | Consume pairing with verifier.                                  |
| Desktop `POST /studio-m4/desktop/heartbeat`     | Renew bounded lease; return desired action and safe state.      |
| Desktop `POST /studio-m4/desktop/output-intent` | Claim a fenced start operation with a unique intent ID.         |
| Desktop `POST /studio-m4/desktop/target`        | Deliver the RTMPS destination for that exact authorized intent. |
| Desktop `POST /studio-m4/desktop/observe`       | Submit bounded local observations, not proof of YouTube ingest. |
| Desktop `POST /studio-m4/desktop/stop`          | Stop/reconcile without implicitly restarting.                   |

Existing manager prepare/status/stop responses remain credential-free. Target delivery is a separate restricted channel, never a browser response, URL, command argument or diagnostics object.

## Output and confirmation

Persist the start intent before target delivery. After an ambiguous local/provider response, reconcile the same intent from actual output state; do not blindly repeat Start or create another output.

A real output port must keep destination credentials in memory. Stock OBS `SetStreamServiceSettings` persists configuration and must not implement that port. A native OBS integration/plugin and its secure memory lifecycle remain required work. Its interface must avoid returning target-bearing settings, raw errors or logs to application/browser status surfaces.

Local sending and remote live are different observations. Require actual local output evidence plus independent YouTube active-ingest evidence and the verified manual broadcast lifecycle before declaring live. A desktop acknowledgment alone is insufficient.

## Stop, crashes and takeover quarantine

Game completion must atomically fence preparation, new start and target delivery. Preserve a narrow, bounded stop-only capability for the original desktop so cleanup can be retried after completion; it must not renew start authority. Server provider cleanup remains independently retryable through authorized manager operations.

On heartbeat loss, stop streaming while retaining local recording. An unconfirmed OBS stop remains uncertain. A JavaScript controller timer cannot enforce this after its process dies while OBS continues running: **an independently running native OBS plugin watchdog is required**, plus startup reconciliation. Do not call the current controller core a production fail-stop guarantee.

**A delivered RTMPS key is not revoked by bearer expiry or generation fencing.** Therefore:

- Before target delivery, an expired desktop can be replaced.
- After target delivery, quarantine new starts and automatic takeover until the previous provider target is authoritatively retired/revoked and cleanup is confirmed.
- An expired bearer, a client “stopped” acknowledgment or briefly inactive ingest does not prove an old encoder cannot resume with retained credentials.
- For the smallest safe next slice, implement pairing, heartbeat and cleanup authority first; keep target delivery/start disabled until fencing and uncertain-output recovery are validated.

## Required failure evidence

Exercise concurrent exchanges, wrong verifier/game/organization, stale generations, a lost exchange response, completion during target delivery, heartbeat expiry while OBS survives, duplicate intents, delayed success and delayed rejection from Start, ambiguous provider transitions, and stop-only retries after completion. Confirm that a revoked in-flight observation cannot report sending and that every late start settlement triggers cleanup when revoked.

Physical/native watchdog and provider evidence remain necessary. Passing dependency-injected controller tests cannot prove authentication, process-death shutdown, memory-only credentials, YouTube ingest or endurance.

## Studio process ownership — September 8

The operator Node process owns pairing and keeps `M4DesktopClient` in memory. After pairing, `runM4StudioHost` launches its native OBS child with public absolute paths and the operator PID only. The native child checks that PID against its actual parent, creates a local SID-restricted named pipe, and emits the versioned 296-byte bootstrap over inherited stdout. Node consumes that private stream, connects and invokes the existing one-shot managed output lifetime. No bearer is copied into native bootstrap, a file, command arguments or environment.

This order keeps interactive approval outside the native unarmed connection deadline. Child environment contains only the pinned runtime search path and Windows startup settings. Early validation, spawn errors, bootstrap failure, cancellation and output failure all attempt desktop authority release. The native proof monitors its parent and also has a 15-second lifetime limit. Node closes the pipe and terminates only its owned child; shutdown confirmation is bounded.

The actual Node-parent/native-child test passed with the default-deny DLL and a simulated server: exactly one target handoff reached the native boundary, default ARM was rejected, and desktop release completed. The process host currently creates no video or output. This is launcher plumbing, not the final operator UI or production output engine.
