/* Isolated default-deny topology proof. No video, output, provider or profile. */
#include <windows.h>
#include <tlhelp32.h>
#include <sddl.h>
#include <bcrypt.h>
#include <obs.h>
#include <util/base.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>
#include "../m4-obs-validation/ipc-protocol.h"
#include "../m4-log-guard/m4-log-guard.h"
typedef bool (*attach_fn)(obs_service_t *, HANDLE, const unsigned char *, uint32_t);
static DWORD actual_parent(void)
{
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    PROCESSENTRY32W entry = {0}; DWORD parent = 0;
    if (snapshot == INVALID_HANDLE_VALUE) return 0;
    entry.dwSize = sizeof(entry);
    if (Process32FirstW(snapshot, &entry)) do {
        if (entry.th32ProcessID == GetCurrentProcessId()) { parent = entry.th32ParentProcessID; break; }
    } while (Process32NextW(snapshot, &entry));
    CloseHandle(snapshot); return parent;
}
static int local_path(const WCHAR *path)
{ return wcslen(path) > 3 && path[1] == L':' && (path[2] == L'\\' || path[2] == L'/'); }
int wmain(int argc, WCHAR **argv)
{
    HANDLE parent = NULL, token = NULL, pipe = INVALID_HANDLE_VALUE;
    TOKEN_USER *user = NULL; LPWSTR sid = NULL; PSECURITY_DESCRIPTOR descriptor = NULL;
    SECURITY_ATTRIBUTES acl = {sizeof(acl), NULL, FALSE};
    StudioBootstrap frame = {0}; WCHAR sddl[256], *end = NULL;
    DWORD parent_pid, size = 0, wrote = 0, got = 0;
    OVERLAPPED ov = {0}; obs_module_t *module = NULL; obs_service_t *service = NULL;
    HMODULE dll; attach_fn attach; bool initialized = false; int result = 1;
    char plugin[4096];
    if (argc != 7 || wcscmp(argv[1], L"--parent-pid") || wcscmp(argv[3], L"--plugin") ||
        wcscmp(argv[5], L"--runtime") || !local_path(argv[4]) || !local_path(argv[6])) return 2;
    parent_pid = wcstoul(argv[2], &end, 10);
    if (!parent_pid || *end || parent_pid != actual_parent()) return 2;
    parent = OpenProcess(SYNCHRONIZE, FALSE, parent_pid);
    if (!parent || WaitForSingleObject(parent, 0) != WAIT_TIMEOUT) goto done;
    if (!SetDllDirectoryW(argv[6]) || !WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[4], -1, plugin, sizeof(plugin), NULL, NULL)) goto done;
    m4_log_guard_install();
    if (!obs_startup("en-US", NULL, NULL)) goto done;
    initialized = true;
    if (obs_open_module(&module, plugin, ".") != MODULE_SUCCESS || !obs_init_module(module)) goto done;
    dll = GetModuleHandleW(argv[4]);
    if (!dll || GetProcAddress(dll, "m4_test_arm")) goto done;
    attach = (attach_fn)(void *)GetProcAddress(dll, "m4_attach_controller");
    if (!attach || !OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) goto done;
    GetTokenInformation(token, TokenUser, NULL, 0, &size);
    user = HeapAlloc(GetProcessHeap(), 0, size);
    if (!user || !GetTokenInformation(token, TokenUser, user, size, &size) || !ConvertSidToStringSidW(user->User.Sid, &sid)) goto done;
    swprintf_s(sddl, 256, L"D:P(A;;GA;;;%ls)", sid);
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, &descriptor, NULL)) goto done;
    acl.lpSecurityDescriptor = descriptor;
    frame.magic = 0x4d344253u; frame.version = 1;
    if (BCryptGenRandom(NULL, frame.token, sizeof(frame.token), BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0) goto done;
    swprintf_s(frame.pipe, 128, L"\\\\.\\pipe\\curlstreamer-m4-%lu-%llu", GetCurrentProcessId(), (unsigned long long)GetTickCount64());
    pipe = CreateNamedPipeW(frame.pipe, PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, 1, 4096, 4096, 0, &acl);
    if (pipe == INVALID_HANDLE_VALUE) goto done;
    service = obs_service_create("curlstreamer_m4_memory", "Default Studio topology proof", NULL, NULL);
    if (!service) goto done;
    if (!WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), &frame, sizeof(frame), &wrote, NULL) || wrote != sizeof(frame)) goto done;
    CloseHandle(GetStdHandle(STD_OUTPUT_HANDLE)); SetStdHandle(STD_OUTPUT_HANDLE, NULL);
    ov.hEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
    if (!ov.hEvent) goto done;
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
    if (!attach(service, pipe, frame.token, parent_pid)) goto done;
    pipe = INVALID_HANDLE_VALUE;
    SecureZeroMemory(&frame, sizeof(frame));
    /* This proof has no output and is bounded even if a controller is abandoned. */
    WaitForSingleObject(parent, 15000);
    result = 0;
done:
    SecureZeroMemory(&frame, sizeof(frame));
    if (ov.hEvent) CloseHandle(ov.hEvent);
    if (pipe != INVALID_HANDLE_VALUE) CloseHandle(pipe);
    if (service) obs_service_release(service);
    if (initialized) obs_shutdown();
    if (descriptor) LocalFree(descriptor);
    if (sid) LocalFree(sid);
    if (user) HeapFree(GetProcessHeap(), 0, user);
    if (token) CloseHandle(token);
    if (parent) CloseHandle(parent);
    return result;
}
