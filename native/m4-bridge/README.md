# M4 native IPC experiment

This is a standalone Windows C test harness, **not an OBS plugin or production bridge**. It never receives real credentials, connects to YouTube, or changes OBS. Sending and recording are explicitly simulated Boolean state. An unchanged recording Boolean is not evidence that OBS recording survives a streaming stop.

The parent creates a single-instance local named pipe with a protected DACL containing exactly the current user's SID and `PIPE_REJECT_REMOTE_CLIENTS`. It verifies the constructed DACL. A randomly generated 32-byte capability and separate random payload canary reach a child process through an anonymous inherited pipe. An explicit process handle allowlist restricts inheritance to that bootstrap pipe. Only the handle number appears in the command line. The child authenticates its frame with the capability; the server verifies the complete canary before accepting the simulated output. Neither value is printed or intentionally persisted. Buffers are cleared when the server stops.

The ACL alone does not distinguish trustworthy programs running as the same user. The bootstrap assumes the parent/child launch is already trusted; this is capability possession, not process attestation or a production pairing design. One fresh pipe and capability serve one connection. The wire format is a fixed Windows C struct for this experiment, not a portable or version-negotiated protocol.

Reads enforce exact byte counts, a 32-byte payload maximum, magic/version checks and an absolute `GetTickCount64` deadline. Partial reads consume the original deadline. After acceptance a 500 ms monotonic authority deadline stops simulated sending. Disconnect also stops it. This one-shot experiment has no authority renewal or other concurrent output work.

## Validation

On September 8, 2026, compiled with MSVC 19.51.36256.0 (toolset directory 14.51.36231), Windows SDK 10.0.26100.0, CMake 4.2.8 and MSBuild 18.9.1. Release x64 uses `/W4 /WX` and Control Flow Guard. CTest passed all seven child-process scenarios in 3.26 seconds:

- Accepted canary followed by monotonic lease expiry.
- Accepted canary followed by client handle closure.
- Accepted canary followed by actual controller process termination with `TerminateProcess`.
- Incorrect capability rejected before accepting the payload.
- Oversized declared payload rejected.
- Truncated payload followed by disconnect rejected.
- Connected client sending no frame rejected within the read deadline.

Every case asserts simulated sending is off, simulated recording is unchanged, and the server's payload buffer is zero after stopping. The harness prints scenario names and PASS/FAIL only. CTest imposes a 20-second process timeout. Build artifacts live outside the repository in `CurlStreamer-M1-setup/native-toolchain/m4-harness-build`.

The tested Release executable's SHA-256 is `5aec2c83d63ee259db1dbdb21c5162db4c10dd1a152efdab8370964c1513445c`.

## Remaining limits

No actual remote-host or different-user access attempt was executed; the tested facts are the configured OS flags, constructed ACL and authorized local child behavior. No OBS profile/save/switch/log/debug/crash-dump canary scan has run. This harness does not establish non-persistence in OBS, output cessation on a real encoder, or production IPC integration.

Cancellation calls `CancelIoEx` and waits for the pending operation to complete before releasing its stack-owned `OVERLAPPED`. A stuck OS cancellation could therefore block that thread. The external CTest timeout bounds the experiment, but this is **not an independently scheduled production watchdog**. The eventual plugin must isolate lease enforcement from IPC cancellation and invoke the actual streaming stop while preserving recording. Cleanup exits the harness process if the server thread fails to join rather than releasing memory still owned by that thread. Memory inspection, paging and crash dumps remain outside the containment claim.
