#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Install once on the startup thread BEFORE obs_startup/module loading. Keep
 * installed through obs_shutdown. Process-lifetime storage; no previous raw
 * logger is chained or restored. Only the owning host may set OBS's logger. */
void m4_log_guard_install(void);

/* Each counter is atomic and saturating. A concurrent snapshot is not a single
 * transactional instant. Severity is not a diagnosis of the transport cause. */
struct m4_log_guard_counts {
    uint64_t error, warning, info, debug, other;
};
struct m4_log_guard_counts m4_log_guard_snapshot(void);

/* Fixed-schema numeric diagnostics only. Returns 0 on missing/short buffer.
 * Never emits raw messages, format strings, arguments, URLs or provider text. */
size_t m4_log_guard_json(char *buffer, size_t capacity);

#ifdef __cplusplus
}
#endif
