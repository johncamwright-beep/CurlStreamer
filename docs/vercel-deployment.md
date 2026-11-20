# Vercel website deployment

Vercel remains the website host. This is a preparation plan, not evidence that the pilot branch has been deployed or production settings changed.

## Existing configuration

The example references `https://curlstreamer.vercel.app`. Verify the actual project, production domain, Git integration and production branch in Vercel before changing settings. No project binding file is committed.

Use Next.js with `npm ci` and `npm run build`. Native executables run on Windows, not in Vercel functions. Building the website neither starts Studio nor applies Supabase migrations.

## Environment and callbacks

- Set stable HTTPS `APP_BASE_URL` to the production website origin.
- Configure existing Supabase public settings and server-only secrets in the intended Vercel environment.
- Preserve the existing YouTube OAuth application/channel binding.
- Use `/api/settings/youtube/oauth/callback` with an exact origin/Google allowlist match.
- Verify Supabase authentication redirect allowlists for that origin.
- Keep provider preparation/target handoff disabled on ordinary previews.
- Explicitly choose mock or real mode; never mistake a mock snapshot for the real app.

## Release checks

1. Review the PR and inspect a Vercel preview using test configuration.
2. Check login, scheduling, scoring, sponsors and participant-link origins.
3. Verify account/channel binding and desktop pairing at the stable origin.
4. Review production environment and existing database catalog.
5. Deploy the approved revision, smoke-test it and retain rollback information.

Pilot migrations 0025-0030 already exist in the pilot database. Compare catalog state rather than reapplying them. Installer publication and broadcast activation are separate from website deployment.
