/* Synthetic IPC experiment only. No OBS, network ingest, or real credentials. */
#include <windows.h>
#include <sddl.h>
#include <bcrypt.h>
#include <stdint.h>
#include <stdio.h>
#include <wchar.h>

enum { VALID_EXPIRY, DISCONNECT, PROCESS_DEATH, BAD_AUTH, OVERSIZE, TRUNCATED, STALLED, CASE_COUNT };
enum { STOP_EXPIRED = 1, STOP_DISCONNECTED, STOP_REJECTED, STOP_TIMEOUT };
typedef struct { WCHAR pipe[128]; BYTE token[32]; BYTE canary[32]; DWORD scenario; } Bootstrap;
typedef struct { DWORD magic; DWORD version; DWORD length; BYTE token[32]; } Header;
typedef struct {
    HANDLE pipe;
    HANDLE started;
    BYTE token[32];
    BYTE expected[32];
    BYTE secret[32];
    BOOL sending;
    BOOL recording;
    BOOL accepted;
    DWORD reason;
    ULONGLONG elapsed;
} Server;

static BOOL equal_secret(const BYTE *a, const BYTE *b, size_t n)
{
    volatile BYTE diff = 0;
    size_t i;
    for (i = 0; i < n; ++i) diff |= a[i] ^ b[i];
    return diff == 0;
}

/* Every read is bounded by an absolute monotonic deadline, including partial frames. */
static DWORD read_exact(HANDLE pipe, BYTE *dst, DWORD length, ULONGLONG deadline)
{
    DWORD total = 0;
    while (total < length) {
        OVERLAPPED ov = {0};
        DWORD got = 0, error, wait;
        ULONGLONG now = GetTickCount64();
        if (now >= deadline) return STOP_TIMEOUT;
        ov.hEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
        if (!ov.hEvent) return STOP_REJECTED;
        if (!ReadFile(pipe, dst + total, length - total, &got, &ov)) {
            error = GetLastError();
            if (error != ERROR_IO_PENDING) { CloseHandle(ov.hEvent); return STOP_DISCONNECTED; }
            wait = WaitForSingleObject(ov.hEvent, (DWORD)(deadline - now));
            if (wait != WAIT_OBJECT_0) {
                CancelIoEx(pipe, &ov);
                GetOverlappedResult(pipe, &ov, &got, TRUE);
                CloseHandle(ov.hEvent);
                return STOP_TIMEOUT;
            }
            if (!GetOverlappedResult(pipe, &ov, &got, FALSE)) {
                CloseHandle(ov.hEvent); return STOP_DISCONNECTED;
            }
        }
        CloseHandle(ov.hEvent);
        if (!got) return STOP_DISCONNECTED;
        total += got;
    }
    return 0;
}

static DWORD WINAPI serve(void *arg)
{
    Server *s = arg;
    Header h = {0};
    OVERLAPPED ov = {0};
    DWORD got = 0, result = 0;
    BYTE unexpected = 0;
    ULONGLONG began = GetTickCount64(), deadline;
    ov.hEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
    if (!ov.hEvent) { s->reason = STOP_REJECTED; return 0; }
    if (!ConnectNamedPipe(s->pipe, &ov)) {
        DWORD error = GetLastError();
        if (error == ERROR_IO_PENDING) {
            if (WaitForSingleObject(ov.hEvent, 2000) != WAIT_OBJECT_0) {
                CancelIoEx(s->pipe, &ov);
                GetOverlappedResult(s->pipe, &ov, &got, TRUE);
                result = STOP_TIMEOUT;
            } else if (!GetOverlappedResult(s->pipe, &ov, &got, FALSE)) result = STOP_REJECTED;
        } else if (error != ERROR_PIPE_CONNECTED) result = STOP_REJECTED;
    }
    CloseHandle(ov.hEvent);
    deadline = GetTickCount64() + 400;
    if (!result) result = read_exact(s->pipe, (BYTE *)&h, sizeof(h), deadline);
    if (!result && (h.magic != 0x4d344950 || h.version != 1 || h.length != sizeof(s->secret) ||
                    !equal_secret(h.token, s->token, sizeof(h.token)))) result = STOP_REJECTED;
    if (!result) result = read_exact(s->pipe, s->secret, sizeof(s->secret), deadline);
    if (!result && !equal_secret(s->secret, s->expected, sizeof(s->secret))) result = STOP_REJECTED;
    SecureZeroMemory(s->expected, sizeof(s->expected));
    SecureZeroMemory(&h, sizeof(h));
    SecureZeroMemory(s->token, sizeof(s->token));
    if (!result) {
        s->sending = TRUE;
        s->accepted = TRUE;
        SetEvent(s->started);
        /* A real plugin must connect this stop decision to its streaming output. */
        deadline = GetTickCount64() + 500;
        result = read_exact(s->pipe, &unexpected, 1, deadline);
        result = result == STOP_TIMEOUT ? STOP_EXPIRED : (result ? result : STOP_REJECTED);
    }
    s->sending = FALSE;
    SecureZeroMemory(s->secret, sizeof(s->secret));
    s->reason = result;
    s->elapsed = GetTickCount64() - began;
    DisconnectNamedPipe(s->pipe);
    return 0;
}

static int client(HANDLE bootstrap_pipe)
{
    Bootstrap b = {0};
    Header h = {0};
    HANDLE pipe;
    DWORD got = 0, wrote = 0;
    if (!ReadFile(bootstrap_pipe, &b, sizeof(b), &got, NULL) || got != sizeof(b)) return 2;
    CloseHandle(bootstrap_pipe);
    pipe = CreateFileW(b.pipe, GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
    if (pipe == INVALID_HANDLE_VALUE) return 3;
    h.magic = 0x4d344950; h.version = 1; h.length = sizeof(b.canary);
    CopyMemory(h.token, b.token, sizeof(h.token));
    if (b.scenario == BAD_AUTH) h.token[0] ^= 1;
    if (b.scenario == OVERSIZE) h.length = 0xffffffff;
    if (b.scenario == STALLED) { Sleep(1500); CloseHandle(pipe); return 0; }
    WriteFile(pipe, &h, sizeof(h), &wrote, NULL);
    if (b.scenario == TRUNCATED) WriteFile(pipe, b.canary, 4, &wrote, NULL);
    else WriteFile(pipe, b.canary, sizeof(b.canary), &wrote, NULL);
    SecureZeroMemory(&h, sizeof(h));
    SecureZeroMemory(b.token, sizeof(b.token));
    SecureZeroMemory(b.canary, sizeof(b.canary));
    if (b.scenario == PROCESS_DEATH || b.scenario == VALID_EXPIRY) Sleep(1500);
    CloseHandle(pipe);
    return 0;
}

static int run_case(DWORD scenario)
{
    static const WCHAR *names[] = {L"lease expiry", L"controller disconnect", L"controller killed", L"bad authentication", L"oversize frame", L"truncated frame", L"stalled frame"};
    HANDLE token = NULL, child_read = NULL, child_write = NULL, thread = NULL;
    DWORD size = 0, wrote = 0, result = 1;
    TOKEN_USER *user = NULL;
    LPWSTR sid = NULL;
    WCHAR sddl[256], exe[MAX_PATH], command[2 * MAX_PATH];
    PSECURITY_DESCRIPTOR descriptor = NULL;
    SECURITY_ATTRIBUTES acl = {sizeof(acl), NULL, FALSE};
    SECURITY_ATTRIBUTES inherited = {sizeof(inherited), NULL, TRUE};
    STARTUPINFOEXW start = {0};
    SIZE_T attribute_size = 0;
    BOOL attributes_initialized = FALSE;
    PROCESS_INFORMATION child = {0};
    Bootstrap b = {0};
    Server server = {0};
    BYTE zero[32] = {0};
    server.pipe = INVALID_HANDLE_VALUE;
    server.recording = TRUE;
    b.scenario = scenario;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) goto done;
    GetTokenInformation(token, TokenUser, NULL, 0, &size);
    user = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, size);
    if (!user || !GetTokenInformation(token, TokenUser, user, size, &size) || !ConvertSidToStringSidW(user->User.Sid, &sid)) goto done;
    /* Protected DACL: exactly this user's SID. No Everyone/network ACE. */
    swprintf_s(sddl, 256, L"D:P(A;;GA;;;%ls)", sid);
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, &descriptor, NULL)) goto done;
    {
        PACL dacl = NULL; BOOL present = FALSE, defaulted = FALSE; void *ace = NULL;
        if (!GetSecurityDescriptorDacl(descriptor, &present, &dacl, &defaulted) || !present || !dacl || dacl->AceCount != 1 ||
            !GetAce(dacl, 0, &ace) || ((ACE_HEADER *)ace)->AceType != ACCESS_ALLOWED_ACE_TYPE ||
            !EqualSid(&((ACCESS_ALLOWED_ACE *)ace)->SidStart, user->User.Sid)) goto done;
    }
    acl.lpSecurityDescriptor = descriptor;
    swprintf_s(b.pipe, 128, L"\\\\.\\pipe\\curlstreamer-m4-harness-%lu-%lu", GetCurrentProcessId(), scenario);
    server.pipe = CreateNamedPipeW(b.pipe, PIPE_ACCESS_INBOUND | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, 1, 128, 128, 0, &acl);
    if (server.pipe == INVALID_HANDLE_VALUE) goto done;
    if (BCryptGenRandom(NULL, b.token, sizeof(b.token), BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0 ||
        BCryptGenRandom(NULL, b.canary, sizeof(b.canary), BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0) goto done;
    CopyMemory(server.token, b.token, sizeof(b.token));
    CopyMemory(server.expected, b.canary, sizeof(b.canary));
    server.started = CreateEventW(NULL, TRUE, FALSE, NULL);
    if (!server.started || !CreatePipe(&child_read, &child_write, &inherited, 0) || !SetHandleInformation(child_write, HANDLE_FLAG_INHERIT, 0)) goto done;
    start.StartupInfo.cb = sizeof(start);
    InitializeProcThreadAttributeList(NULL, 1, 0, &attribute_size);
    start.lpAttributeList = HeapAlloc(GetProcessHeap(), 0, attribute_size);
    if (!start.lpAttributeList || !InitializeProcThreadAttributeList(start.lpAttributeList, 1, 0, &attribute_size)) goto done;
    attributes_initialized = TRUE;
    if (!UpdateProcThreadAttribute(start.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, &child_read, sizeof(child_read), NULL, NULL)) goto done;
    GetModuleFileNameW(NULL, exe, MAX_PATH);
    /* Only an inherited handle number is in argv, never a token or destination. */
    swprintf_s(command, 2 * MAX_PATH, L"\"%ls\" --client %llu", exe, (unsigned long long)(uintptr_t)child_read);
    thread = CreateThread(NULL, 0, serve, &server, 0, NULL);
    if (!thread || !CreateProcessW(exe, command, NULL, NULL, TRUE, EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW, NULL, NULL, &start.StartupInfo, &child)) goto done;
    CloseHandle(child_read); child_read = NULL;
    if (!WriteFile(child_write, &b, sizeof(b), &wrote, NULL) || wrote != sizeof(b)) goto done;
    SecureZeroMemory(&b, sizeof(b));
    CloseHandle(child_write); child_write = NULL;
    if (scenario == PROCESS_DEATH) {
        if (WaitForSingleObject(server.started, 2000) != WAIT_OBJECT_0 || !TerminateProcess(child.hProcess, 91)) goto done;
    }
    if (WaitForSingleObject(thread, 3500) != WAIT_OBJECT_0) goto done;
    if (server.sending || !server.recording || !equal_secret(server.secret, zero, sizeof(zero))) goto done;
    if (scenario <= PROCESS_DEATH && !server.accepted) goto done;
    if (scenario > PROCESS_DEATH && server.accepted) goto done;
    if (scenario == VALID_EXPIRY && (server.reason != STOP_EXPIRED || server.elapsed < 450 || server.elapsed > 1800)) goto done;
    if ((scenario == DISCONNECT || scenario == PROCESS_DEATH) && server.reason != STOP_DISCONNECTED) goto done;
    if ((scenario == BAD_AUTH || scenario == OVERSIZE) && server.reason != STOP_REJECTED) goto done;
    if (scenario == TRUNCATED && server.reason != STOP_DISCONNECTED) goto done;
    if (scenario == STALLED && (server.reason != STOP_TIMEOUT || server.elapsed > 1400)) goto done;
    result = 0;
done:
    if (child.hProcess) { if (WaitForSingleObject(child.hProcess, 2000) == WAIT_TIMEOUT) TerminateProcess(child.hProcess, 92); CloseHandle(child.hProcess); CloseHandle(child.hThread); }
    if (thread) {
        if (WaitForSingleObject(thread, 4000) != WAIT_OBJECT_0) ExitProcess(93);
        CloseHandle(thread);
    }
    if (server.pipe != INVALID_HANDLE_VALUE) CloseHandle(server.pipe);
    if (server.started) CloseHandle(server.started);
    if (child_read) CloseHandle(child_read);
    if (child_write) CloseHandle(child_write);
    if (start.lpAttributeList) {
        if (attributes_initialized) DeleteProcThreadAttributeList(start.lpAttributeList);
        HeapFree(GetProcessHeap(), 0, start.lpAttributeList);
    }
    if (descriptor) LocalFree(descriptor);
    if (sid) LocalFree(sid);
    if (user) HeapFree(GetProcessHeap(), 0, user);
    if (token) CloseHandle(token);
    SecureZeroMemory(&b, sizeof(b)); SecureZeroMemory(&server, sizeof(server));
    wprintf(L"%ls: %ls\n", names[scenario], result ? L"FAIL" : L"PASS");
    return (int)result;
}

int wmain(int argc, WCHAR **argv)
{
    DWORD i; int failures = 0;
    if (argc == 3 && wcscmp(argv[1], L"--client") == 0) return client((HANDLE)(uintptr_t)_wcstoui64(argv[2], NULL, 10));
    if (argc != 1) return 2;
    for (i = 0; i < CASE_COUNT; ++i) failures += run_case(i);
    return failures ? 1 : 0;
}
