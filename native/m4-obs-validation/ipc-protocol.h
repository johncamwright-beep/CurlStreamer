#pragma once
#include <windows.h>
#include <stdint.h>
#define M4_IPC_MAGIC 0x4d344950u
enum { IPC_EXPIRE, IPC_DISCONNECT, IPC_KILL, IPC_RENEW, IPC_STOP, IPC_BAD_TOKEN, IPC_OVERSIZE, IPC_REPLAY, IPC_STALL, IPC_DEFAULT, IPC_START_FAILURE, IPC_EXPIRE_BEFORE_START, IPC_PRODUCTION_ARM, IPC_PRODUCTION_BAD_KEY, IPC_PRODUCTION_BAD_URL, IPC_PRODUCTION_BAD_LEASE };
typedef struct { uint32_t magic, version, opcode, length, sequence; unsigned char token[32]; } IpcHeader;
typedef struct { uint32_t lease_ms; char server[256], key[256]; } IpcArm;
typedef struct { uint32_t magic, sequence, status, state; } IpcReply;
typedef struct { IpcReply reply; uint32_t output, failure; uint64_t bytes; } IpcObservation;
typedef struct { WCHAR pipe[128]; unsigned char token[32]; char canary[80]; uint32_t scenario; uintptr_t started; } IpcBootstrap;
/* Versioned Studio frame: no validation metadata or inheritable event handle. */
typedef struct { uint32_t magic; uint16_t version, reserved; WCHAR pipe[128]; unsigned char token[32]; } StudioBootstrap;
typedef char StudioBootstrapMustBe296Bytes[sizeof(StudioBootstrap) == 296 ? 1 : -1];
typedef struct { HANDLE pipe, process, started, job; DWORD pid; unsigned char token[32]; } IpcController;
int m4_launch_controller(IpcController *controller, const WCHAR *exe, const WCHAR *node_script, const char *canary, uint32_t scenario, int studio_bootstrap);
void m4_close_controller(IpcController *controller);
