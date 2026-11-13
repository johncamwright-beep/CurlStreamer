#include "m4-studio-media.h"
#include <windows.h>
#include <obs.h>
#include <stdio.h>
static uint64_t checksum(const wchar_t *path)
{
    HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    unsigned char buffer[4096]; DWORD got; uint64_t sum = 1469598103934665603ULL;
    if (file == INVALID_HANDLE_VALUE) return 0;
    while (ReadFile(file, buffer, sizeof(buffer), &got, NULL) && got)
        for (DWORD i = 0; i < got; ++i) sum = (sum ^ buffer[i]) * 1099511628211ULL;
    CloseHandle(file); return sum;
}
#define CHECK(expr) do { if (!(expr)) { fprintf(stderr, "Validation failed at line %d\n", __LINE__); result = 1; goto done; } } while(0)
int wmain(int argc, wchar_t **argv)
{
    m4_media *media = NULL, *duplicate = NULL; int result = 0;
    uint64_t sum, bytes; struct obs_video_info video; struct obs_audio_info audio;
    if (argc != 3 && argc != 5) return 2;
    if (argc == 5) {
        char url[128];
        CHECK(WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[4], -1, url, sizeof(url), NULL, NULL));
        CHECK(!m4_media_initialize_program(argv[1], argv[2], argv[3], "http://127.0.0.1:5000/?code=forbidden", &duplicate));
        CHECK(!m4_media_initialize_program(argv[1], argv[2], argv[3], "https://example.com/", &duplicate));
        CHECK(m4_media_initialize_program(argv[1], argv[2], argv[3], url, &media));
        Sleep(2500);

    } else CHECK(m4_media_initialize(argv[1], argv[2], &media));
    CHECK(obs_get_video_info(&video) && video.output_width == 1920 && video.output_height == 1080 && video.fps_num == 30 && video.fps_den == 1 && video.output_format == VIDEO_FORMAT_NV12);
    CHECK(obs_get_audio_info(&audio) && audio.samples_per_sec == 48000 && audio.speakers == SPEAKERS_STEREO);
    CHECK(m4_media_start(media));
    CHECK(!m4_media_start(media));
    CHECK(!m4_media_release(&media)); /* A live recording is never freed. */
    Sleep(2600);
    CHECK(m4_media_active(media));
    CHECK(m4_media_finalize(media, 5000));
    CHECK(!m4_media_active(media));
    bytes = m4_media_bytes(media); CHECK(bytes > 1000);
    CHECK(!m4_media_start(media));
    CHECK(m4_media_release(&media));
    sum = checksum(argv[2]); CHECK(sum != 0);
    CHECK(!m4_media_initialize(argv[1], argv[2], &duplicate));
    CHECK(!duplicate && checksum(argv[2]) == sum);
    if (argc == 5) {
        wchar_t retry[2048], preferences[2048]; char url[128]; uint64_t preferences_sum;
        CHECK(swprintf_s(retry, 2048, L"%ls.retry.mkv", argv[2]) > 0);
        CHECK(swprintf_s(preferences, 2048, L"%ls/obs-browser/UserPrefs.json", argv[3]) > 0);
        preferences_sum = checksum(preferences); CHECK(preferences_sum != 0);
        CHECK(WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[4], -1, url, sizeof(url), NULL, NULL));
        CHECK(!m4_media_initialize_program(argv[1], retry, argv[3], url, &duplicate));
        CHECK(!duplicate && checksum(preferences) == preferences_sum);
    }
    puts("PASS: fixed 1080p30 NV12/stereo MKV stop signal completed; existing destination preserved");
done:
    if (media) { m4_media_finalize(media, 5000); m4_media_release(&media); }
    return result;
}
