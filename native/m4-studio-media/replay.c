#include "replay.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* 0 warming, 1 buffering, 2 saving, 3 preview, 4 entering, 5 replay, 6 returning, 7 unavailable. */
struct studio_replay {
    obs_source_t *live, *clip, *label, *sound;
    obs_scene_t *scene;
    obs_sceneitem_t *clip_item, *label_item;
    obs_output_t *buffer;
    uint32_t state, duration, start;
    ULONGLONG since, deadline, buffer_since, restart_at;
    volatile LONG saved;
    bool was_muted;
    wchar_t clip_path[2048];
    char clip_utf8[4096];
};
static void saved(void *context, calldata_t *cd) { (void)cd; InterlockedExchange(&((studio_replay *)context)->saved, 1); }
static obs_source_t *media_source(const char *name, const char *path)
{
    obs_data_t *s = obs_data_create();
    obs_data_set_bool(s, "is_local_file", true);
    obs_data_set_string(s, "local_file", path);
    obs_data_set_bool(s, "restart_on_activate", false);
    obs_data_set_bool(s, "close_when_inactive", false);
    obs_data_set_bool(s, "clear_on_media_end", false);
    obs_source_t *source = obs_source_create_private("ffmpeg_source", name, s);
    obs_data_release(s); return source;
}
/* Quiet original synthetic whoosh, generated locally; no downloaded sound assets. */
static bool sound_file(const wchar_t *cache, char *utf8, int capacity)
{
    wchar_t path[2048]; FILE *f = NULL;
    if (swprintf_s(path, 2048, L"%ls/replay-transition.wav", cache) < 0 ||
        !WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, path, -1, utf8, capacity, NULL, NULL) || _wfopen_s(&f, path, L"wb")) return false;
    unsigned char header[44] = {'R','I','F','F',0,0,0,0,'W','A','V','E','f','m','t',' ',16,0,0,0,1,0,1,0,0x80,0xbb,0,0,0,0x77,1,0,2,0,16,0,'d','a','t','a',0,0,0,0};
    uint32_t size = 24000, riff = size + 36, noise = 1; memcpy(header + 4, &riff, 4); memcpy(header + 40, &size, 4);
    bool ok = fwrite(header, 1, sizeof(header), f) == sizeof(header);
    int smooth = 0;
    for (int i = 0; i < 12000 && ok; i++) {
        noise = noise * 1664525u + 1013904223u;
        smooth = (smooth * 3 + (int)(noise >> 16) - 32768) / 4;
        int envelope = i < 3000 ? i : (12000 - i) / 3;
        int16_t sample = (int16_t)(smooth * envelope / 24000);
        ok = fwrite(&sample, sizeof(sample), 1, f) == 1;
    }
    return fclose(f) == 0 && ok;
}
static void label(studio_replay *r, const char *text, bool transition)
{
    obs_data_t *s = obs_source_get_settings(r->label);
    obs_data_set_string(s, "text", text);
    obs_source_update(r->label, s); obs_data_release(s);
    struct vec2 pos = {transition ? 500.0f : 32.0f, transition ? 440.0f : 28.0f};
    struct vec2 scale = {transition ? 3.0f : 1.0f, transition ? 3.0f : 1.0f};
    obs_sceneitem_set_pos(r->label_item, &pos); obs_sceneitem_set_scale(r->label_item, &scale);
    obs_sceneitem_set_visible(r->label_item, true);
}
static void buffer_start(studio_replay *r)
{
    r->buffer_since = GetTickCount64();
    r->state = obs_output_start(r->buffer) ? 0 : 7;
}
studio_replay *studio_replay_create(obs_source_t *live, obs_encoder_t *video, obs_encoder_t *audio, const wchar_t *cache)
{
    studio_replay *r = calloc(1, sizeof(*r)); char directory[4096], sound[4096];
    if (!r) return NULL;
    r->live = live;
    if (!WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, cache, -1, directory, sizeof(directory), NULL, NULL) ||
        swprintf_s(r->clip_path, 2048, L"%ls/replay.mp4", cache) < 0 ||
        !WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, r->clip_path, -1, r->clip_utf8, sizeof(r->clip_utf8), NULL, NULL) || !sound_file(cache, sound, sizeof(sound))) goto fail;
    obs_data_t *s = obs_data_create();
    obs_data_set_string(s, "directory", directory); obs_data_set_string(s, "format", "captured-replay");
    obs_data_set_string(s, "extension", "mp4"); obs_data_set_int(s, "max_time_sec", 62); obs_data_set_int(s, "max_size_mb", 64);
    r->buffer = obs_output_create("replay_buffer", "Studio local replay buffer", s, NULL); obs_data_release(s);
    if (!r->buffer) goto fail;
    obs_output_set_video_encoder(r->buffer, video); obs_output_set_audio_encoder(r->buffer, audio, 0);
    signal_handler_connect(obs_output_get_signal_handler(r->buffer), "saved", saved, r);
    r->clip = media_source("Studio replay clip", ""); r->sound = media_source("Studio replay transition", sound);
    s = obs_data_create(); obs_data_t *font = obs_data_create();
    obs_data_set_string(font, "face", "Arial"); obs_data_set_int(font, "size", 48); obs_data_set_int(font, "flags", 1);
    obs_data_set_obj(s, "font", font); obs_data_release(font);
    obs_data_set_string(s, "text", " REPLAY "); obs_data_set_int(s, "color", 0xffffff);
    obs_data_set_int(s, "bk_color", 0x302010); obs_data_set_int(s, "bk_opacity", 100);
    r->label = obs_source_create_private("text_gdiplus_v3", "Studio replay indicator", s); obs_data_release(s);
    if (!r->clip || !r->label || !r->sound) goto fail;
    obs_source_set_muted(r->clip, true); obs_source_set_muted(r->sound, true); obs_source_media_stop(r->sound);
    r->scene = obs_scene_create_private("Studio live and replay");
    if (!r->scene || !obs_scene_add(r->scene, live)) goto fail;
    r->clip_item = obs_scene_add(r->scene, r->clip); r->label_item = obs_scene_add(r->scene, r->label);
    if (!r->clip_item || !r->label_item || !obs_scene_add(r->scene, r->sound)) goto fail;
    obs_sceneitem_set_visible(r->clip_item, false); obs_sceneitem_set_visible(r->label_item, false);
    /* Keep the decoder available for private seek while its scene item is hidden. */
    obs_set_output_source(0, obs_scene_get_source(r->scene)); buffer_start(r);
    return r;
fail:
    studio_replay_destroy(r); obs_set_output_source(0, live); return NULL;
}
void studio_replay_cancel(studio_replay *r)
{
    if (!r) return;
    if (r->clip) { obs_source_set_muted(r->clip, true); obs_source_media_play_pause(r->clip, true); }
    if (r->clip_item) obs_sceneitem_set_visible(r->clip_item, false);
    if (r->label_item) obs_sceneitem_set_visible(r->label_item, false);
    if (r->sound) { obs_source_set_muted(r->sound, true); obs_source_media_stop(r->sound); }
    if (r->state >= 4 && r->state <= 6) {
        obs_source_set_muted(r->live, r->was_muted);
        /* Drain the shared encoder's delayed frames before accepting a new live window. */
        r->state = 0; r->buffer_since = 0; r->restart_at = GetTickCount64() + 2000;
    } else if (r->state == 3) r->state = 1;
}
void studio_replay_destroy(studio_replay *r)
{
    if (!r) return;
    studio_replay_cancel(r);
    if (r->buffer) { signal_handler_disconnect(obs_output_get_signal_handler(r->buffer), "saved", saved, r); if (obs_output_active(r->buffer)) obs_output_force_stop(r->buffer); obs_output_release(r->buffer); }
    obs_set_output_source(0, NULL);
    if (r->scene) obs_scene_release(r->scene);
    if (r->clip) obs_source_release(r->clip);
    if (r->label) obs_source_release(r->label);
    if (r->sound) obs_source_release(r->sound);
    free(r);
}
bool studio_replay_capture(studio_replay *r)
{
    if (!r || (r->state != 1 && r->state != 3) || !obs_output_active(r->buffer)) return false;
    /* Release the previous decoder's file handle before replacing the private snapshot. */
    obs_sceneitem_remove(r->clip_item); r->clip_item = NULL;
    obs_source_release(r->clip); r->clip = media_source("Studio replay clip", "");
    if (!r->clip) { r->state = 7; return false; }
    obs_source_set_muted(r->clip, true);
    r->clip_item = obs_scene_add(r->scene, r->clip);
    if (!r->clip_item) { r->state = 7; return false; }
    obs_sceneitem_set_visible(r->clip_item, false);
    obs_sceneitem_set_order(r->label_item, OBS_ORDER_MOVE_TOP);
    InterlockedExchange(&r->saved, 0); r->duration = 0; r->state = 2; r->deadline = GetTickCount64() + 15000;
    calldata_t cd = {0}; bool ok = proc_handler_call(obs_output_get_proc_handler(r->buffer), "save", &cd); calldata_free(&cd);
    if (!ok) r->state = 7; return ok;
}
bool studio_replay_play(studio_replay *r, uint32_t start_ms)
{
    if (!r || r->state != 3 || start_ms + 250 > r->duration || (r->duration > 60000 && start_ms < r->duration - 60000)) return false;
    r->start = start_ms; r->was_muted = obs_source_muted(r->live);
    obs_output_force_stop(r->buffer); /* Never record replay into the next replay window. */
    obs_source_media_set_time(r->clip, start_ms); obs_source_media_play_pause(r->clip, true);
    label(r, " REPLAY ", true); obs_source_set_muted(r->sound, false); obs_source_media_restart(r->sound);
    r->state = 4; r->deadline = GetTickCount64() + 500; return true;
}
void studio_replay_return(studio_replay *r)
{
    if (r && (r->state == 4 || r->state == 5)) {
        obs_source_set_muted(r->clip, true); label(r, " LIVE ", true);
        obs_source_set_muted(r->sound, false); obs_source_media_restart(r->sound);
        r->state = 6; r->deadline = GetTickCount64() + 500;
    } else if (!r || r->state != 6) studio_replay_cancel(r);
}
void studio_replay_tick(studio_replay *r)
{
    if (!r) return;
    ULONGLONG now = GetTickCount64();
    if ((r->state == 4 || r->state == 6) && now < r->deadline) {
        float progress = 1.0f - (float)(r->deadline - now) / 500.0f;
        struct vec2 position = {-700.0f + progress * 2600.0f, 440.0f};
        obs_sceneitem_set_pos(r->label_item, &position);
    }
    if (r->state == 0 && r->restart_at && now >= r->restart_at) {
        r->restart_at = 0; buffer_start(r);
    }
    if (r->state == 0 && r->buffer_since && now - r->buffer_since >= 3000) r->state = obs_output_active(r->buffer) ? 1 : 7;
    if (r->state == 2) {
        if (InterlockedExchange(&r->saved, 0)) {
            calldata_t cd = {0}; proc_handler_call(obs_output_get_proc_handler(r->buffer), "get_last_replay", &cd);
            const char *path = calldata_string(&cd, "path"); wchar_t source[2048];
            bool ok = path && MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, source, 2048) && CopyFileW(source, r->clip_path, FALSE);
            if (ok) DeleteFileW(source); calldata_free(&cd);
            if (!ok) { r->state = 7; return; }
            obs_data_t *s = obs_source_get_settings(r->clip); obs_data_set_string(s, "local_file", r->clip_utf8); obs_source_update(r->clip, s); obs_data_release(s);
        }
        int64_t duration = obs_source_media_get_duration(r->clip);
        if (duration > 250 && duration < 90000) {
            obs_source_media_play_pause(r->clip, true); r->duration = (uint32_t)duration; r->state = 3;
        } else if (now > r->deadline) r->state = 7;
    } else if (r->state == 4 && now >= r->deadline) {
        obs_source_set_muted(r->live, true); obs_source_set_muted(r->clip, false);
        obs_sceneitem_set_visible(r->clip_item, true); label(r, " REPLAY ", false);
        obs_source_media_set_time(r->clip, r->start); obs_source_media_play_pause(r->clip, false);
        r->state = 5; r->since = now; r->deadline = now + r->duration - r->start + 1500;
    } else if (r->state == 5) {
        enum obs_media_state state = obs_source_media_get_state(r->clip);
        if (now >= r->deadline || state == OBS_MEDIA_STATE_ERROR || (now > r->since + 500 && (state == OBS_MEDIA_STATE_ENDED || state == OBS_MEDIA_STATE_STOPPED))) {
            studio_replay_return(r);
        }
    } else if (r->state == 6 && now >= r->deadline) studio_replay_cancel(r);
}
void studio_replay_status(studio_replay *r, uint32_t *state, uint32_t *duration, uint32_t *available)
{
    *state = r ? r->state : 7; *duration = r ? r->duration : 0; *available = 0;
    if (r && r->buffer_since && r->state < 4) { ULONGLONG age = GetTickCount64() - r->buffer_since; *available = (uint32_t)(age > 60000 ? 60000 : age); }
}
