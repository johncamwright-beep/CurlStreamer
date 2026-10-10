# M4 OBS memory service — validation slice

This module registers `curlstreamer_m4_memory` against the pinned OBS 32.2.2 API.
The default build cannot be armed. A separate artifact can enable the explicit
`M4_OBS_PRODUCTION_ADMISSION` build gate, which is OFF by default and incompatible
with either synthetic-test option. It admits only the exact
`rtmps://a.rtmps.youtube.com:443/live2` server, an ASCII `[A-Za-z0-9_-]{1,255}` key,
a 1–30000 ms remaining lease, a previously bound output and the existing
PID/SID/capability/sequence-authenticated controller. It exposes no test controls.
The recorder can bind its independent RTMP output before controller attachment
and poll a one-shot authorized-start entry point. It does not configure the
frontend or open a pipe. Default ARM remains denied. Public delivery still needs
the application's separate authorization gates and explicit controlled operation.

The service stores its synthetic destination in private immutable buffers, never
in OBS settings, logs, WebSocket messages, or process arguments. Its connection
callback returns separate server/key pointers only while authorized. Buffers are
wiped at final destruction, rather than on revocation while an OBS consumer may
still be copying a returned pointer. This is application-level containment, not
protection against memory inspection, paging, or crash dumps.

Initialization binds one weak output reference, or verifies the recorder's
previously bound output. A dedicated thread uses a
monotonic lease and repeatedly force-stops that output after revocation/expiry,
including a pending late activation. It never obtains or stops the frontend's
recording output. Deactivation is terminal; restarting or rearming requires a
new service. The watchdog is independent of IPC readers or the Node
controller. Its check interval is 20 ms; Windows scheduling is not a hard
real-time guarantee. Service destruction signals worker completion and waits,
except when synchronously invoked by the worker's own final output release.
Joinable worker handles remain tracked until module unload, which joins every
thread before returning so the DLL cannot be unmapped while a worker unwinds.
Each creation first reaps completed workers and joins them outside all state,
registry, and worker-list locks. At most eight concurrent service workers are
allowed; creation above that pilot limit returns no implementation. OBS retains
an inert placeholder service for that case; every callback handles its null
implementation safely and rejects connection. This bounds both active threads
and retained completed handles instead of accumulating handles until unload.

## Build

Use CMake 4.2+ with Visual Studio 18 2026 and the pinned development SDK:

```powershell
cmake -S native/m4-obs-plugin -B <outside-repository-build> -G "Visual Studio 18 2026" -A x64 -DOBS_SDK_ROOT=<obs-sdk-32.2.2>
cmake --build <outside-repository-build> --config Release
```

Both default and test builds compiled with MSVC 19.51 and `/W4 /WX`. SDK anonymous
union warnings are suppressed around the SDK include only. The default DLL was
checked with `dumpbin /exports`; it has no test control exports.

## Synthetic validation ABI

Build in a separate directory with `-DM4_OBS_TEST_API=ON`. Never distribute this
variant. It exports the following C ABI in addition to normal OBS module symbols:

```c
bool m4_test_arm(obs_service_t *, const char *server, const char *key, uint32_t lease_ms);
void m4_test_revoke(obs_service_t *);
uint32_t m4_test_state(obs_service_t *); /* 0 unarmed, 1 armed, 2 revoked */
```

Arm accepts only `rtmps://synthetic.invalid/live2`, a key beginning `m4-canary-`
shorter than 256 bytes, and a 1–30000 ms lease. It is one-shot. The module advertises
the `RTMP` protocol. A validation host should use a synthetic custom output that
does not open a network connection. Test controls hold no production credentials.

## Controller attachment

Both builds export `bool m4_attach_controller(obs_service_t *, HANDLE,
const unsigned char capability[32], uint32_t expected_client_pid)`. The trusted
host supplies a connected, duplex, overlapped server pipe with a SID-only DACL
and `PIPE_REJECT_REMOTE_CLIENTS`. Ownership transfers only when attachment returns
true. A fresh service permits only one attachment. The plugin verifies the server
end, expected client PID, asynchronous read/write access and SID-only DACL. Windows
does not expose the remote-rejection creation flag through the handle queries
used here, so setting that flag remains a trusted-host requirement.

After reading each header, the plugin impersonates the pipe client, compares its
user SID with the process user SID, and reverts before processing authority.
The header carries a 32-byte capability compared without early exit; the host must
generate it cryptographically and transfer it through a private bootstrap channel.
The protocol uses strict sequence numbers and exact opcode lengths. ARM accepts
only synthetic destinations in the test build; the default build denies ARM.
RENEW extends a still-live lease by at most 30 seconds. STOP, disconnect, malformed
frames, authorization failure and expiry revoke permanently. Normal responses
contain only sequence, acceptance and service state. STOP keeps the authenticated
channel available for read-only observations; no terminal state can rearm/renew.

The IPC worker permits an indefinitely idle attached controller before the
first header byte, then bounds each remaining header/payload/write transfer to two seconds and polls
shutdown every 20 ms. Partial reads are accumulated; cancellation is completed
before releasing the overlapped storage. No I/O runs under the service lock, and
the independent watchdog continues even if IPC stalls. Module unload joins both
workers before returning. These are cancellation budgets, not a hard bound on
Windows completing cancellation or scheduling the join; the worker retains its
overlapped storage until the kernel confirms completion. This is not yet a
provider-backed streaming integration.

## Recorder host ABI

`m4_bind_output(service, output)` binds one output that already has this service,
before attachment or authority. It grants no authority and cannot be repeated.
`m4_start_if_authorized(service)` requires authenticated attachment, a live lease
and a bound output. The host calls it on its serialized media thread. It attempts
OBS start once, outside the service lock; a failed start revokes the service.
The watchdog retains the bound weak reference before any start attempt, including
the interval in which a concurrent STOP races a pending output start. The service
initialize callback verifies output identity and is itself one-shot. Existing
validation-only hosts can still bind during initialize.

IPC ARM acknowledgement describes authority only. It does not certify output
activity or provider receipt. Bound outputs disable OBS automatic reconnect.
An output-start failure is terminal; no repeated start is possible.

Opcode 4, zero payload, returns exactly 32 bytes: the usual 16-byte reply,
`uint32 output` at offset 16 (0 idle, 1 connecting, 2 active, 3 stopped, 4 failed),
`uint32 failure` at 20 (0 none, 1 start rejected, 2 output error), and little-endian
`uint64 bytes` at 24, capped at JavaScript's maximum safe integer. Queries consume
sequence numbers but never extend a lease. Output observations use actual OBS
start/stop signals and activity/byte counters. Only the numeric stop code is
read; raw server error text is never inspected. Observations are point-in-time
local facts, not provider confirmation. Callback disconnection precedes service
destruction, outside State locks.

Required follow-up remains bounded shutdown behavior
with the actual network output, profile/frontend persistence checks, and eventual
provider-backed streaming. The independent libobs validation host documents its
own observed results; compiling this module alone proves none of those behaviors.
