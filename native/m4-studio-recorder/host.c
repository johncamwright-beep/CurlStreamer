/* Independent recording lifecycle; optional authenticated stream authority. */
#include <windows.h>
#include <tlhelp32.h>
#include <wchar.h>
#include <string.h>
#include "../m4-studio-media/m4-studio-media.h"
#include "stream-bootstrap.h"

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
static DWORD WINAPI shutdown_deadline(void *event)
{
    if (WaitForSingleObject((HANDLE)event, 8000) != WAIT_OBJECT_0) ExitProcess(3);
    return 0;
}
typedef struct parent_watch { HANDLE finished; HANDLE parent; } parent_watch;
static DWORD WINAPI parent_deadline(void *context)
{
    parent_watch *watch = context;
    HANDLE waits[2] = {watch->finished, watch->parent};
    if (WaitForMultipleObjects(2, waits, FALSE, INFINITE) != WAIT_OBJECT_0 &&
        WaitForSingleObject(watch->finished, 8000) != WAIT_OBJECT_0) ExitProcess(3);
    return 0;
}
static bool read_exact(HANDLE input, HANDLE parent, void *buffer, DWORD length, ULONGLONG deadline)
{
    DWORD total = 0;
    while (total < length && GetTickCount64() < deadline) {
        DWORD available = 0, got = 0;
        if (WaitForSingleObject(parent, 0) != WAIT_TIMEOUT ||
            !PeekNamedPipe(input, NULL, 0, NULL, &available, NULL)) return false;
        if (!available) { Sleep(10); continue; }
        DWORD take = available < length - total ? available : length - total;
        if (!ReadFile(input, (char *)buffer + total, take, &got, NULL) || !got) return false;
        total += got;
    }
    return total == length;
}
int wmain(int argc, WCHAR **argv)
{
    WCHAR *end = NULL; DWORD pid, written, available;
    HANDLE parent = NULL, input = GetStdHandle(STD_INPUT_HANDLE), output = GetStdHandle(STD_OUTPUT_HANDLE);
    parent_watch watch = {0}; HANDLE monitor = NULL;
    m4_media *media = NULL; int result = 1; char program[256] = {0};
    const WCHAR *stream_plugin = NULL;
    if (argc >= 3 && !wcscmp(argv[argc - 2], L"--stream-plugin")) {
        stream_plugin = argv[argc - 1]; argc -= 2;
    }
    if ((argc != 7 && argc != 11) || wcscmp(argv[1], L"--parent-pid") ||
        wcscmp(argv[3], L"--runtime") || wcscmp(argv[5], L"--recording")) return 2;
    if (argc == 11 && (wcscmp(argv[7], L"--program-cache") ||
        wcscmp(argv[9], L"--webrtc-ip-handling-policy=default") ||
        wcscmp(argv[10], L"--disable-features=WebRtcHideLocalIpsWithMdns"))) return 2;
    pid = wcstoul(argv[2], &end, 10);
    if (!pid || *end || pid != actual_parent() || GetFileType(input) != FILE_TYPE_PIPE) return 2;
    parent = OpenProcess(SYNCHRONIZE, FALSE, pid);
    if (!parent || WaitForSingleObject(parent, 0) != WAIT_TIMEOUT) goto done;
    watch.parent = parent; watch.finished = CreateEventW(NULL, TRUE, FALSE, NULL);
    if (!watch.finished || !(monitor = CreateThread(NULL, 0, parent_deadline, &watch, 0, NULL))) goto done;
    /* The mux helper must not inherit the lifecycle or readiness channels. */
    if (!SetHandleInformation(input, HANDLE_FLAG_INHERIT, 0) ||
        !SetHandleInformation(output, HANDLE_FLAG_INHERIT, 0)) goto done;
    SetStdHandle(STD_INPUT_HANDLE, NULL); SetStdHandle(STD_OUTPUT_HANDLE, NULL);
    if (argc == 11) {
        DWORD length = 0; ULONGLONG deadline = GetTickCount64() + 5000;
        if (!read_exact(input, parent, &length, 4, deadline) || !length || length >= sizeof(program) ||
            !read_exact(input, parent, program, length, deadline) || memchr(program, 0, length)) goto done;
        if (!m4_media_initialize_program(argv[4], argv[6], argv[8], program, &media)) goto done;
        SecureZeroMemory(program, sizeof(program));
    } else if (!m4_media_initialize(argv[4], argv[6], &media)) goto done;
    if (stream_plugin && !m4_media_prepare_stream(media, argv[4], stream_plugin)) goto done;
    if (!m4_media_start(media)) goto done;
    {
        ULONGLONG deadline = GetTickCount64() + 5000;
        while (m4_media_active(media) && m4_media_bytes(media) == 0 && GetTickCount64() < deadline) {
            if (WaitForSingleObject(parent, 50) != WAIT_TIMEOUT ||
                !PeekNamedPipe(input, NULL, 0, NULL, &available, NULL) || available) goto done;
        }
        if (!m4_media_active(media) || !m4_media_bytes(media)) goto done;
    }
    if (!WriteFile(output, "READY\n", 6, &written, NULL) || written != 6) goto done;
    if (stream_plugin) {
        bool ready = m4_recorder_stream_bootstrap(media, output, parent, pid);
        output = NULL; /* bootstrap always consumes this readiness handle */
        if (!ready) goto done;
    } else { CloseHandle(output); output = NULL; }
    /* EOF, any input, or parent death means application shutdown. Stream STOP
       has no channel to this process and cannot finalize this recording. */
    while (WaitForSingleObject(parent, 50) == WAIT_TIMEOUT) {
        if (!PeekNamedPipe(input, NULL, 0, NULL, &available, NULL) || available) break;
        if (!m4_media_active(media)) goto done;
        m4_media_poll_stream(media);
    }
    result = 0;
done:
    SecureZeroMemory(program, sizeof(program));
    if (media) {
        /* Also bounded after parent death, when no Node process remains to kill
           a stuck plugin shutdown. Forced exit never reports finalization. */
        HANDLE finished = CreateEventW(NULL, TRUE, FALSE, NULL);
        HANDLE watchdog = finished ? CreateThread(NULL, 0, shutdown_deadline, finished, 0, NULL) : NULL;
        if (!watchdog) ExitProcess(3);
        if (!m4_media_finalize(media, 5000)) result = 1;
        if (!m4_media_release(&media)) result = 1;
        SetEvent(finished); WaitForSingleObject(watchdog, INFINITE);
        CloseHandle(watchdog); CloseHandle(finished);
    }
    if (watch.finished) SetEvent(watch.finished);
    if (monitor) { WaitForSingleObject(monitor, INFINITE); CloseHandle(monitor); }
    if (watch.finished) CloseHandle(watch.finished);
    if (parent) CloseHandle(parent);
    if (output) CloseHandle(output);
    return result;
}
