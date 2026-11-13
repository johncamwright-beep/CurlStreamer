#include "stream-bootstrap.h"
#include "../m4-obs-validation/ipc-protocol.h"
#include <sddl.h>
#include <bcrypt.h>
#include <stdio.h>

bool m4_recorder_stream_bootstrap(m4_media *media, HANDLE output, HANDLE parent, DWORD parent_pid)
{
    HANDLE token = NULL, pipe = INVALID_HANDLE_VALUE;
    TOKEN_USER *user = NULL; LPWSTR sid = NULL; PSECURITY_DESCRIPTOR descriptor = NULL;
    SECURITY_ATTRIBUTES acl = {sizeof(acl), NULL, FALSE};
    StudioBootstrap frame = {0}; WCHAR sddl[256];
    DWORD size = 0, wrote = 0, got = 0; OVERLAPPED ov = {0}; bool ready = false;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) goto done;
    GetTokenInformation(token, TokenUser, NULL, 0, &size);
    user = HeapAlloc(GetProcessHeap(), 0, size);
    if (!user || !GetTokenInformation(token, TokenUser, user, size, &size) ||
        !ConvertSidToStringSidW(user->User.Sid, &sid)) goto done;
    if (swprintf_s(sddl, 256, L"D:P(A;;GA;;;%ls)", sid) < 0 ||
        !ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, &descriptor, NULL)) goto done;
    acl.lpSecurityDescriptor = descriptor;
    frame.magic = 0x4d344253u; frame.version = 1;
    if (BCryptGenRandom(NULL, frame.token, sizeof(frame.token), BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0) goto done;
    if (swprintf_s(frame.pipe, 128, L"\\\\.\\pipe\\curlstreamer-m4-%lu-%llu", GetCurrentProcessId(),
        (unsigned long long)GetTickCount64()) < 0) goto done;
    pipe = CreateNamedPipeW(frame.pipe, PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, 1, 4096, 4096, 0, &acl);
    if (pipe == INVALID_HANDLE_VALUE) goto done;
    ov.hEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
    if (!ov.hEvent) goto done;
    if (!WriteFile(output, &frame, sizeof(frame), &wrote, NULL) || wrote != sizeof(frame)) goto done;
    ready = true;
    // Close readiness before awaiting attach: Node validates frame and EOF.
    CloseHandle(output); output = NULL;
    if (!ConnectNamedPipe(pipe, &ov)) {
        DWORD error = GetLastError();
        if (error == ERROR_IO_PENDING) {
            HANDLE waits[2] = {parent, ov.hEvent};
            if (WaitForMultipleObjects(2, waits, FALSE, 5000) != WAIT_OBJECT_0 + 1) {
                CancelIoEx(pipe, &ov); GetOverlappedResult(pipe, &ov, &got, TRUE); goto done;
            }
            if (!GetOverlappedResult(pipe, &ov, &got, FALSE)) goto done;
        } else if (error != ERROR_PIPE_CONNECTED) goto done;
    }
    if (m4_media_attach_stream(media, pipe, frame.token, parent_pid)) pipe = INVALID_HANDLE_VALUE;
done:
    SecureZeroMemory(&frame, sizeof(frame));
    if (output) CloseHandle(output);
    if (ov.hEvent) CloseHandle(ov.hEvent);
    if (pipe != INVALID_HANDLE_VALUE) CloseHandle(pipe);
    if (descriptor) LocalFree(descriptor);
    if (sid) LocalFree(sid);
    if (user) HeapFree(GetProcessHeap(), 0, user);
    if (token) CloseHandle(token);
    return ready;
}
