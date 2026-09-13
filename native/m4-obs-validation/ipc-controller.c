/* Synthetic controller. Capability and key arrive only through inherited pipe. */
#include "ipc-protocol.h"
#include <wchar.h>
#include <string.h>
#include <stdlib.h>
static int send_frame(HANDLE pipe, IpcHeader *header, void *payload, DWORD length)
{
    DWORD wrote, got;
    IpcReply reply;
    if (!WriteFile(pipe, header, sizeof(*header), &wrote, NULL) || wrote != sizeof(*header)) return 0;
    if (length && (!WriteFile(pipe, payload, length, &wrote, NULL) || wrote != length)) return 0;
    if (!ReadFile(pipe, &reply, sizeof(reply), &got, NULL) || got != sizeof(reply)) return 0;
    return reply.magic == M4_IPC_MAGIC && reply.sequence == header->sequence && reply.status == 0;
}
static int observe(HANDLE pipe, IpcHeader *header, uint32_t expected_authority, uint32_t expected_output)
{
    DWORD wrote, got; IpcObservation reply;
    header->opcode = 4; header->length = 0; ++header->sequence;
    if (!WriteFile(pipe, header, sizeof(*header), &wrote, NULL) || wrote != sizeof(*header) ||
        !ReadFile(pipe, &reply, sizeof(reply), &got, NULL) || got != sizeof(reply)) return 0;
    return reply.reply.magic == M4_IPC_MAGIC && reply.reply.sequence == header->sequence &&
        reply.reply.status == 0 && reply.reply.state == expected_authority && reply.output == expected_output &&
        reply.bytes <= 9007199254740991ULL;
}
int wmain(int argc, WCHAR **argv)
{
    IpcBootstrap b = {0}; IpcHeader h = {0}; IpcArm arm = {0};
    HANDLE bootstrap = NULL, pipe = INVALID_HANDLE_VALUE; DWORD got; int result = 0;
    if (argc != 2) return 2;
    bootstrap = (HANDLE)(uintptr_t)_wcstoui64(argv[1], NULL, 10);
    if (!ReadFile(bootstrap, &b, sizeof(b), &got, NULL) || got != sizeof(b)) { result = 3; goto cleanup; }
    CloseHandle(bootstrap); bootstrap = NULL;
    pipe = CreateFileW(b.pipe, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING, SECURITY_SQOS_PRESENT | SECURITY_IMPERSONATION, NULL);
    if (pipe == INVALID_HANDLE_VALUE) { result = 4; goto cleanup; }
    h.magic = M4_IPC_MAGIC; h.version = 1; h.opcode = 1; h.length = sizeof(arm); h.sequence = 1;
    memcpy(h.token, b.token, sizeof(h.token));
    arm.lease_ms = 1000;
    strcpy_s(arm.server, sizeof(arm.server), "rtmps://synthetic.invalid/live2");
    strcpy_s(arm.key, sizeof(arm.key), b.canary);
    if (b.scenario >= IPC_PRODUCTION_ARM) strcpy_s(arm.server, sizeof(arm.server), "rtmps://a.rtmps.youtube.com:443/live2");
    if (b.scenario == IPC_PRODUCTION_BAD_KEY) strcpy_s(arm.key, sizeof(arm.key), "invalid/key");
    if (b.scenario == IPC_PRODUCTION_BAD_URL) strcpy_s(arm.server, sizeof(arm.server), "rtmps://a.rtmps.youtube.com.evil.invalid:443/live2");
    if (b.scenario == IPC_PRODUCTION_BAD_LEASE) arm.lease_ms = 30001;
    SecureZeroMemory(b.token, sizeof(b.token)); SecureZeroMemory(b.canary, sizeof(b.canary));
    if (b.scenario == IPC_BAD_TOKEN) h.token[0] ^= 1;
    if (b.scenario == IPC_OVERSIZE) h.length = 0xffffffffu;
    if (!send_frame(pipe, &h, &arm, sizeof(arm))) goto cleanup;
    SecureZeroMemory(&arm, sizeof(arm));
    if (WaitForSingleObject((HANDLE)b.started, 4000) != WAIT_OBJECT_0) { result = 5; goto cleanup; }
    CloseHandle((HANDLE)b.started); b.started = 0;
    Sleep(200);
    if (b.scenario == IPC_DISCONNECT) goto cleanup;
    if (b.scenario == IPC_STOP) {
        if (!observe(pipe, &h, 1, 1)) { result = 6; goto cleanup; }
        h.opcode = 3; h.length = 0; ++h.sequence;
        send_frame(pipe, &h, NULL, 0);
        Sleep(1000);
        if (!observe(pipe, &h, 2, 3)) { result = 6; goto cleanup; }
    } else if (b.scenario == IPC_START_FAILURE) {
        if (!observe(pipe, &h, 2, 4)) { result = 6; goto cleanup; }
        goto cleanup;
    } else if (b.scenario == IPC_PRODUCTION_ARM) {
        if (!observe(pipe, &h, 1, 2)) { result = 6; goto cleanup; }
        h.opcode = 3; h.length = 0; ++h.sequence;
        if (!send_frame(pipe, &h, NULL, 0)) { result = 6; goto cleanup; }
        Sleep(100);
        if (!observe(pipe, &h, 2, 3)) { result = 6; goto cleanup; }
        goto cleanup;
    } else if (b.scenario == IPC_RENEW || b.scenario == IPC_REPLAY) {
        uint32_t lease = 1800;
        h.opcode = 2; h.length = 4; h.sequence = b.scenario == IPC_REPLAY ? 1 : 2;
        send_frame(pipe, &h, &lease, sizeof(lease));
    } else if (b.scenario == IPC_STALL) {
        DWORD wrote;
        h.opcode = 2; h.length = 4; h.sequence = 2;
        WriteFile(pipe, &h, 3, &wrote, NULL);
    }
    SecureZeroMemory(&h, sizeof(h));
    Sleep(3000);
cleanup:
    if (pipe != INVALID_HANDLE_VALUE) CloseHandle(pipe);
    if (bootstrap) CloseHandle(bootstrap);
    if (b.started) CloseHandle((HANDLE)b.started);
    SecureZeroMemory(&b, sizeof(b)); SecureZeroMemory(&h, sizeof(h)); SecureZeroMemory(&arm, sizeof(arm));
    return result;
}
