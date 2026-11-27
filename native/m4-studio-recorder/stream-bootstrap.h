#pragma once
#include "../m4-studio-media/m4-studio-media.h"
/* Writes only the existing versioned 296-byte frame. Connect/authentication
 * failure disables this stream channel without stopping program recording. */
bool m4_recorder_stream_bootstrap(m4_media *media, HANDLE output, HANDLE parent, DWORD parent_pid);
