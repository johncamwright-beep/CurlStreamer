#pragma once
#include <obs.h>
#include <windows.h>
#include <stdint.h>
typedef struct studio_coach studio_coach;
studio_coach *studio_coach_create(obs_source_t *live, const wchar_t *cache);
void studio_coach_destroy(studio_coach *c);
void studio_coach_tick(studio_coach *c);
bool studio_coach_capture(studio_coach *c);
void studio_coach_status(studio_coach *c, uint32_t *state, uint32_t *available);
