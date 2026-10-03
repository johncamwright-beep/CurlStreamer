#include "m4-log-guard.h"
#include <windows.h>
#include <util/base.h>
#include <stdio.h>
#include <string.h>

#define REQUIRE(condition) do { if (!(condition)) { puts("FAIL: log guard invariant"); return 1; } } while (0)
static LONG old_handler_calls;
static void old_handler(int level, const char *format, va_list args, void *context)
{
    (void)level; (void)format; (void)args; (void)context;
    InterlockedIncrement(&old_handler_calls);
}
static DWORD WINAPI worker(void *context)
{
    (void)context;
    for (unsigned i = 0; i < 10000; ++i)
        blog(LOG_ERROR, "Server error: %s", "m4-canary-never-export");
    return 0;
}

int main(void)
{
    char output[256], tiny[2] = {'x', 'x'};
    HANDLE threads[8];
    int untouched = 71;
    struct m4_log_guard_counts snapshot;
    base_set_log_handler(old_handler, NULL);
    m4_log_guard_install();
    /* Actual libobs dispatcher, simulated server-controlled descriptions. */
    blog(LOG_ERROR, "Server error: %s", "m4-canary-never-export");
    blog(LOG_ERROR, "Server error: %s%s", "m4-canary-", "never-export");
    blog(LOG_ERROR, "Server error: %%6d%%34%%2dcanary");
    blog(LOG_WARNING, "Server error: M4-CANARY-NEVER-EXPORT");
    blog(LOG_INFO, "Server error: bTQtY2FuYXJ5LW5ldmVyLWV4cG9ydA==");
    blog(LOG_DEBUG, "Server error: %n", &untouched);
    blog(-900, "%q%s%", (const char *)(uintptr_t)1);
    blog(LOG_ERROR, (const char *)(uintptr_t)1);
    REQUIRE(untouched == 71);
    REQUIRE(old_handler_calls == 0);
    snapshot = m4_log_guard_snapshot();
    REQUIRE(snapshot.error == 4 && snapshot.warning == 1 && snapshot.info == 1 && snapshot.debug == 1 && snapshot.other == 1);
    REQUIRE(m4_log_guard_json(output, sizeof(output)) > 0);
    REQUIRE(strcmp(output, "{\"schema\":\"m4-obs-log-counts-v1\",\"error\":4,\"warning\":1,\"info\":1,\"debug\":1,\"other\":1}") == 0);
    REQUIRE(m4_log_guard_json(tiny, sizeof(tiny)) == 0 && tiny[0] == '\0');
    REQUIRE(m4_log_guard_json(NULL, 256) == 0);
    for (unsigned i = 0; i < 8; ++i) {
        threads[i] = CreateThread(NULL, 0, worker, NULL, 0, NULL);
        REQUIRE(threads[i] != NULL);
    }
    REQUIRE(WaitForMultipleObjects(8, threads, TRUE, 10000) == WAIT_OBJECT_0);
    for (unsigned i = 0; i < 8; ++i) CloseHandle(threads[i]);
    REQUIRE(m4_log_guard_snapshot().error == 80004);
    REQUIRE(old_handler_calls == 0);
    puts("PASS: real OBS callbacks export only fixed numeric diagnostics; concurrent counts retained");
    return 0;
}
