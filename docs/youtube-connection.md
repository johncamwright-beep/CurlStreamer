# Team YouTube connection

The settings slice connects one team-owned YouTube channel. It verifies OAuth
access and channel identity only; it does not create, start, test, or publish a
live broadcast.

## Google OAuth prerequisites

Create a Google Cloud project, enable YouTube Data API v3, configure the OAuth
consent screen, and create a Web application OAuth client. Register the exact
callback URI for each environment. The production callback is:

`https://curlstreamer.vercel.app/api/settings/youtube/oauth/callback`

Preview deployments must have their own exact callback configuration. Do not
point a Preview connection attempt at Production because the short-lived state
cookie is bound to the initiating browser origin. The application never derives
the callback from the request `Host` header.

Configure these server-only environment variables:

- `GOOGLE_YOUTUBE_CLIENT_ID`
- `GOOGLE_YOUTUBE_CLIENT_SECRET`
- `GOOGLE_YOUTUBE_REDIRECT_URI`
- `YOUTUBE_CREDENTIAL_ENCRYPTION_KEY` — a dedicated 32-byte base64 key

The OAuth client requests `https://www.googleapis.com/auth/youtube.force-ssl`
with offline access. External production use may require Google OAuth
verification. The Google account must own the YouTube channel being connected.

## Disposable PostgreSQL verification

Never run the integration suite against a shared database. Create a fresh local
database whose name contains `test` or `disposable`, bootstrap the minimal local
Supabase catalog from
`supabase/test-support/completion_postgres_prerequisites.sql`, and apply every
migration through `0020_add_team_youtube_connection.sql` in filename order.

Set `CURLCAST_DISPOSABLE_DATABASE_URL` to the loopback-only database URL and run:

`npm test -- supabase/migrations/team_youtube_connection_postgres.integration.test.ts`

The suite refuses non-loopback hosts and database names without `test` or
`disposable`. Drop the database after the run.
