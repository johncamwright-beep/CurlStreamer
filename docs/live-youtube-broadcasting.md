# Live YouTube broadcasting

Migrations `0021` and `0022` must be deployed in order after `0020`. They turn
the existing service-only `broadcast_sessions` table into a durable operation
journal and restrict replay URL promotion to sessions that reached live. Do not
run application code that calls the broadcast route until both are applied. No
browser role receives table or RPC access.

Start is available only from the same HTTPS origin configured in
`APP_BASE_URL`. This prevents Preview deployments that share a production
database but intentionally lack provider configuration from claiming a
production broadcast. The production runtime also requires:

- `NEXT_PUBLIC_LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`, with
  LiveKit Egress enabled and sufficient concurrent-Egress allowance.
- `GOOGLE_YOUTUBE_CLIENT_ID`, `GOOGLE_YOUTUBE_CLIENT_SECRET`,
  `GOOGLE_YOUTUBE_REDIRECT_URI`, and a 32-byte base64
  `YOUTUBE_CREDENTIAL_ENCRYPTION_KEY`.
- A connected team YouTube channel with Live Streaming enabled and available
  YouTube Data API quota.
- A publicly reachable `APP_BASE_URL`; LiveKit Web Egress loads
  `/broadcast/{gameId}` from this origin. The program page uses the existing
  composited camera, score, and sponsor view.

Start uses the exact saved game `youtubeTitle` and `youtubeVisibility`. Each
YouTube broadcast/stream and LiveKit Web Egress is marked with the durable
session key. Each create intent is committed before network I/O. An ambiguous
or crashed create is discovery-only on retry—absence is not treated as
permission to create a duplicate. Stop remains failed/pending unless every
uncertain output is discovered and terminal provider state is confirmed.
Stopping is final for that game. Completion and deletion advance the database
generation first, then independently attempt YouTube/Egress cleanup and room
teardown; a cleanup failure never changes the immutable result.

`Take a break` / `Resume` remains a separate delivery slice. It requires a
holding screen in the program output plus verified muting of outgoing audio;
YouTube does not provide a paused broadcast lifecycle state. The scoring UI
must not offer a pause control until both pieces are implemented and tested.

## Disposable PostgreSQL verification

Use only a loopback database whose name contains `test` or `disposable`. Apply
`supabase/test-support/completion_postgres_prerequisites.sql`, followed by every
migration from `0001` through `0022`. Migration `0020` is a prerequisite but
must not be reapplied to a database where it is already recorded.

```powershell
$curlcastPgBin = "C:\path\to\isolated-postgresql\pgsql\bin"
& (Join-Path $curlcastPgBin "createdb.exe") -h 127.0.0.1 -p 55439 -U postgres curlcast_broadcast_disposable_test
& (Join-Path $curlcastPgBin "psql.exe") -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55439 -U postgres -d curlcast_broadcast_disposable_test -f supabase/test-support/completion_postgres_prerequisites.sql
Get-ChildItem supabase/migrations/*.sql | Sort-Object Name | ForEach-Object {
  & (Join-Path $curlcastPgBin "psql.exe") -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55439 -U postgres -d curlcast_broadcast_disposable_test -f $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($_.Name)" }
}
$env:Path = "$curlcastPgBin;$env:Path"
$env:CURLCAST_DISPOSABLE_DATABASE_URL = "postgresql://postgres@127.0.0.1:55439/curlcast_broadcast_disposable_test"
npm test -- supabase/migrations/live_youtube_broadcasting_postgres.integration.test.ts
```

The suite checks verified owner/admin and organizer authority, negative account
cases, idempotent claims, terminal fencing, replay URL preservation,
same-channel credential refresh, and a lock-observed Start-versus-disconnect
race. Provider unit tests use fakes only; they never create real YouTube or
LiveKit resources.
