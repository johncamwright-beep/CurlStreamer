#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <wchar.h>
#include <windows.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct m4_media m4_media;
/* One process-owned OBS instance; both paths must be absolute local paths.
 * Destination is exclusively created and kept reserved. Existing files fail.
 * Failed initialization may leave the new empty reservation file for diagnosis. */
bool m4_media_initialize(const wchar_t *runtime_bin, const wchar_t *absolute_mkv, m4_media **out);
/* Public loopback proof only. Fresh private cache directory must not exist.
 * URL is exactly http://127.0.0.1:<port>/; no credentials/query/fragment. */
bool m4_media_initialize_program(const wchar_t *runtime_bin, const wchar_t *absolute_mkv, const wchar_t *fresh_cache_root, const char *public_loopback_url, m4_media **out);
bool m4_media_start(m4_media *media);
/* Optional production memory-service output, sharing the program encoders.
 * Binding grants no stream authority; default plugin ARM remains denied. */
bool m4_media_prepare_stream(m4_media *media, const wchar_t *runtime_bin, const wchar_t *absolute_plugin);
/* Transfers the overlapped private pipe only on success. */
bool m4_media_attach_stream(m4_media *media, HANDLE pipe, const unsigned char capability[32], uint32_t parent_pid);
void m4_media_poll_stream(m4_media *media);
bool m4_media_active(const m4_media *media);
uint64_t m4_media_bytes(const m4_media *media);
/* One-shot graceful stop. True only after the actual successful OBS stop signal.
 * Bounded wait (1..30000ms); false is never evidence of a finalized recording.
 * May be called again to await an already requested stop. */
bool m4_media_finalize(m4_media *media, uint32_t timeout_ms);
/* Refuses an active/pending-stop instance; never frees callbacks in flight.
 * OBS release/shutdown are library joins, not a hard OS deadline. The owning
 * process supplies a final shutdown deadline. On success sets *media to NULL. */
bool m4_media_release(m4_media **media);
#ifdef __cplusplus
}
#endif
