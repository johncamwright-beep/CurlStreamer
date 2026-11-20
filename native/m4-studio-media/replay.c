#include "replay.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* 0 warming, 1 buffering, 2 saving, 3 preview, 4 entering, 5 replay, 6 returning, 7 unavailable. */
struct studio_replay {
    obs_source_t *live, *clip, *label, *sound, *wash, *transition;
    obs_scene_t *scene;
    obs_sceneitem_t *clip_item, *label_item, *transition_item;
    bool switched;
    obs_output_t *buffer;
    uint32_t state, duration, start;
    ULONGLONG since, deadline, buffer_since, restart_at;
    volatile LONG saved;
    bool was_muted;
    float live_volume, clip_volume;
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
/* OBS performs the full-frame swipe. Switch the program only under the opaque card. */
static obs_source_t *text_card(const char *name, int height, int size, uint32_t color)
{
    obs_data_t *s = obs_data_create(), *font = obs_data_create();
    obs_data_set_string(font, "face", "Arial"); obs_data_set_int(font, "size", size); obs_data_set_int(font, "flags", 1);
    obs_data_set_obj(s, "font", font); obs_data_release(font);
    obs_data_set_string(s, "text", "REPLAY"); obs_data_set_int(s, "color", 0xffffff);
    obs_data_set_int(s, "bk_color", color); obs_data_set_int(s, "bk_opacity", 100);
    obs_data_set_bool(s, "extents", true); obs_data_set_int(s, "extents_cx", 1920); obs_data_set_int(s, "extents_cy", height);
    obs_data_set_string(s, "align", "center"); obs_data_set_string(s, "valign", "center");
    obs_source_t *source = obs_source_create_private("text_gdiplus_v3", name, s);
    obs_data_release(s); return source;
}
static void wash_start(studio_replay *r, bool returning)
{
    obs_data_t *s = obs_source_get_settings(r->wash);
    obs_data_set_string(s, "text", returning ? "LIVE" : "REPLAY");
    obs_data_set_int(s, "bk_color", returning ? 0x78551a : 0x2424c7);
    obs_source_update(r->wash, s); obs_data_release(s);
    obs_transition_set(r->transition, NULL);
    obs_transition_start(r->transition, OBS_TRANSITION_MODE_AUTO, 450, r->wash);
    r->switched = false; r->since = GetTickCount64(); r->deadline = r->since + 1100;
    obs_source_set_muted(r->sound, false); obs_source_media_restart(r->sound);
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
    r->label = text_card("Studio replay indicator", 84, 52, 0x2424c7);
    r->wash = text_card("Studio replay wash", 1080, 144, 0x2424c7);
    s = obs_data_create(); obs_data_set_string(s, "direction", "left"); obs_data_set_bool(s, "swipe_in", true);
    r->transition = obs_source_create_private("swipe_transition", "Studio OBS replay wipe", s); obs_data_release(s);
    if (!r->clip || !r->label || !r->sound || !r->wash || !r->transition) goto fail;
    obs_transition_set_size(r->transition, 1920, 1080); obs_transition_set(r->transition, NULL);
    obs_source_set_muted(r->clip, true); obs_source_set_muted(r->sound, true); obs_source_media_stop(r->sound);
    r->scene = obs_scene_create_private("Studio live and replay");
    if (!r->scene || !obs_scene_add(r->scene, live)) goto fail;
    r->clip_item = obs_scene_add(r->scene, r->clip); r->label_item = obs_scene_add(r->scene, r->label);
    if (!r->clip_item || !r->label_item || !obs_scene_add(r->scene, r->sound)) goto fail;
    r->transition_item = obs_scene_add(r->scene, r->transition);
    if (!r->transition_item) goto fail;
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
    if (r->transition) obs_transition_set(r->transition, NULL);
    if (r->clip) { obs_source_set_muted(r->clip, true); obs_source_media_play_pause(r->clip, true); }
    if (r->clip_item) obs_sceneitem_set_visible(r->clip_item, false);
    if (r->label_item) obs_sceneitem_set_visible(r->label_item, false);
    if (r->sound) { obs_source_set_muted(r->sound, true); obs_source_media_stop(r->sound); }
    if (r->state >= 4 && r->state <= 6) {
        obs_source_set_volume(r->live, r->live_volume);
        obs_source_set_volume(r->clip, r->clip_volume);
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
    if (r->transition) obs_source_release(r->transition);
    if (r->wash) obs_source_release(r->wash);
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
    obs_sceneitem_set_order(r->transition_item, OBS_ORDER_MOVE_TOP);
    InterlockedExchange(&r->saved, 0); r->duration = 0; r->state = 2; r->deadline = GetTickCount64() + 15000;
    calldata_t cd = {0}; bool ok = proc_handler_call(obs_output_get_proc_handler(r->buffer), "save", &cd); calldata_free(&cd);
    if (!ok) r->state = 7; return ok;
}
bool studio_replay_play(studio_replay *r, uint32_t start_ms)
{
    if (!r || r->state != 3 || start_ms + 250 > r->duration || (r->duration > 60000 && start_ms < r->duration - 60000)) return false;
    r->start = start_ms; r->was_muted = obs_source_muted(r->live);
    r->live_volume = obs_source_get_volume(r->live); r->clip_volume = obs_source_get_volume(r->clip);
    obs_output_force_stop(r->buffer); /* Never record replay into the next replay window. */
    obs_source_media_set_time(r->clip, start_ms); obs_source_media_play_pause(r->clip, true);
    wash_start(r, false); r->state = 4; return true;
}
void studio_replay_return(studio_replay *r)
{
    if (r && (r->state == 4 || r->state == 5)) {
        wash_start(r, true); r->state = 6;
    } else if (!r || r->state != 6) studio_replay_cancel(r);
}
void studio_replay_tick(studio_replay *r)
{
    if (!r) return;
    ULONGLONG now = GetTickCount64();
    if ((r->state == 4 || r->state == 6) && !r->switched && now >= r->since + 650) {
        bool entering = r->state == 4;
        obs_source_set_muted(r->live, entering ? true : r->was_muted);
        obs_source_set_muted(r->clip, !entering);
        obs_sceneitem_set_visible(r->clip_item, entering); obs_sceneitem_set_visible(r->label_item, entering);
        if (entering) obs_source_media_set_time(r->clip, r->start);
        obs_source_media_play_pause(r->clip, !entering);
        obs_transition_start(r->transition, OBS_TRANSITION_MODE_AUTO, 450, NULL);
        r->switched = true;
    }
    if (r->state == 4 || r->state == 6) {
        /* 300 ms fade down before the covered cut, 300 ms ramp up after it.
         * Restore the original source gains; never alter microphone calibration. */
        float elapsed = (float)(now - r->since);
        float outgoing = elapsed <= 350 ? 1.0f : elapsed >= 650 ? 0.0f : (650.0f - elapsed) / 300.0f;
        float incoming = elapsed <= 650 ? 0.0f : elapsed >= 950 ? 1.0f : (elapsed - 650.0f) / 300.0f;
        obs_source_set_volume(r->live, r->live_volume * (r->state == 4 ? outgoing : incoming));
        obs_source_set_volume(r->clip, r->clip_volume * (r->state == 4 ? incoming : outgoing));
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
