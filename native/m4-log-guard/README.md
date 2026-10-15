# Managed host log boundary

This adapter replaces libobs's process-wide log callback with a count-only
callback. Install it before `obs_startup` and module loading, and keep it installed
through `obs_shutdown`. The owning host must not install another log callback.
Storage lasts for the entire process; there is no callback chaining or restoration
of an earlier raw logger.

The callback never dereferences the format string, traverses variadic arguments,
formats text, allocates, or calls an output sink. Its only effect is one atomic,
saturating severity counter increment. `m4_log_guard_json` emits a fixed schema
containing those numeric counters. Unknown log levels share the `other` counter.
Counters indicate severity, not a classified cause such as TLS failure or an
invalid key. Concurrent snapshots are individually atomic, not transactional.

Dropping raw text also drops transformed keys, fragments, URLs and arbitrary
server-controlled descriptions without depending on string redaction. This is
deliberate: pinned OBS's RTMP implementation can log a server error description.
The adapter does not claim to protect independent stdout/stderr, crash reports,
external library file writers, or a plugin replacing the global logger. The host
must separately restrict those paths. It does not intercept OBS's crash handler.

## Validation

The native test links the pinned OBS 32.2.2 runtime and calls its real `blog`
dispatcher. It supplies simulated server error text with a complete synthetic
key, split fragments, encoded/uppercase variants, a `%n` argument, and invalid
format/argument pointers. The callback must not evaluate them. It also checks
that an old logger is never called, exact safe JSON is returned, short buffers
fail empty, and 80,000 concurrent callbacks retain their counts.

This is an in-process logging-boundary proof. It does not claim an actual RTMPS
server rejection, a provider operation, or integration into the managed host.

Configure with the pinned SDK/dependency prefix and `M4_RUNTIME_BIN`; build the
Release configuration and run `ctest -C Release --output-on-failure`.
