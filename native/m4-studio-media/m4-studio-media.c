/* Owned program recording and optional, independently authorized RTMP output. */
#include "m4-studio-media.h"
#include <windows.h>
#include <obs.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>
#include <sddl.h>
#include <string.h>
#include "../m4-log-guard/m4-log-guard.h"
typedef bool (*attach_fn)(obs_service_t *, HANDLE, const unsigned char *, uint32_t);
typedef bool (*bind_fn)(obs_service_t *, obs_output_t *);
typedef bool (*start_fn)(obs_service_t *);

struct m4_media {
    obs_output_t *record;
    obs_output_t *stream;
    obs_service_t *service;
    attach_fn attach;
    start_fn start_stream;
    obs_source_t *program;
    obs_encoder_t *video;
    obs_encoder_t *audio;
    HANDLE reservation;
    HANDLE stopped;
    volatile LONG stop_code;
    bool initialized;
    bool started;
    bool stop_requested;
    HANDLE preview_mapping;
    unsigned char *preview_memory;
    bool preview_attached;
};
/* A process-owned, read-only preview for the signed-in Windows shell. Frames
 * stay in memory and are sampled from the same OBS output as the recording. */
#define PREVIEW_WIDTH 1280
#define PREVIEW_HEIGHT 720
#define PREVIEW_PIXELS (PREVIEW_WIDTH * PREVIEW_HEIGHT * 4)
#define PREVIEW_BITMAP (54 + PREVIEW_PIXELS)
#define PREVIEW_BYTES (16 + PREVIEW_BITMAP)
static void preview_frame(void *context, struct video_data *frame)
{
    m4_media *m = context;
    if (!m->preview_memory || !frame->data[0] || frame->linesize[0] < PREVIEW_WIDTH * 4) return;
    volatile LONG *sequence = (volatile LONG *)m->preview_memory;
    InterlockedIncrement(sequence);
    FILETIME now; GetSystemTimeAsFileTime(&now);
    memcpy(m->preview_memory + 8, &now, sizeof(now));
    for (unsigned int y = 0; y < PREVIEW_HEIGHT; ++y)
        memcpy(m->preview_memory + 16 + 54 + y * PREVIEW_WIDTH * 4,
            frame->data[0] + y * frame->linesize[0], PREVIEW_WIDTH * 4);
    InterlockedIncrement(sequence);
}
static bool initialize_preview(m4_media *m, const wchar_t *cache_root)
{
    const wchar_t *leaf = wcsrchr(cache_root, L'\\');
    const wchar_t *slash = wcsrchr(cache_root, L'/');
    if (!leaf || (slash && slash > leaf)) leaf = slash;
    /* Legacy isolated media checks do not request a shell preview. */
    if (!leaf || wcsncmp(leaf + 1, L"curlstreamer-m4-cef-", 20) || wcslen(leaf + 1) != 52) return true;
    const wchar_t *suffix = leaf + 21;
    if (wcsspn(suffix, L"0123456789abcdef") != 32) return false;
    wchar_t name[96];
    if (swprintf_s(name, 96, L"Local\\CurlStreamerPreview-%ls", suffix) < 0) return false;
    m->preview_mapping = CreateFileMappingW(INVALID_HANDLE_VALUE, NULL, PAGE_READWRITE, 0, PREVIEW_BYTES, name);
    if (!m->preview_mapping || GetLastError() == ERROR_ALREADY_EXISTS) return false;
    m->preview_memory = MapViewOfFile(m->preview_mapping, FILE_MAP_WRITE, 0, 0, PREVIEW_BYTES);
    if (!m->preview_memory) return false;
    BITMAPFILEHEADER file = {0}; BITMAPINFOHEADER info = {0};
    file.bfType = 0x4d42; file.bfSize = PREVIEW_BITMAP; file.bfOffBits = 54;
    info.biSize = sizeof(info); info.biWidth = PREVIEW_WIDTH; info.biHeight = -PREVIEW_HEIGHT;
    info.biPlanes = 1; info.biBitCount = 32; info.biCompression = BI_RGB; info.biSizeImage = PREVIEW_PIXELS;
    *(DWORD *)(m->preview_memory + 4) = PREVIEW_BITMAP;
    memcpy(m->preview_memory + 16, &file, sizeof(file));
    memcpy(m->preview_memory + 16 + sizeof(file), &info, sizeof(info));
    struct video_scale_info scale = {0};
    scale.format = VIDEO_FORMAT_BGRA; scale.width = PREVIEW_WIDTH; scale.height = PREVIEW_HEIGHT;
    scale.range = VIDEO_RANGE_FULL; scale.colorspace = VIDEO_CS_709;
    obs_add_raw_video_callback2(&scale, 2, preview_frame, m);
    m->preview_attached = true;
    return true;
}
static volatile LONG owner;
/* Process-lifetime containment. Never close a live self-containing job: the OS
 * closes its noninherited handle at process exit and kills remaining helpers. */
static HANDLE containment_job;
static bool contain_process(void)
{
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
    if (containment_job) return true;
    HANDLE job = CreateJobObjectW(NULL, NULL);
    if (!job) return false;
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits)) ||
        !AssignProcessToJobObject(job, GetCurrentProcess())) { CloseHandle(job); return false; }
    containment_job = job;
    return true;
}
static bool cache_owner(const wchar_t *directory)
{
    wchar_t path[2048]; char marker[128]; DWORD written = 0;
    if (!containment_job || swprintf_s(path, 2048, L"%ls/.m4-owner.json", directory) < 0) return false;
    int length = sprintf_s(marker, sizeof(marker), "{\"schema\":\"m4-cef-owner-v1\",\"pid\":%lu,\"jobBound\":true}\n", GetCurrentProcessId());
    if (length < 1) return false;
    HANDLE file = CreateFileW(path, GENERIC_WRITE, FILE_SHARE_READ, NULL, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return false;
    bool ok = WriteFile(file, marker, (DWORD)length, &written, NULL) && written == (DWORD)length && FlushFileBuffers(file);
    CloseHandle(file);
    return ok;
}
static bool local_path(const wchar_t *path)
{
    if (!path) return false;
    size_t n = wcslen(path);
    if (n < 4 || n >= 1800 || !((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z')) ||
        path[1] != L':' || (path[2] != L'\\' && path[2] != L'/')) return false;
    return !wcschr(path + 2, L':'); /* No device or alternate data stream target. */
}
static bool private_directory(const wchar_t *path)
{
    HANDLE token = NULL; DWORD size = 0; TOKEN_USER *user = NULL; LPWSTR sid = NULL;
    PSECURITY_DESCRIPTOR descriptor = NULL; wchar_t sddl[256]; bool ok = false;
    SECURITY_ATTRIBUTES attributes = {sizeof(attributes), NULL, FALSE};
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) goto done;
    GetTokenInformation(token, TokenUser, NULL, 0, &size);
    user = malloc(size);
    if (!user || !GetTokenInformation(token, TokenUser, user, size, &size) || !ConvertSidToStringSidW(user->User.Sid, &sid)) goto done;
    if (swprintf_s(sddl, 256, L"D:P(A;OICI;FA;;;%ls)", sid) < 0 || !ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, &descriptor, NULL)) goto done;
    attributes.lpSecurityDescriptor = descriptor;
    ok = CreateDirectoryW(path, &attributes) != FALSE;
done:
    if (descriptor) LocalFree(descriptor);
    if (sid) LocalFree(sid);
    if (user) free(user);
    if (token) CloseHandle(token);
    return ok;
}
static bool public_loopback(const char *url)
{
    static const char prefix[] = "http://127.0.0.1:";
    if (!url || strncmp(url, prefix, sizeof(prefix)-1)) return false;
    const char *p = url + sizeof(prefix)-1;
    unsigned int port = 0, count = 0;
    while (*p >= '0' && *p <= '9') { port = port * 10 + (unsigned int)(*p++ - '0'); if (++count > 5) return false; }
    return count && port > 0 && port <= 65535 && p[0] == '/' && p[1] == 0;
}
/* CEF has its own profile and does not inherit the browser's address policy.
 * Seed only the fresh, private per-run profile before obs-browser initializes.
 * The exact renderer origin may expose host addresses for direct-path proof;
 * other pages and ports retain CEF's default address privacy behavior. */
static bool program_address_preferences(const wchar_t *directory, const char *url)
{
    wchar_t browser[2048], path[2048]; char preferences[160]; DWORD written = 0;
    if (!public_loopback(url) ||
        swprintf_s(browser, 2048, L"%ls/obs-browser", directory) < 0 ||
        swprintf_s(path, 2048, L"%ls/UserPrefs.json", browser) < 0) return false;
    /* The validated URL contains no JSON metacharacters. Omit its final slash
     * to store an origin, not a path or a wildcard. */
    int length = sprintf_s(preferences, sizeof(preferences),
        "{\"webrtc\":{\"local_ips_allowed_urls\":[\"%.*s\"]}}\n", (int)strlen(url) - 1, url);
    if (length < 1 || !CreateDirectoryW(browser, NULL)) return false;
    HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return false;
    bool ok = WriteFile(file, preferences, (DWORD)length, &written, NULL) &&
        written == (DWORD)length && FlushFileBuffers(file);
    CloseHandle(file);
    return ok;
}
static bool module(const char *runtime, const char *name)
{
    char dll[4096], data[4096]; obs_module_t *m = NULL;
    if (sprintf_s(dll, sizeof(dll), "%s/../../obs-plugins/64bit/%s.dll", runtime, name) < 0 ||
        sprintf_s(data, sizeof(data), "%s/../../data/obs-plugins/%s", runtime, name) < 0) return false;
    return obs_open_module(&m, dll, data) == MODULE_SUCCESS && obs_init_module(m);
}
static void on_stop(void *context, calldata_t *data)
{
    m4_media *m = context;
    InterlockedExchange(&m->stop_code, (LONG)calldata_int(data, "code"));
    SetEvent(m->stopped);
}
bool m4_media_release(m4_media **reference)
{
    if (!reference || !*reference) return true;
    m4_media *m = *reference;
    if (m->record && (obs_output_active(m->record) || (m->started && WaitForSingleObject(m->stopped, 0) != WAIT_OBJECT_0))) return false;
    if (m->preview_attached) obs_remove_raw_video_callback(preview_frame, m);
    if (m->preview_memory) UnmapViewOfFile(m->preview_memory);
    if (m->preview_mapping) CloseHandle(m->preview_mapping);
    if (m->stream) { obs_output_force_stop(m->stream); obs_output_release(m->stream); }
    if (m->service) obs_service_release(m->service);
    if (m->record) {
        signal_handler_disconnect(obs_output_get_signal_handler(m->record), "stop", on_stop, m);
        obs_output_release(m->record);
    }
    if (m->video) obs_encoder_release(m->video);
    if (m->audio) obs_encoder_release(m->audio);
    if (m->program) { obs_set_output_source(0, NULL); obs_source_release(m->program); }
    if (m->initialized) obs_shutdown();
    if (m->reservation != INVALID_HANDLE_VALUE) CloseHandle(m->reservation);
    if (m->stopped) CloseHandle(m->stopped);
    free(m); *reference = NULL;
    InterlockedExchange(&owner, 0);
    return true;
}
static bool initialize(const wchar_t *runtime_bin, const wchar_t *absolute_mkv, const wchar_t *cache_root, const char *url, m4_media **out)
{
    m4_media *m; obs_data_t *settings = NULL;
    char runtime[4096], path[4096], graphics[4096], data[4096], cache[4096];
    struct obs_video_info video = {0}; struct obs_audio_info audio = {0};
    if (!out || *out) return false;
    *out = NULL;
    if (!local_path(runtime_bin) || (!absolute_mkv && !url) || (absolute_mkv && (!local_path(absolute_mkv) || _wcsicmp(absolute_mkv + wcslen(absolute_mkv) - 4, L".mkv"))) ||
        !WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, runtime_bin, -1, runtime, sizeof(runtime), NULL, NULL) ||
        (absolute_mkv && !WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, absolute_mkv, -1, path, sizeof(path), NULL, NULL))) return false;
    if (cache_root && (!local_path(cache_root) || !WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, cache_root, -1, cache, sizeof(cache), NULL, NULL))) return false;
    if (obs_initialized() || InterlockedCompareExchange(&owner, 1, 0)) return false;
    m = calloc(1, sizeof(*m));
    if (!m) { InterlockedExchange(&owner, 0); return false; }
    m->reservation = INVALID_HANDLE_VALUE;
    m->stop_code = OBS_OUTPUT_ERROR;
    if (absolute_mkv) m->reservation = CreateFileW(absolute_mkv, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
        NULL, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, NULL);
    if (absolute_mkv && m->reservation == INVALID_HANDLE_VALUE) goto fail;
    if (!contain_process()) goto fail;
    if (cache_root && (!private_directory(cache_root) || !cache_owner(cache_root) ||
        !program_address_preferences(cache_root, url))) goto fail;
    m->stopped = CreateEventW(NULL, TRUE, FALSE, NULL);
    if (!m->stopped || !SetDllDirectoryW(runtime_bin)) goto fail;
    m4_log_guard_install();
    if (!obs_startup("en-US", cache_root ? cache : NULL, NULL)) goto fail;
    m->initialized = true;
    if (sprintf_s(graphics, sizeof(graphics), "%s/libobs-d3d11.dll", runtime) < 0 ||
        sprintf_s(data, sizeof(data), "%s/../../data/libobs/", runtime) < 0) goto fail;
#pragma warning(push)
#pragma warning(disable : 4996)
    obs_add_data_path(data);
#pragma warning(pop)
    if (!module(runtime, "obs-x264") || !module(runtime, "obs-ffmpeg")) goto fail;
    video.graphics_module = graphics; video.fps_num = 30; video.fps_den = 1;
    video.base_width = video.output_width = 1920; video.base_height = video.output_height = 1080;
    video.gpu_conversion = true; video.output_format = VIDEO_FORMAT_NV12; video.colorspace = VIDEO_CS_709;
    video.range = VIDEO_RANGE_PARTIAL; video.scale_type = OBS_SCALE_BILINEAR;
    if (obs_reset_video(&video) != OBS_VIDEO_SUCCESS) goto fail;
    audio.samples_per_sec = 48000; audio.speakers = SPEAKERS_STEREO;
    if (!obs_reset_audio(&audio)) goto fail;
    settings = obs_data_create();
    obs_data_set_string(settings, "rate_control", "CBR"); obs_data_set_int(settings, "bitrate", 6000);
    obs_data_set_string(settings, "preset", "veryfast"); obs_data_set_int(settings, "keyint_sec", 2);
    m->video = obs_video_encoder_create("obs_x264", "M4 black proof recording video", settings, NULL);
    obs_data_release(settings); settings = obs_data_create(); obs_data_set_int(settings, "bitrate", 160);
    m->audio = obs_audio_encoder_create("ffmpeg_aac", "M4 silent proof recording audio", settings, 0, NULL);
    obs_data_release(settings); settings = NULL;
    if (!m->video || !m->audio) goto fail;
    obs_encoder_set_video(m->video, obs_get_video()); obs_encoder_set_audio(m->audio, obs_get_audio());
    if (absolute_mkv) {
    settings = obs_data_create(); obs_data_set_string(settings, "path", path);
    obs_data_set_bool(settings, "split_file", false);
    m->record = obs_output_create("ffmpeg_muxer", "M4 independent local MKV", settings, NULL);
    obs_data_release(settings); settings = NULL;
    if (!m->record) goto fail;
    obs_output_set_video_encoder(m->record, m->video); obs_output_set_audio_encoder(m->record, m->audio, 0);
    signal_handler_connect(obs_output_get_signal_handler(m->record), "stop", on_stop, m);
    }
    if (url) {
        settings = obs_get_private_data(); obs_data_set_bool(settings, "BrowserHWAccel", false); obs_data_release(settings); settings = NULL;
        if (!module(runtime, "obs-browser")) goto fail;
        settings = obs_data_create();
        obs_data_set_string(settings, "url", url); obs_data_set_int(settings, "width", 1920); obs_data_set_int(settings, "height", 1080);
        obs_data_set_bool(settings, "is_local_file", false); obs_data_set_bool(settings, "shutdown", false);
        obs_data_set_bool(settings, "fps_custom", true); obs_data_set_int(settings, "fps", 30);
        obs_data_set_bool(settings, "reroute_audio", true); obs_data_set_int(settings, "webpage_control_level", 0);
        obs_data_set_string(settings, "css", "html,body{margin:0;background:transparent;overflow:hidden}video,img{object-fit:contain}");
        m->program = obs_source_create_private("browser_source", "M4 public loopback program proof", settings);
        obs_data_release(settings); settings = NULL;
        if (!m->program) goto fail;
        obs_set_output_source(0, m->program);
        if (!initialize_preview(m, cache_root)) goto fail;
    }
    *out = m; return true;
fail:
    if (settings) obs_data_release(settings);
    m4_media_release(&m);
    return false;
}
bool m4_media_initialize(const wchar_t *runtime_bin, const wchar_t *absolute_mkv, m4_media **out)
{ return initialize(runtime_bin, absolute_mkv, NULL, NULL, out); }
bool m4_media_initialize_program(const wchar_t *runtime_bin, const wchar_t *absolute_mkv, const wchar_t *fresh_cache_root, const char *public_loopback_url, m4_media **out)
{
    if (!fresh_cache_root || !public_loopback(public_loopback_url)) return false;
    return initialize(runtime_bin, absolute_mkv, fresh_cache_root, public_loopback_url, out);
}
bool m4_media_start(m4_media *m)
{
    if (!m || !m->initialized || m->started || m->stop_requested) return false;
    m->started = m->record ? obs_output_start(m->record) : true;
    return m->started;
}
bool m4_media_prepare_stream(m4_media *m, const wchar_t *runtime_bin, const wchar_t *absolute_plugin)
{
    char runtime[4096], path[4096]; obs_module_t *plugin = NULL; HMODULE dll; bind_fn bind;
    if (!m || !m->initialized || m->service || m->stream || !local_path(runtime_bin) || !local_path(absolute_plugin) ||
        !WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, runtime_bin, -1, runtime, sizeof(runtime), NULL, NULL) ||
        !WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, absolute_plugin, -1, path, sizeof(path), NULL, NULL)) return false;
    if (!module(runtime, "obs-outputs") || obs_open_module(&plugin, path, ".") != MODULE_SUCCESS || !obs_init_module(plugin)) return false;
    dll = GetModuleHandleW(absolute_plugin);
    if (!dll || GetProcAddress(dll, "m4_test_arm")) return false;
    m->attach = (attach_fn)(void *)GetProcAddress(dll, "m4_attach_controller");
    m->start_stream = (start_fn)(void *)GetProcAddress(dll, "m4_start_if_authorized");
    bind = (bind_fn)(void *)GetProcAddress(dll, "m4_bind_output");
    if (!m->attach || !m->start_stream || !bind) return false;
    m->service = obs_service_create("curlstreamer_m4_memory", "M4 memory-only stream authority", NULL, NULL);
    m->stream = obs_output_create("rtmp_output", "M4 independent program RTMP", NULL, NULL);
    if (!m->service || !m->stream) return false;
    obs_output_set_video_encoder(m->stream, m->video);
    obs_output_set_audio_encoder(m->stream, m->audio, 0);
    obs_output_set_service(m->stream, m->service);
    return bind(m->service, m->stream);
}
bool m4_media_attach_stream(m4_media *m, HANDLE pipe, const unsigned char capability[32], uint32_t parent_pid)
{ return m && m->attach && m->service && m->attach(m->service, pipe, capability, parent_pid); }
void m4_media_poll_stream(m4_media *m)
{ if (m && m->start_stream && m->service) m->start_stream(m->service); }
bool m4_media_active(const m4_media *m)
{ return m && m->started && !m->stop_requested && (m->record ? obs_output_active(m->record) : m->initialized); }
uint64_t m4_media_bytes(const m4_media *m)
{
    LARGE_INTEGER size;
    return m && m->reservation != INVALID_HANDLE_VALUE && GetFileSizeEx(m->reservation, &size) && size.QuadPart > 0 ? (uint64_t)size.QuadPart : 0;
}
bool m4_media_finalize(m4_media *m, uint32_t timeout_ms)
{
    if (!m || !m->started || timeout_ms < 1 || timeout_ms > 30000) return false;
    if (!m->record) { m->stop_requested = true; return true; }
    ULONGLONG deadline = GetTickCount64() + timeout_ms;
    if (!m->stop_requested) { m->stop_requested = true; obs_output_stop(m->record); }
    ULONGLONG now = GetTickCount64();
    if (now >= deadline || WaitForSingleObject(m->stopped, (DWORD)(deadline - now)) != WAIT_OBJECT_0) return false;
    /* OBS emits stop before its active flag is cleared. Both are required. */
    while (obs_output_active(m->record) && GetTickCount64() < deadline) Sleep(5);
    return InterlockedCompareExchange(&m->stop_code, 0, 0) == OBS_OUTPUT_SUCCESS && !obs_output_active(m->record);
}
