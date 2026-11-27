#pragma once
#include <obs.h>
#include <windows.h>
#include <stdint.h>
typedef struct studio_replay studio_replay;
/* Private process-owned buffer. No network, credentials, or caller-selected paths. */
studio_replay *studio_replay_create(obs_source_t *live, obs_encoder_t *video, obs_encoder_t *audio, const wchar_t *cache);
void studio_replay_destroy(studio_replay *r);
void studio_replay_tick(studio_replay *r);
bool studio_replay_capture(studio_replay *r);
bool studio_replay_play(studio_replay *r, uint32_t start_ms);
void studio_replay_return(studio_replay *r);
void studio_replay_cancel(studio_replay *r);
void studio_replay_status(studio_replay *r, uint32_t *state, uint32_t *duration, uint32_t *available);
