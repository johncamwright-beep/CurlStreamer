/* Test-only real RTMP output to fixed loopback; no TLS or provider calls. */
#include <windows.h>
#include <obs.h>
#include <util/base.h>
#include <stdio.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
typedef bool (*arm_fn)(obs_service_t *, const char *, const char *, uint32_t);
typedef void (*revoke_fn)(obs_service_t *);
static const char *canary = "m4-canary-loopback";
static FILE *log_file;
static LONG leaked;
static void logger(int level, const char *format, va_list args, void *unused)
{
    va_list copy; char *line; int length; (void)level; (void)unused;
    va_copy(copy, args); length = _vscprintf(format, copy); va_end(copy);
    if (length < 0 || !(line = malloc((size_t)length + 1))) { InterlockedExchange(&leaked, 1); return; }
    vsnprintf(line, (size_t)length + 1, format, args);
    if (strstr(line, canary)) InterlockedExchange(&leaked, 1);
    if (log_file) { fprintf(log_file, "%s\n", line); fflush(log_file); }
    free(line);
}
static bool module(const char *runtime, const char *name)
{
    char dll[1024], data[1024]; obs_module_t *m = NULL;
    snprintf(dll, sizeof(dll), "%s/../../obs-plugins/64bit/%s.dll", runtime, name);
    snprintf(data, sizeof(data), "%s/../../data/obs-plugins/%s", runtime, name);
    return obs_open_module(&m, dll, data) == MODULE_SUCCESS && obs_init_module(m);
}
#define CHECK(value, label) do { if (!(value)) { printf("FAIL: %s\n", label); result = 1; goto cleanup; } } while (0)
int main(int argc, char **argv)
{
    int result = 0; bool initialized = false; obs_module_t *plugin = NULL;
    obs_service_t *service = NULL; obs_output_t *stream = NULL, *record = NULL;
    obs_encoder_t *video_encoder = NULL, *audio_encoder = NULL;
    obs_data_t *settings = NULL, *saved = NULL;
    struct obs_video_info video = {0}; struct obs_audio_info audio = {0};
    char graphics[1024], data[1024]; HMODULE dll; arm_fn arm; revoke_fn revoke;
    ULONGLONG deadline; uint64_t record_before = 0, stream_bytes = 0;
    if (argc != 4 || (strcmp(argv[3], "stop") && strcmp(argv[3], "expiry"))) return 2;
    SetDllDirectoryA(argv[2]);
    if (fopen_s(&log_file, "transport.log", "wb")) return 2;
    base_set_log_handler(logger, NULL);
    CHECK(obs_startup("en-US", NULL, NULL), "startup"); initialized = true;
    snprintf(graphics, sizeof(graphics), "%s/libobs-d3d11.dll", argv[2]);
    snprintf(data, sizeof(data), "%s/../../data/libobs/", argv[2]);
#pragma warning(push)
#pragma warning(disable : 4996)
    obs_add_data_path(data);
#pragma warning(pop)
    CHECK(obs_open_module(&plugin, argv[1], ".") == MODULE_SUCCESS && obs_init_module(plugin), "test plugin");
    dll = GetModuleHandleA(argv[1]); CHECK(dll, "loaded plugin");
    arm = (arm_fn)(void *)GetProcAddress(dll, "m4_test_arm");
    revoke = (revoke_fn)(void *)GetProcAddress(dll, "m4_test_revoke");
    CHECK(arm && revoke, "test controls");
    CHECK(module(argv[2], "obs-outputs") && module(argv[2], "obs-x264") && module(argv[2], "obs-ffmpeg"), "real output and encoder modules");
    video.graphics_module = graphics; video.fps_num = 30; video.fps_den = 1;
    video.base_width = video.output_width = 128; video.base_height = video.output_height = 128;
    video.output_format = VIDEO_FORMAT_NV12; video.colorspace = VIDEO_CS_709;
    video.range = VIDEO_RANGE_PARTIAL; video.scale_type = OBS_SCALE_BILINEAR;
    CHECK(obs_reset_video(&video) == OBS_VIDEO_SUCCESS, "video");
    audio.samples_per_sec = 48000; audio.speakers = SPEAKERS_STEREO;
    CHECK(obs_reset_audio(&audio), "audio");
    settings = obs_data_create(); obs_data_set_string(settings, "rate_control", "CBR");
    obs_data_set_int(settings, "bitrate", 300); obs_data_set_string(settings, "preset", "ultrafast");
    obs_data_set_int(settings, "keyint_sec", 1);
    video_encoder = obs_video_encoder_create("obs_x264", "Loopback video", settings, NULL);
    obs_data_release(settings); settings = NULL;
    audio_encoder = obs_audio_encoder_create("ffmpeg_aac", "Loopback silent audio", NULL, 0, NULL);
    CHECK(video_encoder && audio_encoder, "encoders");
    obs_encoder_set_video(video_encoder, obs_get_video()); obs_encoder_set_audio(audio_encoder, obs_get_audio());
    settings = obs_data_create(); obs_data_set_string(settings, "path", "independent.mkv");
    record = obs_output_create("ffmpeg_muxer", "Independent MKV", settings, NULL);
    obs_data_release(settings); settings = NULL;
    stream = obs_output_create("rtmp_output", "Loopback RTMP", NULL, NULL);
    service = obs_service_create("curlstreamer_m4_memory", "Loopback test service", NULL, NULL);
    CHECK(record && stream && service, "outputs");
    obs_output_set_video_encoder(record, video_encoder); obs_output_set_audio_encoder(record, audio_encoder, 0);
    obs_output_set_video_encoder(stream, video_encoder); obs_output_set_audio_encoder(stream, audio_encoder, 0);
    obs_output_set_service(stream, service);
    CHECK(!arm(service, "rtmp://127.0.0.2:19359/live2", canary, 5000), "non-allowlisted endpoint denied");
    CHECK(arm(service, "rtmp://127.0.0.1:19359/live2", canary, 7000), "loopback-only arm");
    CHECK(obs_output_start(record), "MKV start");
    CHECK(obs_output_start(stream), "RTMP start");
    deadline = GetTickCount64() + 4500;
    while (GetTickCount64() < deadline && obs_output_get_total_bytes(stream) < 1000) Sleep(50);
    CHECK(obs_output_active(stream) && obs_output_get_total_bytes(stream) >= 1000, "real RTMP media sent");
    stream_bytes = obs_output_get_total_bytes(stream);
    if (!strcmp(argv[3], "stop")) revoke(service);
    deadline = GetTickCount64() + 8000;
    while (GetTickCount64() < deadline && obs_output_active(stream)) Sleep(20);
    CHECK(!obs_output_active(stream), "watchdog stops RTMP");
    CHECK(obs_output_active(record), "MKV remains active");
    record_before = obs_output_get_total_bytes(record); Sleep(1200);
    CHECK(obs_output_active(record) && obs_output_get_total_bytes(record) > record_before, "MKV continues encoded packets");
    CHECK(!obs_service_get_connect_info(service, OBS_SERVICE_CONNECT_INFO_STREAM_KEY)[0], "revoked key unavailable");
    saved = obs_service_get_settings(service);
    CHECK(!strstr(obs_data_get_json(saved), canary), "settings contain no canary");
    CHECK(obs_data_save_json_safe(saved, "service.json", "tmp", "bak"), "settings save");
    CHECK(!leaked, "OBS logs contain no canary");
    printf("PASS: %s; RTMP bytes=%llu; MKV continued after stream stop\n", argv[3], (unsigned long long)stream_bytes);
cleanup:
    if (stream) obs_output_force_stop(stream);
    if (record) { obs_output_stop(record); deadline = GetTickCount64() + 3000; while (obs_output_active(record) && GetTickCount64() < deadline) Sleep(20); }
    if (stream) obs_output_release(stream); if (record) obs_output_release(record);
    if (service) obs_service_release(service); if (video_encoder) obs_encoder_release(video_encoder);
    if (audio_encoder) obs_encoder_release(audio_encoder); if (saved) obs_data_release(saved); if (settings) obs_data_release(settings);
    if (initialized) obs_shutdown();
    if (leaked) { puts("FAIL: canary appeared in captured OBS log"); result = 1; }
    if (log_file) fclose(log_file);
    return result;
}
