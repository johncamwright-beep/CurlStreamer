#include "ipc-protocol.h"
#include <sddl.h>
#include <bcrypt.h>
#include <stdio.h>
#include <wchar.h>
/* Validation launcher only. Construct a minimal Node environment rather than
 * inheriting preload/debug settings or credentials from the parent process. */
static int append_environment(WCHAR *block, size_t capacity, size_t *used,
    const WCHAR *name, const WCHAR *value)
{
    int count = swprintf_s(block + *used, capacity - *used, L"%ls=%ls", name, value);
    if (count < 0 || *used + (size_t)count + 2 > capacity) return 0;
    *used += (size_t)count + 1;
    block[*used] = L'\0';
    return 1;
}
static int node_environment(WCHAR *block, size_t capacity)
{
    WCHAR root[MAX_PATH], system[MAX_PATH], temporary[MAX_PATH], drive[3];
    UINT root_size = GetWindowsDirectoryW(root, MAX_PATH);
    UINT system_size = GetSystemDirectoryW(system, MAX_PATH);
    DWORD temp_size = GetTempPathW(MAX_PATH, temporary);
    size_t used = 0;
    if (!root_size || root_size >= MAX_PATH || !system_size || system_size >= MAX_PATH ||
        !temp_size || temp_size >= MAX_PATH || root[1] != L':') return 0;
    drive[0] = root[0]; drive[1] = L':'; drive[2] = L'\0';
    block[0] = L'\0';
    return append_environment(block, capacity, &used, L"PATH", system) &&
        append_environment(block, capacity, &used, L"SystemDrive", drive) &&
        append_environment(block, capacity, &used, L"SystemRoot", root) &&
        append_environment(block, capacity, &used, L"TEMP", temporary) &&
        append_environment(block, capacity, &used, L"TMP", temporary);
}
static int absolute_local_path(const WCHAR *path)
{
    return path && wcslen(path) >= 3 &&
        ((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z')) &&
        path[1] == L':' && (path[2] == L'\\' || path[2] == L'/');
}
void m4_close_controller(IpcController *c)
{
    if (c->job) CloseHandle(c->job); /* Kill only our controlled child. */
    if (c->process) { WaitForSingleObject(c->process, 3000); CloseHandle(c->process); }
    if (c->pipe && c->pipe != INVALID_HANDLE_VALUE) CloseHandle(c->pipe);
    if (c->started) CloseHandle(c->started);
    SecureZeroMemory(c, sizeof(*c));
}
int m4_launch_controller(IpcController *c, const WCHAR *exe, const WCHAR *node_script, const char *canary, uint32_t scenario, int studio_bootstrap)
{
    HANDLE token = NULL, read_boot = NULL, write_boot = NULL, null_output = NULL;
    DWORD size = 0, wrote, got; TOKEN_USER *user = NULL; LPWSTR sid = NULL;
    PSECURITY_DESCRIPTOR descriptor = NULL;
    SECURITY_ATTRIBUTES acl = {sizeof(acl), NULL, FALSE}, inherit = {sizeof(inherit), NULL, TRUE};
    WCHAR sddl[256], command[4096], environment[4096] = {0};
    IpcBootstrap b = {0}; StudioBootstrap studio = {0}; STARTUPINFOEXW start = {0}; PROCESS_INFORMATION child = {0};
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
    HANDLE handles[3]; SIZE_T bytes = 0, handle_count = 0; BOOL attributes_ready = FALSE;
    OVERLAPPED ov = {0}; int ok = 0;
    ZeroMemory(c, sizeof(*c));
    if (studio_bootstrap && !node_script) goto done;
    if (wcslen(exe) > 1023 || wcschr(exe, L'"') || (node_script && (wcslen(node_script) > 1023 || wcschr(node_script, L'"')))) goto done;
    if (node_script && (!absolute_local_path(exe) || !absolute_local_path(node_script) ||
        !node_environment(environment, 4096))) goto done;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) goto done;
    GetTokenInformation(token, TokenUser, NULL, 0, &size);
    user = HeapAlloc(GetProcessHeap(), 0, size);
    if (!user || !GetTokenInformation(token, TokenUser, user, size, &size) || !ConvertSidToStringSidW(user->User.Sid, &sid)) goto done;
    swprintf_s(sddl, 256, L"D:P(A;;GA;;;%ls)", sid);
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, &descriptor, NULL)) goto done;
    acl.lpSecurityDescriptor = descriptor;
    if (BCryptGenRandom(NULL, b.token, sizeof(b.token), BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0) goto done;
    memcpy(c->token, b.token, sizeof(b.token));
    swprintf_s(b.pipe, 128, L"\\\\.\\pipe\\curlstreamer-m4-%lu-%llu", GetCurrentProcessId(), (unsigned long long)GetTickCount64());
    if (!studio_bootstrap) { strcpy_s(b.canary, sizeof(b.canary), canary); b.scenario = scenario; }
    c->pipe = CreateNamedPipeW(b.pipe, PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, 1, 4096, 4096, 0, &acl);
    if (c->pipe == INVALID_HANDLE_VALUE) goto done;
    if (!studio_bootstrap) {
        c->started = CreateEventW(&inherit, TRUE, FALSE, NULL); b.started = (uintptr_t)c->started;
        if (!c->started) goto done;
    }
    if (!CreatePipe(&read_boot, &write_boot, &inherit, 0) || !SetHandleInformation(write_boot, HANDLE_FLAG_INHERIT, 0)) goto done;
    handles[handle_count++] = read_boot;
    if (c->started) handles[handle_count++] = c->started;
    start.StartupInfo.cb = sizeof(start);
    if (node_script) {
        null_output = CreateFileW(L"NUL", GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, &inherit, OPEN_EXISTING, 0, NULL);
        if (null_output == INVALID_HANDLE_VALUE) { null_output = NULL; goto done; }
        handles[handle_count++] = null_output;
        start.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        start.StartupInfo.hStdInput = read_boot;
        start.StartupInfo.hStdOutput = start.StartupInfo.hStdError = null_output;
    }
    InitializeProcThreadAttributeList(NULL, 1, 0, &bytes);
    start.lpAttributeList = HeapAlloc(GetProcessHeap(), 0, bytes);
    if (!start.lpAttributeList || !InitializeProcThreadAttributeList(start.lpAttributeList, 1, 0, &bytes)) goto done;
    attributes_ready = TRUE;
    if (!UpdateProcThreadAttribute(start.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handles, sizeof(HANDLE) * handle_count, NULL, NULL)) goto done;
    c->job = CreateJobObjectW(NULL, NULL); limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!c->job || !SetInformationJobObject(c->job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) goto done;
    if (node_script) swprintf_s(command, 4096, L"\"%ls\" \"%ls\"", exe, node_script);
    else swprintf_s(command, 4096, L"\"%ls\" %llu", exe, (unsigned long long)(uintptr_t)read_boot);
    if (!CreateProcessW(exe, command, NULL, NULL, TRUE, CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
        node_script ? environment : NULL, NULL, &start.StartupInfo, &child)) goto done;
    c->process = child.hProcess; c->pid = child.dwProcessId;
    if (!AssignProcessToJobObject(c->job, c->process)) { TerminateProcess(c->process, 90); goto done; }
    if (ResumeThread(child.hThread) == (DWORD)-1) goto done;
    CloseHandle(read_boot); read_boot = NULL;
    if (studio_bootstrap) {
        studio.magic = 0x4d344253u; studio.version = 1;
        memcpy(studio.pipe, b.pipe, sizeof(studio.pipe));
        memcpy(studio.token, b.token, sizeof(studio.token));
        if (!WriteFile(write_boot, &studio, sizeof(studio), &wrote, NULL) || wrote != sizeof(studio)) goto done;
        SecureZeroMemory(&studio, sizeof(studio));
    } else if (!WriteFile(write_boot, &b, sizeof(b), &wrote, NULL) || wrote != sizeof(b)) goto done;
    CloseHandle(write_boot); write_boot = NULL;
    ov.hEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
    if (!ov.hEvent) goto done;
    if (!ConnectNamedPipe(c->pipe, &ov)) {
        DWORD error = GetLastError();
        if (error == ERROR_IO_PENDING) {
            if (WaitForSingleObject(ov.hEvent, 3000) != WAIT_OBJECT_0) {
                CancelIoEx(c->pipe, &ov); GetOverlappedResult(c->pipe, &ov, &got, TRUE); goto done;
            }
            if (!GetOverlappedResult(c->pipe, &ov, &got, FALSE)) goto done;
        } else if (error != ERROR_PIPE_CONNECTED) goto done;
    }
    ok = 1;
done:
    if (null_output) CloseHandle(null_output);
    if (ov.hEvent) CloseHandle(ov.hEvent);
    if (child.hThread) CloseHandle(child.hThread);
    if (read_boot) CloseHandle(read_boot);
    if (write_boot) CloseHandle(write_boot);
    if (attributes_ready) DeleteProcThreadAttributeList(start.lpAttributeList);
    if (start.lpAttributeList) HeapFree(GetProcessHeap(), 0, start.lpAttributeList);
    if (descriptor) LocalFree(descriptor);
    if (sid) LocalFree(sid);
    if (user) HeapFree(GetProcessHeap(), 0, user);
    if (token) CloseHandle(token);
    SecureZeroMemory(&b, sizeof(b));
    SecureZeroMemory(&studio, sizeof(studio));
    if (!ok) m4_close_controller(c);
    return ok;
}
