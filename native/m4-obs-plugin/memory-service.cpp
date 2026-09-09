#pragma warning(push)
#pragma warning(disable : 4201) // Pinned libobs vector headers use anonymous unions.
#include <obs-module.h>
#pragma warning(pop)
#include <windows.h>
#include <aclapi.h>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <memory>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <vector>

OBS_DECLARE_MODULE()
MODULE_EXPORT const char *obs_module_description(void)
{
#ifdef M4_OBS_PRODUCTION_ADMISSION
  return "CurlStreamer M4 memory service (explicit authenticated YouTube admission artifact)";
#else
  return "CurlStreamer M4 memory service validation slice (production delivery disabled)";
#endif
}

namespace {
using Clock = std::chrono::steady_clock;
struct State {
  std::mutex mutex;
  std::condition_variable changed;
  bool armed = false;
  bool revoked = false;
  bool shutdown = false;
  bool worker_done = false;
  bool attached = false;
  bool start_attempted = false;
  bool initialized = false;
  bool output_started = false;
  bool output_stopped = false;
  uint32_t output_failure = 0;
  HANDLE pipe = INVALID_HANDLE_VALUE;
  std::thread ipc;
  std::thread::id worker_id;
  Clock::time_point deadline;
  obs_weak_output_t *owned = nullptr;
  char server[256] = {};
  char key[256] = {};
  ~State()
  {
    if (owned) obs_weak_output_release(owned);
    SecureZeroMemory(server, sizeof(server));
    SecureZeroMemory(key, sizeof(key));
  }
  bool authorized()
  {
    if (armed && Clock::now() >= deadline) revoked = true;
    return armed && !revoked && !shutdown;
  }
};
using Handle = std::shared_ptr<State>;
std::mutex registry_mutex;
std::unordered_map<obs_service_t *, Handle> registry;
struct Worker {
  Handle state;
  std::thread thread;
  ~Worker()
  {
    if (auto current = state) {
      std::lock_guard lock(current->mutex);
      current->shutdown = true;
      current->changed.notify_all();
    }
    if (thread.joinable()) thread.join();
    if (auto current = state) {
      if (current->ipc.joinable()) current->ipc.join();
    }
  }
};
std::mutex workers_mutex;
std::vector<std::unique_ptr<Worker>> workers;
constexpr size_t max_services = 8;
struct CapacityReached {};

// Read only the numeric OBS code. The last_error field is untrusted server
// text and may echo the key; never inspect, format, retain or return it.
void output_start(void *data, calldata_t *)
{
  auto *state = static_cast<State *>(data);
  std::lock_guard lock(state->mutex);
  state->output_started = true;
  state->output_stopped = false;
}
void output_stop(void *data, calldata_t *details)
{
  auto *state = static_cast<State *>(data);
  std::lock_guard lock(state->mutex);
  state->output_stopped = true;
  if (calldata_int(details, "code") != OBS_OUTPUT_SUCCESS) state->output_failure = 2;
  state->revoked = true;
  state->changed.notify_all();
}

void reap_workers()
{
  std::vector<std::unique_ptr<Worker>> completed;
  {
    std::lock_guard workers_lock(workers_mutex);
    for (auto it = workers.begin(); it != workers.end();) {
      bool done = true;
      if (auto state = (*it)->state) {
        std::lock_guard state_lock(state->mutex);
        done = state->worker_done;
      }
      if (done) {
        completed.push_back(std::move(*it));
        it = workers.erase(it);
      } else ++it;
    }
  }
  // worker_done is set before the thread's final return. Join the actual
  // thread, outside every registry/state/workers lock, before closing handles.
  completed.clear();
}

// The worker owns State separately from OBS callback storage. Releasing its
// output reference can synchronously destroy the service on this very thread.
void watchdog(Handle state)
{
  std::unique_lock lock(state->mutex);
  state->worker_id = std::this_thread::get_id();
  while (!state->shutdown) {
    state->authorized();
    obs_output_t *output = state->revoked && state->owned
      ? obs_weak_output_get_output(state->owned) : nullptr;
    lock.unlock();
    if (output) {
      // Stop only the output bound at initialize; never the frontend recording
      // output. Repeat after revocation to catch an already pending late start.
      obs_output_force_stop(output);
      obs_output_release(output);
    }
    lock.lock();
    state->changed.wait_for(lock, std::chrono::milliseconds(20), [&] { return state->shutdown; });
  }
  state->worker_done = true;
  state->changed.notify_all();
}

const char *name(void *)
{
#ifdef M4_OBS_PRODUCTION_ADMISSION
  return "CurlStreamer M4 memory-only (explicit admission gate)";
#else
  return "CurlStreamer M4 memory-only (delivery disabled)";
#endif
}
void *create(obs_data_t *, obs_service_t *service)
{
  try {
    reap_workers();
    auto state = std::make_shared<State>();
    auto handle = std::make_unique<Handle>(state);
    {
      std::lock_guard lock(registry_mutex);
      registry.emplace(service, state);
    }
    try {
      auto worker = std::make_unique<Worker>();
      worker->state = state;
      std::lock_guard lock(workers_mutex);
      if (workers.size() >= max_services) throw CapacityReached{};
      // Allocate list capacity before starting a worker. Nothing that can
      // allocate follows thread launch, so failure cannot strand a live worker.
      workers.reserve(max_services);
      worker->thread = std::thread(watchdog, state);
      workers.push_back(std::move(worker));
    }
    catch (...) {
      std::lock_guard lock(registry_mutex);
      registry.erase(service);
      throw;
    }
    return handle.release();
  } catch (...) { return nullptr; }
}
void destroy(void *data)
{
  if (!data) return;
  auto *handle = static_cast<Handle *>(data);
  const auto state = *handle;
  // Disconnect outside the State lock: OBS joins an in-flight signal callback.
  // If the weak output is already gone, its signal handler is gone as well.
  obs_output_t *output = state->owned ? obs_weak_output_get_output(state->owned) : nullptr;
  if (output) {
    auto *signals = obs_output_get_signal_handler(output);
    signal_handler_disconnect(signals, "start", output_start, state.get());
    signal_handler_disconnect(signals, "stop", output_stop, state.get());
    obs_output_release(output);
  }
  {
    std::lock_guard lock(registry_mutex);
    for (auto it = registry.begin(); it != registry.end(); ++it) {
      if (it->second == state) { registry.erase(it); break; }
    }
  }
  {
    std::unique_lock lock(state->mutex);
    state->revoked = true;
    state->shutdown = true;
    state->changed.notify_all();
    if (state->worker_id != std::this_thread::get_id())
      state->changed.wait(lock, [&] { return state->worker_done; });
  }
  delete handle;
}
bool initialize(void *data, obs_output_t *output)
{
  if (!data || !output) return false;
  const auto state = *static_cast<Handle *>(data);
  std::lock_guard lock(state->mutex);
  if (!state->authorized() || state->initialized) return false;
  if (state->owned) {
    obs_output_t *bound = obs_weak_output_get_output(state->owned);
    const bool matches = bound == output;
    if (bound) obs_output_release(bound);
    if (!matches) return false;
  } else state->owned = obs_output_get_weak_output(output);
  state->initialized = state->owned != nullptr;
  return state->initialized;
}
void activate(void *data, obs_data_t *)
{
  if (!data) return;
  const auto state = *static_cast<Handle *>(data);
  std::lock_guard lock(state->mutex);
  state->authorized();
  state->changed.notify_all();
}
void deactivate(void *data)
{
  if (!data) return;
  const auto state = *static_cast<Handle *>(data);
  std::lock_guard lock(state->mutex);
  state->revoked = true;
  state->changed.notify_all();
}
bool can_connect(void *data)
{
  if (!data) return false;
  const auto state = *static_cast<Handle *>(data);
  std::lock_guard lock(state->mutex);
  return state->authorized();
}
const char *connect_info(void *data, uint32_t type)
{
  if (!data) return "";
  const auto state = *static_cast<Handle *>(data);
  std::lock_guard lock(state->mutex);
  if (!state->authorized()) return "";
  // Buffers never mutate after arm until final lifetime destruction. Returning
  // a pointer must not race a wipe when a transport is still copying it.
  if (type == OBS_SERVICE_CONNECT_INFO_SERVER_URL) return state->server;
  if (type == OBS_SERVICE_CONNECT_INFO_STREAM_KEY) return state->key;
  return "";
}
const char *protocol(void *) { return "RTMP"; }

struct IpcHeader {
  uint32_t magic, version, opcode, length, sequence;
  unsigned char capability[32];
  ~IpcHeader() { SecureZeroMemory(capability, sizeof(capability)); }
};
struct ArmPayload {
  uint32_t lease; char server[256]; char key[256];
  ~ArmPayload() { SecureZeroMemory(this, sizeof(*this)); }
};
struct IpcReply { uint32_t magic, sequence, status, state; };
struct IpcObservation { IpcReply reply; uint32_t output, failure; uint64_t bytes; };
static_assert(sizeof(IpcObservation) == 32);
static_assert(sizeof(IpcHeader) == 52 && sizeof(ArmPayload) == 516);
constexpr uint32_t ipc_magic = 0x4d344950;

bool token_user(HANDLE token, std::vector<unsigned char> &buffer)
{
  DWORD size = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &size);
  if (!size || size > 65536) return false;
  buffer.resize(size);
  return GetTokenInformation(token, TokenUser, buffer.data(), size, &size) != FALSE;
}
bool same_user(HANDLE pipe)
{
  if (!ImpersonateNamedPipeClient(pipe)) return false;
  HANDLE client = nullptr;
  const BOOL opened = OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, TRUE, &client);
  const BOOL reverted = RevertToSelf();
  // A failed revert leaves an unsafe worker security context. Do not process
  // any authority; restoring the process token must succeed before returning.
  if (!reverted) { if (client) CloseHandle(client); return false; }
  HANDLE process = nullptr;
  if (!opened || !OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &process)) {
    if (client) CloseHandle(client);
    return false;
  }
  std::vector<unsigned char> a, b;
  bool match = token_user(client, a) && token_user(process, b);
  if (match) match = EqualSid(reinterpret_cast<TOKEN_USER *>(a.data())->User.Sid,
    reinterpret_cast<TOKEN_USER *>(b.data())->User.Sid) != FALSE;
  CloseHandle(client);
  CloseHandle(process);
  return match;
}
bool private_pipe(HANDLE pipe, uint32_t expected_pid)
{
  DWORD flags = 0;
  ULONG pid = 0;
  if (GetFileType(pipe) != FILE_TYPE_PIPE ||
      !GetNamedPipeInfo(pipe, &flags, nullptr, nullptr, nullptr) ||
      !(flags & PIPE_SERVER_END) || !GetNamedPipeClientProcessId(pipe, &pid) ||
      pid != expected_pid || !expected_pid) return false;
  // FileModeInformation exposes synchronous handle modes. Reject them: the
  // bounded worker must never issue synchronous I/O on a supplied handle.
  struct IoStatus { LONG status; ULONG_PTR information; } ios = {};
  using Query = LONG (NTAPI *)(HANDLE, IoStatus *, void *, ULONG, ULONG);
  auto query = reinterpret_cast<Query>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryInformationFile"));
  ULONG mode = 0;
  if (!query || query(pipe, &ios, &mode, sizeof(mode), 16) < 0 || (mode & 0x30)) return false;
  ULONG access = 0;
  if (query(pipe, &ios, &access, sizeof(access), 8) < 0 ||
      (access & (FILE_READ_DATA | FILE_WRITE_DATA)) != (FILE_READ_DATA | FILE_WRITE_DATA)) return false;
  HANDLE process = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &process)) return false;
  std::vector<unsigned char> user;
  const bool got_user = token_user(process, user);
  CloseHandle(process);
  if (!got_user) return false;
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  PACL acl = nullptr;
  if (GetSecurityInfo(pipe, SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION, nullptr,
      nullptr, &acl, nullptr, &descriptor) != ERROR_SUCCESS) return false;
  bool valid = acl && acl->AceCount > 0;
  for (DWORD i = 0; valid && i < acl->AceCount; ++i) {
    void *raw = nullptr;
    if (!GetAce(acl, i, &raw)) { valid = false; break; }
    auto ace = static_cast<ACCESS_ALLOWED_ACE *>(raw);
    valid = ace->Header.AceType == ACCESS_ALLOWED_ACE_TYPE &&
      EqualSid(&ace->SidStart, reinterpret_cast<TOKEN_USER *>(user.data())->User.Sid);
  }
  if (descriptor) LocalFree(descriptor);
  return valid;
}
bool transfer(const Handle &state, void *buffer, DWORD size, bool write, bool idle_header = false)
{
  auto bytes = static_cast<unsigned char *>(buffer);
  auto until = Clock::now() + std::chrono::seconds(idle_header ? 30 : 2);
  DWORD total = 0;
  while (total < size) {
    { std::lock_guard lock(state->mutex); if (state->shutdown) return false; }
    OVERLAPPED operation = {};
    operation.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!operation.hEvent) return false;
    DWORD count = 0;
    BOOL ok = write ? WriteFile(state->pipe, bytes + total, size - total, &count, &operation)
                    : ReadFile(state->pipe, bytes + total, size - total, &count, &operation);
    if (!ok && GetLastError() == ERROR_IO_PENDING) {
      bool abandon = false;
      for (;;) {
        const DWORD result = WaitForSingleObject(operation.hEvent, 20);
        if (result == WAIT_OBJECT_0) break;
        if (result != WAIT_TIMEOUT) { abandon = true; break; }
        std::lock_guard lock(state->mutex);
        // An attached idle controller may wait indefinitely for an operator.
        // Once any header byte arrives, the whole frame is bounded to two seconds.
        if (state->shutdown ||
            (!(idle_header && total == 0) && Clock::now() >= until)) { abandon = true; break; }
      }
      if (abandon) CancelIoEx(state->pipe, &operation);
      // Cancellation completion must precede releasing OVERLAPPED storage.
      ok = GetOverlappedResult(state->pipe, &operation, &count, TRUE);
      if (abandon) ok = FALSE;
    }
    CloseHandle(operation.hEvent);
    if (!ok || !count) return false;
    if (idle_header && total == 0) until = Clock::now() + std::chrono::seconds(2);
    total += count;
    if (Clock::now() >= until) return false;
  }
  return true;
}
bool terminated_field(const char *value, size_t size)
{
  size_t end = 0;
  while (end < size && value[end]) ++end;
  if (end == 0 || end == size) return false;
  for (; end < size; ++end) if (value[end]) return false;
  return true;
}
#ifdef M4_OBS_PRODUCTION_ADMISSION
bool production_key(const char *key)
{
  size_t count = 0;
  for (; key[count]; ++count) {
    const char c = key[count];
    if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
        (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
  }
  return count > 0 && count < 256;
}
#endif
IpcObservation observe(const Handle &state, uint32_t sequence)
{
  obs_output_t *output = nullptr;
  IpcObservation observation = {{ipc_magic, sequence, 0, 2}, 0, 0, 0};
  {
    std::lock_guard lock(state->mutex);
    state->authorized();
    observation.reply.state = state->revoked ? 2 : state->armed ? 1 : 0;
    if (state->owned) output = obs_weak_output_get_output(state->owned);
  }
  const bool active = output && obs_output_active(output);
  const uint64_t bytes = output ? obs_output_get_total_bytes(output) : 0;
  {
    std::lock_guard lock(state->mutex);
    observation.failure = state->output_failure;
    observation.output = active && state->output_started ? 2 :
      state->start_attempted && !state->output_stopped && !state->output_failure ? 1 :
      state->output_failure ? 4 : state->output_stopped || state->revoked ? 3 : 0;
    // A terminal callback precedes OBS clearing active by a few instructions.
    // Do not assert stopped while its output is still locally active.
    if (active && observation.output >= 3) observation.output = 1;
    observation.bytes = bytes > 9007199254740991ULL ? 9007199254740991ULL : bytes;
  }
  if (output) obs_output_release(output);
  return observation;
}
void ipc_worker(Handle state, std::shared_ptr<std::vector<unsigned char>> capability)
{
  uint32_t sequence = 1;
  try {
    for (;;) {
      IpcHeader header = {};
      if (!transfer(state, &header, sizeof(header), false, true)) {
        SecureZeroMemory(&header, sizeof(header)); break;
      }
      unsigned char difference = 0;
      for (size_t i = 0; i < 32; ++i) difference |= header.capability[i] ^ (*capability)[i];
      SecureZeroMemory(header.capability, sizeof(header.capability));
      if (difference || header.magic != ipc_magic || header.version != 1 ||
          header.sequence != sequence || !same_user(state->pipe)) break;
      if ((header.opcode == 1 && header.length != sizeof(ArmPayload)) ||
          (header.opcode == 2 && header.length != sizeof(uint32_t)) ||
          ((header.opcode == 3 || header.opcode == 4) && header.length != 0) ||
          header.opcode < 1 || header.opcode > 4) break;
      if (header.opcode == 4) {
        auto observation = observe(state, sequence);
        if (!transfer(state, &observation, sizeof(observation), true) || ++sequence == 0) break;
        continue;
      }
      ArmPayload payload = {};
      if (header.length && !transfer(state, &payload, header.length, false)) {
        SecureZeroMemory(&payload, sizeof(payload)); break;
      }
      bool accepted = false;
      IpcReply reply = {ipc_magic, sequence, 1, 2};
      {
        std::lock_guard lock(state->mutex);
        state->authorized();
        if (header.opcode == 3) { state->revoked = true; accepted = true; }
        if (header.opcode == 2 && state->authorized() && payload.lease > 0 && payload.lease <= 30000) {
          state->deadline = Clock::now() + std::chrono::milliseconds(payload.lease);
          accepted = true;
        }
        if (header.opcode == 1 && !state->armed && !state->revoked && !state->shutdown &&
            payload.lease > 0 && payload.lease <= 30000 &&
            terminated_field(payload.server, sizeof(payload.server)) &&
            terminated_field(payload.key, sizeof(payload.key))) {
#ifdef M4_OBS_TEST_API
          if (std::strcmp(payload.server, "rtmps://synthetic.invalid/live2") == 0 &&
              std::strncmp(payload.key, "m4-canary-", 10) == 0) {
            std::memcpy(state->server, payload.server, sizeof(payload.server));
            std::memcpy(state->key, payload.key, sizeof(payload.key));
            state->deadline = Clock::now() + std::chrono::milliseconds(payload.lease);
            state->armed = true;
            accepted = true;
          }
#endif
#ifdef M4_OBS_PRODUCTION_ADMISSION
          if (state->attached && state->owned && !state->start_attempted &&
              std::strcmp(payload.server, "rtmps://a.rtmps.youtube.com:443/live2") == 0 && production_key(payload.key)) {
            std::memcpy(state->server, payload.server, sizeof(payload.server));
            std::memcpy(state->key, payload.key, sizeof(payload.key));
            state->deadline = Clock::now() + std::chrono::milliseconds(payload.lease);
            state->armed = true;
            accepted = true;
          }
#endif
        }
        if (!accepted) state->revoked = true;
        reply.status = accepted ? 0 : 1;
        reply.state = state->revoked ? 2 : state->armed ? 1 : 0;
        state->changed.notify_all();
      }
      SecureZeroMemory(&payload, sizeof(payload));
      // A revoked state still gets its bounded terminal acknowledgement.
      // transfer permits writes after revocation without restoring authority.
      if (!transfer(state, &reply, sizeof(reply), true)) break;
      if (!accepted || ++sequence == 0) break;
    }
  } catch (...) { /* Never expose payloads or system error text. */ }
  SecureZeroMemory(capability->data(), capability->size());
  { std::lock_guard lock(state->mutex); state->revoked = true; state->changed.notify_all(); }
  CloseHandle(state->pipe);
}
} // namespace

// Host-only binding contains no authority. It must precede controller attach,
// and pins exactly the RTMP output that the watchdog is permitted to stop.
extern "C" __declspec(dllexport) bool m4_bind_output(obs_service_t *service, obs_output_t *output)
{
  if (!output || obs_output_get_service(output) != service) return false;
  std::lock_guard registry_lock(registry_mutex);
  auto it = registry.find(service);
  if (it == registry.end()) return false;
  const auto state = it->second;
  std::lock_guard lock(state->mutex);
  if (state->owned || state->attached || state->armed || state->revoked || state->shutdown) return false;
  state->owned = obs_output_get_weak_output(output);
  if (!state->owned) return false;
  obs_output_set_reconnect_settings(output, 0, 0);
  signal_handler_connect(obs_output_get_signal_handler(output), "start", output_start, state.get());
  signal_handler_connect(obs_output_get_signal_handler(output), "stop", output_stop, state.get());
  return true;
}

// Serialized by the owning host thread. ARM is still denied by default builds.
// Never hold State's lock across OBS calls: service callbacks reacquire it.
extern "C" __declspec(dllexport) bool m4_start_if_authorized(obs_service_t *service)
{
  Handle state;
  obs_output_t *output = nullptr;
  {
    std::lock_guard registry_lock(registry_mutex);
    auto it = registry.find(service);
    if (it == registry.end()) return false;
    state = it->second;
    std::lock_guard lock(state->mutex);
    if (!state->attached || !state->authorized() || state->start_attempted || !state->owned) return false;
    state->start_attempted = true;
    output = obs_weak_output_get_output(state->owned);
  }
  const bool started = output && obs_output_start(output);
  if (output) obs_output_release(output);
  if (!started) {
    std::lock_guard lock(state->mutex);
    state->revoked = true;
    state->output_failure = 1;
    state->output_stopped = true;
    state->changed.notify_all();
  }
  return started;
}

extern "C" __declspec(dllexport) bool m4_attach_controller(obs_service_t *service,
  HANDLE pipe, const unsigned char capability[32], uint32_t expected_client_pid)
{
  try {
    if (!capability || !private_pipe(pipe, expected_client_pid)) return false;
    unsigned char nonzero = 0;
    for (size_t i = 0; i < 32; ++i) nonzero |= capability[i];
    if (!nonzero) return false;
    auto secret = std::make_shared<std::vector<unsigned char>>(capability, capability + 32);
    std::lock_guard registry_lock(registry_mutex);
    auto it = registry.find(service);
    if (it == registry.end()) { SecureZeroMemory(secret->data(), secret->size()); return false; }
    const auto state = it->second;
    std::lock_guard lock(state->mutex);
    if (state->attached || state->armed || state->revoked || state->shutdown) {
      SecureZeroMemory(secret->data(), secret->size()); return false;
    }
    state->pipe = pipe;
    try { state->ipc = std::thread(ipc_worker, state, secret); }
    catch (...) { state->pipe = INVALID_HANDLE_VALUE; SecureZeroMemory(secret->data(), secret->size()); return false; }
    state->attached = true;
    return true;
  } catch (...) { return false; }
}

bool obs_module_load(void)
{
  obs_service_info info = {};
  info.id = "curlstreamer_m4_memory";
  info.get_name = name;
  info.create = create;
  info.destroy = destroy;
  info.initialize = initialize;
  info.activate = activate;
  info.deactivate = deactivate;
  info.get_connect_info = connect_info;
  info.get_protocol = protocol;
  info.can_try_to_connect = can_connect;
  obs_register_service(&info);
  return true;
}

MODULE_EXPORT void obs_module_unload(void)
{
  // worker_done means the loop finished, not that its stack has left this DLL.
  // Retain joinable handles through module lifetime, including self-destruction
  // from force_stop. Never unmap the module before every worker actually exits.
  std::vector<std::unique_ptr<Worker>> pending;
  {
    std::lock_guard lock(workers_mutex);
    pending.swap(workers);
  }
  for (const auto &worker : pending) {
    if (auto state = worker->state) {
      std::lock_guard lock(state->mutex);
      state->revoked = true;
      state->shutdown = true;
      state->changed.notify_all();
    }
  }
  pending.clear(); // joins without holding any callback or registry lock
}

#ifdef M4_OBS_TEST_API
// Restricted to synthetic destinations (fixed loopback only in its own test build). These symbols
// are absent from default builds; no production target-delivery path exists.
extern "C" __declspec(dllexport) bool m4_test_arm(obs_service_t *service,
  const char *server, const char *key, uint32_t lease_ms)
{
  const bool allowed_target = server && (std::strcmp(server, "rtmps://synthetic.invalid/live2") == 0
#ifdef M4_OBS_LOOPBACK_TEST
    || std::strcmp(server, "rtmp://127.0.0.1:19359/live2") == 0
#endif
  );
  if (!allowed_target || !key ||
      std::strncmp(key, "m4-canary-", 10) != 0 || std::strlen(key) >= 256 ||
      lease_ms == 0 || lease_ms > 30000) return false;
  std::lock_guard registry_lock(registry_mutex);
  auto it = registry.find(service);
  if (it == registry.end()) return false;
  auto state = it->second;
  std::lock_guard lock(state->mutex);
  if (state->attached || state->armed || state->revoked || state->shutdown) return false;
  std::memcpy(state->server, server, std::strlen(server) + 1);
  std::memcpy(state->key, key, std::strlen(key) + 1);
  state->deadline = Clock::now() + std::chrono::milliseconds(lease_ms);
  state->armed = true;
  state->changed.notify_all();
  return true;
}
extern "C" __declspec(dllexport) void m4_test_revoke(obs_service_t *service)
{
  std::lock_guard registry_lock(registry_mutex);
  auto it = registry.find(service);
  if (it == registry.end()) return;
  std::lock_guard lock(it->second->mutex);
  it->second->revoked = true;
  it->second->changed.notify_all();
}
extern "C" __declspec(dllexport) uint32_t m4_test_state(obs_service_t *service)
{
  std::lock_guard registry_lock(registry_mutex);
  auto it = registry.find(service);
  if (it == registry.end()) return 2;
  std::lock_guard lock(it->second->mutex);
  it->second->authorized();
  return it->second->revoked ? 2 : it->second->armed ? 1 : 0;
}
#endif
