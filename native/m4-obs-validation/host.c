/* Real libobs validation with test-only local sinks. Never sends network media. */
#include <windows.h>
#include <bcrypt.h>
#include <obs.h>
#include <util/base.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include "ipc-protocol.h"

typedef bool (*arm_fn)(obs_service_t *, const char *, const char *, uint32_t);
typedef void (*revoke_fn)(obs_service_t *);
typedef uint32_t (*state_fn)(obs_service_t *);
typedef bool (*attach_fn)(obs_service_t *, HANDLE, const unsigned char *, uint32_t);
typedef bool (*bind_fn)(obs_service_t *, obs_output_t *);
typedef bool (*start_fn)(obs_service_t *);
typedef struct sink {
    obs_output_t *output;
    FILE *file;
    HANDLE pending;
    bool delayed;
    bool fail_start;
    volatile LONG frames;
    volatile LONG late_attempted, late_succeeded;
} sink;
static sink *stream_sink, *record_sink;
static char canary[80];
static volatile LONG leaked;
static FILE *log_file;
static const char *sink_name(void *unused) { (void)unused; return "M4 LOCAL TEST SINK"; }
static void log_handler(int level, const char *format, va_list args, void *unused)
{
    va_list count_args;
    char *line;
    int length;
    (void)level; (void)unused;
    va_copy(count_args, args);
    length = _vscprintf(format, count_args);
    va_end(count_args);
    if (length < 0 || !(line = malloc((size_t)length + 1))) { InterlockedExchange(&leaked, 1); return; }
    vsnprintf(line, (size_t)length + 1, format, args);
    if (canary[0] && strstr(line, canary)) InterlockedExchange(&leaked, 1);
    if (strstr(line, "synthetic_key_for_default_denial")) InterlockedExchange(&leaked, 1);
    if (log_file) { fprintf(log_file, "%s\n", line); fflush(log_file); }
    free(line);
}
static void *sink_create(obs_data_t *settings, obs_output_t *output)
{
    sink *s = calloc(1, sizeof(*s));
    if (!s) return NULL;
    s->output = output;
    s->delayed = obs_data_get_bool(settings, "delay");
    s->fail_start = obs_data_get_bool(settings, "fail_start");
    if (obs_data_get_bool(settings, "record")) {
        if (fopen_s(&s->file, "recording.yuv", "wb")) { free(s); return NULL; }
        record_sink = s;
    } else stream_sink = s;
    return s;
}
static DWORD WINAPI delayed_start(void *data)
{
    sink *s = data;
    Sleep(700);
    InterlockedExchange(&s->late_attempted, 1);
    if (obs_output_begin_data_capture(s->output, 0)) InterlockedExchange(&s->late_succeeded, 1);
    return 0;
}
static bool sink_start(void *data)
{
    sink *s = data;
    if (s->fail_start) return false;
    if (s->delayed) {
        s->pending = CreateThread(NULL, 0, delayed_start, s, 0, NULL);
        return s->pending != NULL;
    }
    return obs_output_begin_data_capture(s->output, 0);
}
static void sink_stop(void *data, uint64_t timestamp)
{
    sink *s = data; (void)timestamp;
    obs_output_end_data_capture(s->output);
}
static void sink_destroy(void *data)
{
    sink *s = data;
    if (s->pending) {
        if (WaitForSingleObject(s->pending, 3000) != WAIT_OBJECT_0) ExitProcess(88);
        CloseHandle(s->pending);
    }
    if (s->file) fclose(s->file);
    free(s);
}
static void join_pending(sink *s)
{
    if (s && s->pending && WaitForSingleObject(s->pending, 3000) != WAIT_OBJECT_0) ExitProcess(88);
}
static void sink_video(void *data, struct video_data *frame)
{
    sink *s = data;
    if (s->file) {
        for (unsigned p = 0; p < 3; ++p) {
            unsigned size = p ? 32 : 64;
            for (unsigned y = 0; y < size; ++y)
                if (fwrite(frame->data[p] + y * frame->linesize[p], 1, size, s->file) != size)
                    InterlockedExchange(&leaked, 1);
        }
        fflush(s->file);
    }
    InterlockedIncrement(&s->frames);
}
static struct obs_output_info stream_info = {
    .id = "m4_local_stream_test", .flags = OBS_OUTPUT_VIDEO | OBS_OUTPUT_SERVICE,
    .get_name = sink_name, .create = sink_create, .destroy = sink_destroy,
    .start = sink_start, .stop = sink_stop, .raw_video = sink_video, .protocols = "RTMP"
};
static struct obs_output_info record_info = {
    .id = "m4_raw_record_test", .flags = OBS_OUTPUT_VIDEO,
    .get_name = sink_name, .create = sink_create, .destroy = sink_destroy,
    .start = sink_start, .stop = sink_stop, .raw_video = sink_video
};
#define CHECK(test, label) do { if (!(test)) { printf("FAIL: %s\n", label); result = 1; goto cleanup; } } while (0)
int main(int argc, char **argv)
{
    int result = 0;
    bool initialized = false;
    obs_module_t *module = NULL;
    obs_service_t *service = NULL;
    obs_service_t *capacity[9] = {0};
    obs_output_t *stream = NULL, *record = NULL;
    obs_data_t *settings = NULL, *saved = NULL;
    HMODULE dll;
    arm_fn arm;
    revoke_fn revoke;
    state_fn state;
    struct obs_video_info video = {0};
    char graphics_path[1024], data_path[1024];
    BYTE random[16];
    IpcController controller = {0};
    if (argc != 3 && argc != 4 && argc != 5) { puts("Usage: m4_obs_validation <plugin-dll> <OBS-runtime-bin> [--production | --ipc scenario | --node-ipc scenario | --studio-bootstrap]"); return 2; }
    bool studio_mode = argc == 4 && strcmp(argv[3], "--studio-bootstrap") == 0;
    if (argc == 4 && strcmp(argv[3], "--production") && !studio_mode) return 2;
    if (argc == 5 && ((strcmp(argv[3], "--ipc") && strcmp(argv[3], "--node-ipc")) || strtoul(argv[4], NULL, 10) > IPC_PRODUCTION_BAD_LEASE)) return 2;
    snprintf(graphics_path, sizeof(graphics_path), "%s/libobs-d3d11.dll", argv[2]);
    snprintf(data_path, sizeof(data_path), "%s/../../data/libobs/", argv[2]);
    SetDllDirectoryA(argv[2]);
    if (BCryptGenRandom(NULL, random, sizeof(random), BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0) return 2;
    strcpy_s(canary, sizeof(canary), "m4-canary-");
    for (unsigned i = 0; i < sizeof(random); ++i)
        sprintf_s(canary + 10 + i * 2, sizeof(canary) - 10 - i * 2, "%02x", random[i]);
    SecureZeroMemory(random, sizeof(random));
    if (fopen_s(&log_file, "libobs-validation.log", "wb")) return 2;
    base_set_log_handler(log_handler, NULL);
    CHECK(obs_startup("en-US", NULL, NULL), "libobs startup"); initialized = true;
#pragma warning(push)
#pragma warning(disable : 4996)
    obs_add_data_path(data_path);
#pragma warning(pop)
    CHECK(obs_open_module(&module, argv[1], ".") == MODULE_SUCCESS && obs_init_module(module), "plugin load");
    dll = GetModuleHandleA(argv[1]);
    CHECK(dll != NULL, "loaded module handle");
    arm = (arm_fn)(void *)GetProcAddress(dll, "m4_test_arm");
    revoke = (revoke_fn)(void *)GetProcAddress(dll, "m4_test_revoke");
    state = (state_fn)(void *)GetProcAddress(dll, "m4_test_state");
    video.graphics_module = graphics_path;
    video.fps_num = 30; video.fps_den = 1;
    video.base_width = video.output_width = 64; video.base_height = video.output_height = 64;
    video.output_format = VIDEO_FORMAT_I420; video.colorspace = VIDEO_CS_709;
    video.range = VIDEO_RANGE_PARTIAL; video.scale_type = OBS_SCALE_BILINEAR;
    CHECK(obs_reset_video(&video) == OBS_VIDEO_SUCCESS, "real video pipeline");
    if (argc == 5 || studio_mode) {
        unsigned scenario = studio_mode ? IPC_DEFAULT : (unsigned)strtoul(argv[4], NULL, 10);
        bool rejected = scenario == IPC_BAD_TOKEN || scenario == IPC_OVERSIZE || scenario == IPC_DEFAULT || scenario > IPC_PRODUCTION_ARM;
        WCHAR controller_exe[1024], *filename;
        WCHAR node_exe[1024], node_script[1024];
        bool node_mode = studio_mode || strcmp(argv[3], "--node-ipc") == 0;
        ULONGLONG deadline;
        LONG before, stopped_frames;
        attach_fn attach = (attach_fn)(void *)GetProcAddress(dll, "m4_attach_controller");
        bind_fn bind = (bind_fn)(void *)GetProcAddress(dll, "m4_bind_output");
        start_fn start_owned = (start_fn)(void *)GetProcAddress(dll, "m4_start_if_authorized");
        CHECK(!studio_mode || (!arm && !revoke && !state), "Studio default plugin test controls absent");
        CHECK(attach && bind && start_owned, "production IPC and bound-start exports available");
        CHECK(scenario < IPC_PRODUCTION_ARM || (!arm && !revoke && !state), "production admission artifact exposes no test controls");
        obs_register_output(&stream_info); obs_register_output(&record_info);
        settings = obs_data_create(); obs_data_set_bool(settings, "record", true);
        record = obs_output_create("m4_raw_record_test", "IPC raw recording", settings, NULL);
        obs_data_release(settings); settings = NULL;
        CHECK(record && obs_output_start(record), "IPC independent recording start");
        service = obs_service_create("curlstreamer_m4_memory", "IPC service", NULL, NULL);
        CHECK(service, "IPC service create");
        settings = obs_data_create(); obs_data_set_bool(settings, "delay", scenario == IPC_STOP);
        obs_data_set_bool(settings, "fail_start", scenario == IPC_START_FAILURE);
        stream = obs_output_create("m4_local_stream_test", "IPC LOCAL stream", settings, NULL);
        obs_data_release(settings); settings = NULL;
        CHECK(stream, "IPC local sink create"); obs_output_set_service(stream, service);
        CHECK(!bind(service, record), "unrelated recording output binding denied");
        CHECK(bind(service, stream) && !bind(service, stream), "stream binding is one-shot before attach");
        CHECK(!start_owned(service), "bound output start requires authority and attachment");
        CHECK(GetModuleFileNameW(NULL, controller_exe, 1024), "controller executable path");
        filename = wcsrchr(controller_exe, L'\\');
        CHECK(filename, "controller executable directory");
        wcscpy_s(filename + 1, 1024 - (size_t)(filename + 1 - controller_exe), L"m4_ipc_controller.exe");
        if (node_mode) {
            DWORD exe_size = GetEnvironmentVariableW(L"M4_NODE_EXECUTABLE", node_exe, 1024);
            DWORD script_size = GetEnvironmentVariableW(studio_mode ? L"M4_STUDIO_SCRIPT" : L"M4_NODE_SCRIPT", node_script, 1024);
            CHECK(exe_size > 0 && exe_size < 1024 && script_size > 0 && script_size < 1024, "Node proof paths configured");
        }
        CHECK(m4_launch_controller(&controller, node_mode ? node_exe : controller_exe, node_mode ? node_script : NULL, canary, scenario, studio_mode), "separate controller launched");
        CHECK(!attach(service, controller.pipe, controller.token, controller.pid + 1), "wrong process attachment rejected");
        CHECK(attach(service, controller.pipe, controller.token, controller.pid), "authenticated channel attached");
        controller.pipe = NULL; SecureZeroMemory(controller.token, sizeof(controller.token));
        deadline = GetTickCount64() + 2000;
        while (!obs_service_get_connect_info(service, OBS_SERVICE_CONNECT_INFO_STREAM_KEY)[0] && GetTickCount64() < deadline) Sleep(10);
        if (rejected) {
            CHECK(!obs_service_get_connect_info(service, OBS_SERVICE_CONNECT_INFO_STREAM_KEY)[0] &&
                !start_owned(service) && !obs_output_start(stream), "unauthorized frame cannot start");
            if (studio_mode) {
                DWORD code;
                CHECK(WaitForSingleObject(controller.process, 3000) == WAIT_OBJECT_0 &&
                    GetExitCodeProcess(controller.process, &code) && code == 0, "Studio bootstrap child confirmed ARM denial");
                CHECK(InterlockedCompareExchange(&stream_sink->frames, 0, 0) == 0, "Studio stream never received frames");
            }
        } else {
            CHECK(strcmp(obs_service_get_connect_info(service, OBS_SERVICE_CONNECT_INFO_STREAM_KEY), canary) == 0, "canary transferred through pipe");
            if (scenario == IPC_START_FAILURE || scenario == IPC_EXPIRE_BEFORE_START) {
                if (scenario == IPC_EXPIRE_BEFORE_START) Sleep(1200);
                CHECK(!start_owned(service) && !start_owned(service), "failed or expired start cannot retry");
                CHECK(state(service) == 2 && !obs_output_active(stream) &&
                    !obs_service_get_connect_info(service, OBS_SERVICE_CONNECT_INFO_STREAM_KEY)[0], "failed or expired start revokes target access");
                if (scenario == IPC_START_FAILURE) SetEvent(controller.started);
            } else {
            CHECK(!bind(service, stream), "attached output cannot be rebound");
            CHECK(start_owned(service) && !start_owned(service), "IPC authorized bound start is one-shot");
            SetEvent(controller.started);
            Sleep(250);
            if (scenario != IPC_STOP && scenario != IPC_PRODUCTION_ARM)
                CHECK(InterlockedCompareExchange(&stream_sink->frames, 0, 0) > 0, "IPC stream received frames");
            if (scenario == IPC_KILL) {
                CHECK(TerminateProcess(controller.process, 91) && WaitForSingleObject(controller.process, 1000) == WAIT_OBJECT_0, "actual controller process death");
            }
            if (scenario == IPC_RENEW) {
                Sleep(1000);
                CHECK(obs_output_active(stream), "renewal extends original lease");
                Sleep(1000);
            } else Sleep(1100);
            CHECK(!obs_output_active(stream), "IPC failure or expiry stops output");
            CHECK(!start_owned(service) && !obs_output_start(stream), "IPC revoked restart rejected");
            if (scenario == IPC_STOP)
                CHECK(InterlockedCompareExchange(&stream_sink->late_attempted, 0, 0) &&
                    InterlockedCompareExchange(&stream_sink->late_succeeded, 0, 0), "late activation after IPC STOP is stopped by bound watchdog");
            }
        }
        saved = obs_service_get_settings(service);
        CHECK(!strstr(obs_data_get_json(saved), canary) && !strstr(obs_data_get_json(saved), "synthetic.invalid"), "IPC target absent from settings");
        CHECK(!studio_mode || (!strstr(obs_data_get_json(saved), "synthetic_key") && !strstr(obs_data_get_json(saved), "a.rtmps.youtube.com")), "Studio target absent from settings");
        CHECK(obs_data_save_json_safe(saved, "service-test.json", "tmp", "bak"), "IPC settings persistence check");
        before = InterlockedCompareExchange(&record_sink->frames, 0, 0);
        stopped_frames = InterlockedCompareExchange(&stream_sink->frames, 0, 0);
        Sleep(200);
        CHECK(obs_output_active(record) && InterlockedCompareExchange(&record_sink->frames, 0, 0) > before, "IPC recording continues");
        CHECK(InterlockedCompareExchange(&stream_sink->frames, 0, 0) == stopped_frames, "IPC stream remains stopped");
        if (scenario == IPC_STOP || scenario == IPC_PRODUCTION_ARM || scenario == IPC_START_FAILURE) {
            DWORD code;
            CHECK(WaitForSingleObject(controller.process, 4500) == WAIT_OBJECT_0 &&
                GetExitCodeProcess(controller.process, &code) && code == 0, "controller verified sanitized post-STOP observation");
        }
        printf("PASS: IPC scenario %u; raw recording continues\n", scenario);
        goto cleanup;
    }
    for (unsigned i = 0; i < 8; ++i) {
        capacity[i] = obs_service_create("curlstreamer_m4_memory", "M4 capacity test", NULL, NULL);
        CHECK(capacity[i], "bounded service capacity available");
        if (arm) CHECK(arm(capacity[i], "rtmps://synthetic.invalid/live2", canary, 900), "eight service workers available");
    }
    capacity[8] = obs_service_create("curlstreamer_m4_memory", "M4 excess test", NULL, NULL);
    CHECK(capacity[8], "OBS retains failed-create placeholder");
    if (arm) CHECK(!arm(capacity[8], "rtmps://synthetic.invalid/live2", canary, 900), "ninth worker rejected");
    CHECK(!obs_service_get_connect_info(capacity[8], OBS_SERVICE_CONNECT_INFO_STREAM_KEY)[0], "failed-create placeholder safe");
    obs_service_release(capacity[8]); capacity[8] = NULL;
    for (unsigned i = 0; i < 8; ++i) { obs_service_release(capacity[i]); capacity[i] = NULL; }
    puts("PASS: service capacity bounded; released workers reusable");
    if (argc == 4) {
        CHECK(!arm && !revoke && !state, "production test controls absent");
        service = obs_service_create("curlstreamer_m4_memory", "M4 unarmed default", NULL, NULL);
        CHECK(service, "production service create");
        CHECK(!obs_service_get_connect_info(service, OBS_SERVICE_CONNECT_INFO_STREAM_KEY)[0], "production has no target");
        obs_register_output(&stream_info);
        stream = obs_output_create("m4_local_stream_test", "M4 unarmed test stream", NULL, NULL);
        CHECK(stream, "production output create");
        obs_output_set_service(stream, service);
        CHECK(!obs_output_start(stream), "unarmed production start denied");
        puts("PASS: production controls absent and output start denied");
        goto cleanup;
    }
    CHECK(arm && revoke && state, "test-only controls");
    obs_register_output(&stream_info); obs_register_output(&record_info);
    settings = obs_data_create(); obs_data_set_bool(settings, "record", true);
    record = obs_output_create("m4_raw_record_test", "M4 raw test recording", settings, NULL);
    CHECK(record && obs_output_start(record), "raw recording start");
    obs_data_release(settings); settings = NULL;
    for (unsigned scenario = 0; scenario < 3; ++scenario) {
        ULONGLONG started;
        LONG recorded, streamed;
        service = obs_service_create("curlstreamer_m4_memory", "M4 synthetic service", NULL, NULL);
        CHECK(service, "service create");
        CHECK(!arm(service, "rtmps://other.invalid/live2", canary, 900), "other target rejected");
        CHECK(!arm(service, "rtmps://synthetic.invalid/live2", canary, 30001), "excess lease rejected");
        CHECK(arm(service, "rtmps://synthetic.invalid/live2", canary, scenario == 2 ? 200 : 900), "one-shot arm");
        CHECK(!arm(service, "rtmps://synthetic.invalid/live2", canary, 900), "duplicate arm rejected");
        CHECK(strcmp(obs_service_get_connect_info(service, OBS_SERVICE_CONNECT_INFO_STREAM_KEY), canary) == 0, "in-memory target access");
        saved = obs_service_get_settings(service);
        CHECK(!strstr(obs_data_get_json(saved), canary), "settings contain no key");
        CHECK(!strstr(obs_data_get_json(saved), "synthetic.invalid"), "settings contain no target URL");
        CHECK(obs_data_save_json_safe(saved, "service-test.json", "tmp", "bak"), "safe settings save");
        obs_data_release(saved); saved = NULL;
        settings = obs_data_create(); obs_data_set_bool(settings, "delay", scenario == 2);
        stream = obs_output_create("m4_local_stream_test", "M4 LOCAL ONLY stream", settings, NULL);
        obs_data_release(settings); settings = NULL;
        CHECK(stream, "test stream create");
        obs_output_set_service(stream, service);
        started = GetTickCount64();
        CHECK(obs_output_start(stream), "test stream start");
        if (scenario == 1) { Sleep(200); revoke(service); }
        Sleep(scenario == 2 ? 1100 : 1300);
        CHECK(state(service) == 2 && !obs_output_active(stream), "watchdog stopped owned output");
        CHECK(!obs_service_get_connect_info(service, OBS_SERVICE_CONNECT_INFO_STREAM_KEY)[0], "revocation closes target access");
        saved = obs_service_get_settings(service);
        CHECK(!strstr(obs_data_get_json(saved), canary), "post-stop settings contain no key");
        CHECK(!strstr(obs_data_get_json(saved), "synthetic.invalid"), "post-stop settings contain no target URL");
        CHECK(obs_data_save_json_safe(saved, "service-test.json", "tmp", "bak"), "post-stop settings save");
        obs_data_release(saved); saved = NULL;
        CHECK(GetTickCount64() - started < 2500, "bounded stop observation");
        CHECK(!obs_output_start(stream), "revoked restart rejected");
        recorded = InterlockedCompareExchange(&record_sink->frames, 0, 0);
        streamed = InterlockedCompareExchange(&stream_sink->frames, 0, 0);
        Sleep(250);
        CHECK(obs_output_active(record) && InterlockedCompareExchange(&record_sink->frames, 0, 0) > recorded, "real raw recording continues");
        CHECK(InterlockedCompareExchange(&stream_sink->frames, 0, 0) == streamed, "stream frames stopped");
        if (scenario != 2) CHECK(streamed > 0, "stream received real video frames");
        else CHECK(InterlockedCompareExchange(&stream_sink->late_attempted, 0, 0) &&
                   InterlockedCompareExchange(&stream_sink->late_succeeded, 0, 0), "late activation actually succeeded before watchdog stop");
        printf("PASS: %s; recording continues\n", scenario == 0 ? "lease expiry" : scenario == 1 ? "explicit revoke" : "late activation");
        join_pending(stream_sink);
        obs_output_release(stream); stream = NULL; stream_sink = NULL;
        obs_service_release(service); service = NULL;
    }
cleanup:
    m4_close_controller(&controller);
    for (unsigned i = 0; i < 9; ++i) if (capacity[i]) obs_service_release(capacity[i]);
    if (stream) { join_pending(stream_sink); obs_output_force_stop(stream); obs_output_release(stream); }
    if (service) obs_service_release(service);
    if (record) { obs_output_force_stop(record); obs_output_release(record); }
    if (settings) obs_data_release(settings);
    if (saved) obs_data_release(saved);
    if (initialized) obs_shutdown();
    if (leaked) { puts("FAIL: canary logged or recording write failed"); result = 1; }
    else if (!result) puts("PASS: no canary in captured libobs logs");
    base_set_log_handler(NULL, NULL);
    fclose(log_file); log_file = NULL;
    SecureZeroMemory(canary, sizeof(canary));
    return result;
}
