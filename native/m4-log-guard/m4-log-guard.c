#include "m4-log-guard.h"
#include <windows.h>
#include <util/base.h>
#include <stdio.h>
#include <string.h>

static volatile LONG64 counts[5];

static void count_only(int level, const char *format, va_list arguments, void *context)
{
    unsigned index;
    LONG64 current;
    /* Do not inspect even the format pointer: OBS output/server text is
     * untrusted and may contain all or any transformed fragment of a key. */
    (void)format;
    (void)arguments;
    (void)context;
    switch (level) {
    case LOG_ERROR: index = 0; break;
    case LOG_WARNING: index = 1; break;
    case LOG_INFO: index = 2; break;
    case LOG_DEBUG: index = 3; break;
    default: index = 4; break;
    }
    current = InterlockedCompareExchange64(&counts[index], 0, 0);
    while (current < INT64_MAX) {
        LONG64 observed = InterlockedCompareExchange64(&counts[index], current + 1, current);
        if (observed == current) break;
        current = observed;
    }
}

void m4_log_guard_install(void)
{
    base_set_log_handler(count_only, NULL);
}

struct m4_log_guard_counts m4_log_guard_snapshot(void)
{
    struct m4_log_guard_counts result;
    result.error = (uint64_t)InterlockedCompareExchange64(&counts[0], 0, 0);
    result.warning = (uint64_t)InterlockedCompareExchange64(&counts[1], 0, 0);
    result.info = (uint64_t)InterlockedCompareExchange64(&counts[2], 0, 0);
    result.debug = (uint64_t)InterlockedCompareExchange64(&counts[3], 0, 0);
    result.other = (uint64_t)InterlockedCompareExchange64(&counts[4], 0, 0);
    return result;
}

size_t m4_log_guard_json(char *buffer, size_t capacity)
{
    struct m4_log_guard_counts result = m4_log_guard_snapshot();
    char safe[256];
    int length = snprintf(safe, sizeof(safe),
        "{\"schema\":\"m4-obs-log-counts-v1\",\"error\":%llu,\"warning\":%llu,\"info\":%llu,\"debug\":%llu,\"other\":%llu}",
        (unsigned long long)result.error, (unsigned long long)result.warning,
        (unsigned long long)result.info, (unsigned long long)result.debug,
        (unsigned long long)result.other);
    if (!buffer || length < 0 || (size_t)length >= capacity || (size_t)length >= sizeof(safe)) {
        if (buffer && capacity) buffer[0] = '\0';
        return 0;
    }
    memcpy(buffer, safe, (size_t)length + 1);
    return (size_t)length;
}
