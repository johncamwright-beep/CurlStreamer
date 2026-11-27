#include "coach.h"
#include <stdlib.h>
#include <stdio.h>
/* Optional silent coach view: never changes the on-air source, replay, or audio.
 * 0 warming, 1 buffering, 2 saving, 3 snapshot ready, 7 unavailable. */
struct studio_coach {
    obs_view_t *view;
    obs_encoder_t *encoder, *audio;
    obs_output_t *buffer;
    uint32_t state;
    ULONGLONG since, deadline;
    volatile LONG saved;
    wchar_t snapshot[2048];
};
static void coach_saved(void *context, calldata_t *data)
{ (void)data; InterlockedExchange(&((studio_coach *)context)->saved, 1); }
studio_coach *studio_coach_create(obs_source_t *live, const wchar_t *cache)
{
    studio_coach *c = calloc(1, sizeof(*c)); char directory[4096];
    struct obs_video_info video = {0};
    if (!c) return NULL;
    if (!live || !obs_get_video_info(&video) ||
        !WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, cache, -1, directory, sizeof(directory), NULL, NULL) ||
        swprintf_s(c->snapshot, 2048, L"%ls/coach.mp4", cache) < 0) goto fail;
    c->view = obs_view_create();
    if (!c->view) goto fail;
    obs_view_set_source(c->view, 0, live);
    video.output_width = 960; video.output_height = 540;
    /* View uses the program clock; encoder divisor reduces preview frame rate. */
    video_t *output = obs_view_add2(c->view, &video);
    if (!output) goto fail;
    obs_data_t *s = obs_data_create();
    obs_data_set_string(s, "rate_control", "CBR"); obs_data_set_int(s, "bitrate", 1200);
    obs_data_set_string(s, "preset", "ultrafast"); obs_data_set_int(s, "keyint_sec", 1);
    c->encoder = obs_video_encoder_create("obs_x264", "Local coach preview video", s, NULL);
    obs_data_release(s);
    if (!c->encoder) goto fail;
    obs_encoder_set_video(c->encoder, output);
    if (!obs_encoder_set_frame_rate_divisor(c->encoder, 2)) goto fail;
    /* Replay muxer requires audio. The phone exporter strips this disposable track. */
    s = obs_data_create(); obs_data_set_int(s, "bitrate", 64);
    c->audio = obs_audio_encoder_create("ffmpeg_aac", "Disposable local coach track", s, 5, NULL);
    obs_data_release(s); if (!c->audio) goto fail;
    obs_encoder_set_audio(c->audio, obs_get_audio());
    s = obs_data_create();
    obs_data_set_string(s, "directory", directory); obs_data_set_string(s, "format", "captured-coach");
    obs_data_set_string(s, "extension", "mp4"); obs_data_set_int(s, "max_time_sec", 122); obs_data_set_int(s, "max_size_mb", 32);
    c->buffer = obs_output_create("replay_buffer", "Independent local coach buffer", s, NULL);
    obs_data_release(s);
    if (!c->buffer) goto fail;
    obs_output_set_video_encoder(c->buffer, c->encoder);
    obs_output_set_audio_encoder(c->buffer, c->audio, 0);
    signal_handler_connect(obs_output_get_signal_handler(c->buffer), "saved", coach_saved, c);
    if (!obs_output_start(c->buffer)) goto fail;
    c->since = GetTickCount64();
    return c;
fail:
    studio_coach_destroy(c); return NULL;
}
void studio_coach_destroy(studio_coach *c)
{
    if (!c) return;
    if (c->buffer) {
        signal_handler_disconnect(obs_output_get_signal_handler(c->buffer), "saved", coach_saved, c);
        if (obs_output_active(c->buffer)) obs_output_force_stop(c->buffer);
        obs_output_release(c->buffer);
    }
    if (c->encoder) obs_encoder_release(c->encoder);
    if (c->audio) obs_encoder_release(c->audio);
    if (c->view) { obs_view_remove(c->view); obs_view_set_source(c->view, 0, NULL); obs_view_destroy(c->view); }
    free(c);
}
bool studio_coach_capture(studio_coach *c)
{
    if (!c || (c->state != 1 && c->state != 3) || !obs_output_active(c->buffer)) return false;
    c->state = 2; c->deadline = GetTickCount64() + 15000; InterlockedExchange(&c->saved, 0);
    calldata_t data = {0};
    bool ok = proc_handler_call(obs_output_get_proc_handler(c->buffer), "save", &data);
    calldata_free(&data); if (!ok) c->state = 7;
    return ok;
}
void studio_coach_tick(studio_coach *c)
{
    if (!c) return;
    if (!obs_output_active(c->buffer)) { c->state = 7; return; }
    ULONGLONG now = GetTickCount64();
    if (c->state == 0 && now - c->since >= 3000) c->state = 1;
    if (c->state == 2 && InterlockedExchange(&c->saved, 0)) {
        calldata_t data = {0};
        proc_handler_call(obs_output_get_proc_handler(c->buffer), "get_last_replay", &data);
        const char *path = calldata_string(&data, "path"); wchar_t source[2048];
        bool ok = path && MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, source, 2048) && CopyFileW(source, c->snapshot, FALSE);
        if (ok) DeleteFileW(source);
        calldata_free(&data); c->state = ok ? 3 : 7;
    } else if (c->state == 2 && now > c->deadline) c->state = 7;
}
void studio_coach_status(studio_coach *c, uint32_t *state, uint32_t *available)
{
    *state = c ? c->state : 7; *available = 0;
    if (c && c->state != 7) { ULONGLONG age = GetTickCount64() - c->since; *available = (uint32_t)(age > 120000 ? 120000 : age); }
}
