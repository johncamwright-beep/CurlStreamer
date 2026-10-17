# YouTube authorized-data retention

This workflow supports the withdrawal, authorization validation and cached API data requirements in [YouTube Developer Policies III.D.3 and III.E.4](https://developers.google.com/youtube/terms/developer-policies). Operator review of production setup remains necessary before verification submission.

## Stored field inventory

Migration 0083 also removes retained API copies from already-disconnected legacy settings whose credentials were previously deleted. The server-only purge removes the following authenticated provider data throughout the selected organization, including old games and archived broadcast cycles:

| Storage                                                                    | Removed fields                                                                                                                                                          |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `broadcast_settings`                                                       | `encrypted_credentials`, `channel_id`, `channel_title`, `connected_by`, `connected_at`, `tested_at`                                                                     |
| `youtube_oauth_states`                                                     | Organization's outstanding OAuth state rows                                                                                                                             |
| `games`                                                                    | `youtube_scheduled_broadcast_id`, `youtube_scheduled_watch_url`, `youtube_scheduled_channel_id`, `youtube_scheduled_connection_version`; reservation status/error reset |
| `broadcast_sessions` with YouTube provider                                 | `youtube_broadcast_id`, `youtube_stream_id`, `youtube_channel_id`, `provider_session_id`, `watch_url`                                                                   |
| `m4_output_intents`                                                        | `youtube_broadcast_id`, `youtube_stream_id`, `delivery_channel_id`                                                                                                      |
| `m4_provider_retirements`                                                  | `youtube_broadcast_id`, `youtube_stream_id`, `youtube_channel_id`                                                                                                       |
| `m4_broadcast_cycle_history.metadata`                                      | `youtube_broadcast_id`, `youtube_stream_id`, `youtube_channel_id`, `provider_session_id`, `watch_url`                                                                   |
| `audit_events.metadata` for `youtube.connected` / `game.youtube_scheduled` | `channel_id`, `broadcast_id`                                                                                                                                            |
| `game_completion_reviews`, `game_completions`                              | `youtube_watch_url` only when `youtube_watch_url_source = provider`                                                                                                     |

Independent `games.config.sharedYoutubeWatchUrl` and independently entered review/completion links remain. A link matching a known app-generated resource is classified as provider data; migration 0083 reconstructs provenance from current reservations/sessions and archived resource evidence. Previously stored links with no surviving provider evidence are treated as independently supplied, because their origin cannot be recovered reliably. Operators must review legacy imported links if they know these were copied from authenticated API results.

Game/event records, scores, append-only scoring events, completion results, account ownership, local operation generations, audit actor/action/time and actual broadcast journal states remain. Immutability exceptions allow only the specified provider-field redaction; they do not permit score edits. No YouTube video is deleted, transitioned or finished by this workflow. Locally removed generated reservation/replay links disappear from CurlStreamer even if the underlying video remains on YouTube.

## Server workflow and deadlines

The daily worker immediately queues existing and newly connected grants for their first complete verification. A recent connection test does not prove historical resources were refreshed. Until that check succeeds, the connection date (or row date when absent) is the conservative cleanup baseline; new grants can retry transient failures without being removed immediately. Thereafter the worker refreshes grants due 24 days after their last successful complete verification. It checks the owned channel and all retained broadcast and stream identifiers in batches of 50. Missing or differently owned resources have their dependent provider links redacted. Current owned channel identity is refreshed; historical channel audit references from other grants are removed. Only successful grant, channel and complete resource verification clears the initial pending flag and advances the verification date.

An explicit unusable refresh grant causes immediate full cleanup, including if a journal still says live. Transient failures retry. At 28 days without successful verification, all local authorized data is removed rather than retained indefinitely. This conservative deadline gives the daily scheduler margin before 30 days. The error is `authorization_unverified_data_removed`; it does not claim Google revoked access. Reconnect is available after cleanup, subject to existing unfinished-broadcast restrictions.

In-app Disconnect first authorizes the verified team manager and rejects actual unfinished broadcasts or in-flight scheduling intents. Idle reserved watch pages do not block withdrawal. A durable pending fence prevents credentials being reused or replaced while Google revocation is attempted. Confirmed revocation immediately purges local data. Failed requests keep encrypted retry credentials temporarily; the daily worker resumes them without depending on the original manager retaining their role. At five days after withdrawal, remaining local authorized data is removed even if Google still fails. `revocation_unconfirmed_data_removed` means Google revocation was not confirmed. The token has then been destroyed and automatic revocation retries cannot continue; the owner must withdraw permission through [Google permissions](https://security.google.com/settings/security/permissions).

External invalidation uses `authorization_revoked_use_youtube_studio`. Removing authorization is not evidence that a live sender or remote broadcast has stopped. Keep the journal's active state and resolve actual broadcasting in YouTube Studio; the application can no longer control a resource after its authorization/IDs are removed. Operators must investigate failed maintenance responses before either deadline.

Service-only RPCs claim a ten-minute lease and compare organization, connection version and claim ID when recording results. Cleanup locks game state, game, session, then connection rows; a returned old claim cannot clear a newer grant. OAuth begin allows reconnection after completed removal but rejects a pending withdrawal. Privileged credentials stay server-only and are never returned in cron responses or logged.

## Production prerequisite and operations

1. Review and apply migrations 0082 and 0083 in order through the normal deployment process. Back up/review the provenance backfill before applying 0083. Do not apply these migrations from a verification browser session.
2. Configure a random server-only `CRON_SECRET` of at least 32 ASCII characters in Vercel's production environment. Use a password manager/secret manager; do not put the value in source, screenshots, tickets, terminal output or client environment variables. Preserve the existing Google client and credential encryption secrets.
3. Deploy the worker and `vercel.json` together. The Vercel cron schedules `GET /api/cron/youtube-authorizations` daily at **08:17 UTC**, with `Authorization: Bearer <CRON_SECRET>`; actual execution timing depends on the plan. Confirm the plan supports this schedule and the configured 300-second route duration. Verify one authorized run using secure tooling without printing the header.
4. Monitor the cron execution and aggregate response every day. HTTP 503 means retry, failed execution or an unconfirmed removal and needs operator attention. HTTP 401/503 before the worker runs indicates cron authorization/configuration problems. Responses contain counts only, never organization IDs, credentials or Google errors.
5. Monitor oldest pending withdrawal and oldest successful-verification timestamps through authorized administration without exporting tokens. A missed scheduler, database outage or unresolved backlog can defeat deadlines; fix these before declaring production readiness. The worker processes at most 20 organizations per run, prioritizing withdrawals and oldest verifications. Each organization supports at most 1,000 retained resource identifiers per pass and a 60-second provider-request budget per organization. Larger inventory rejects verification and retries; resolve it or arrange secure additional processing before the 28-day deadline. Increase capacity only after reviewing quota and runtime constraints.
6. After restore/backfill, run maintenance immediately and verify generated URLs are removed for revoked grants while user-entered URLs and scores remain. Backups, exports and diagnostic stores need their own documented expiration/deletion procedure; this SQL workflow covers live application storage only. Do not retain API data in new logs or exports.

Remaining deployment prerequisites are applying migrations, setting `CRON_SECRET`, enabling/observing the production schedule and approving public copy that explains these consequences. Google Cloud OAuth publishing/verification and production changes require separate operator authorization. This implementation does not by itself submit or approve an application.

## Backup release gate

On October 6, 2026, the production Supabase dashboard showed physical daily
backups dated September 29 through October 6. This verifies that older copies
of application tables exist; it does not establish their physical deletion
deadline. [Supabase's backup documentation](https://supabase.com/docs/guides/platform/backups)
describes plan-dependent recovery windows, but a recovery window alone is not
proof that revoked API data has been deleted from every backup.

The YouTube policy requires deletion of authorized data within its seven-day
in-app withdrawal and thirty-day Google-settings withdrawal deadlines. It does
not specify physical-media overwrite mechanics or document a backup exception.
Backup compliance therefore remains unverified; the recovery window alone does
not resolve it. Obtain written provider evidence for deletion/recoverability and,
where the interpretation remains uncertain, confirmation from YouTube through its
[API compliance contact form](https://support.google.com/youtube/contact/yt_api_form).
An independently reviewed storage design may be another option, but a shared
credential-encryption key or Supabase Vault row deletion does not establish
selective erasure of older backup copies.

On October 6, 2026, the operator authorized and submitted a Supabase support
inquiry through the project's support form. The dashboard confirmed receipt;
the response is pending. Project access was disabled, no application records or
secrets were attached, and no backup deletion/settings changes were requested.
The inquiry asks for snapshot/WAL expiration and irrecoverability deadlines,
longer-lived internal/off-site copies, supported per-consent deletion options,
and restore/clone safeguards. Retain the written response as release evidence.

Cover manual exports and restore procedures as well. Restore into isolation with
application/provider access disabled until withdrawal records and maintenance
have been reconciled; do not let restored grants run merely because database
recovery succeeded. Until the backup procedure is verified, keep this change in
draft and do not publish the promised retention limits or submit verification
declarations claiming they are met. Do not delete project backups or weaken
disaster recovery merely to clear this gate without operator approval.
