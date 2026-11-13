# Google sign-in pilot

## Hosted configuration (September 11, 2026)

- Google Cloud project: `project-a70a5792-ff44-4341-aae`.
- Dedicated web client: **CurlStreamer account sign-in**. The existing YouTube client remains separate.
- Google redirect URI: `https://hoogvyhuxevihttbutwl.supabase.co/auth/v1/callback`.
- Supabase Google provider is enabled; its client secret is stored there, not in the repository or browser bundle.
- Supabase Site URL and deployed branch `APP_BASE_URL`: `https://www.curlstreamer.app`. Its `/auth/confirm` endpoint is allowlisted.
- Vercel `GOOGLE_AUTH_ENABLED=true` is configured for Production and Preview; new deployments pick it up.
- Google branding uses the current homepage and includes `curlstreamer.app` as an authorized domain. Brand verification and broader YouTube OAuth review are not completed by this sign-in work.

## Flow and maintenance

Google sign-in remains off until `GOOGLE_AUTH_ENABLED=true` is set on the app server and the Google provider is enabled in the linked Supabase project. The allowed redirect URL is the canonical `APP_BASE_URL` plus `/auth/confirm`; do not register local IP addresses, preview URLs, or a browser-supplied host as alternatives.

The Google consent screen requests only identity scopes (`openid`, `email`, and `profile` through Supabase). While the Google project remains in Testing, these basic scopes may be used by Google users without the seven-day refresh-token expiry that affects offline access. The consent redirect may display the Supabase host until the Google app's brand verification is complete.

The server action starts Supabase OAuth with PKCE only when the browser's Origin equals `APP_BASE_URL`; preview and branch hosts link to the canonical login page before a verifier cookie is created. It then sends the browser to the same-origin callback. The default callback destination is `/onboarding`, which creates a first team for users without a membership and redirects existing team members to `/dashboard`. A validated internal `next` route is retained for sign-in that began from a protected page.

Windows Studio blocks navigation outside the app origin, including Google OAuth. Google is hidden there and the sign-in screen directs users to email/password. Google-authenticated users can set a Studio password from Account info, which adds password authentication to their existing authenticated account without changing their verified identity or team membership. Native or external-browser Studio authentication still needs a separate, explicitly designed callback and session-transfer flow.
