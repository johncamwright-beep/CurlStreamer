# Recovery and operational readiness

## Current evidence — September 13, 2026

- The public homepage, robots discovery, database-backed sitemap and a published
  team page pass `node scripts/check-public-site.mjs`.
- The encrypted bundle tests round-trip a synthetic database export, binary photo
  and empty file into a new local folder. They reject wrong keys, tampered files,
  missing manifests and attempts to overwrite existing directories.
- This is **not** a successful restore of the production database. No live backup
  has been exported, no backup retention setting has been verified, and no paid
  provider feature has been enabled in this pass. Provider admin access and an
  isolated database restore target are still required.
- The previous hosted run failed a news-editor regression on Chromium 151.
  Applying a link now collapses the selection to prevent Enter replacing the
  linked text; desktop and mobile regression checks pass with bundled Chromium.

## What must be backed up together

Supabase database backups include Storage metadata, **not the uploaded files**.
See [Supabase database backups](https://supabase.com/docs/guides/platform/backups).
An export set needs database schema, roles and data, plus downloaded objects from
`team-public-media` and `organization-sponsors`, preserving bucket and object paths.
Include a non-secret record of project ID, export time, source commit and applied
migration version. Preserve provider encryption keys separately in a password
manager; encrypted OAuth records cannot be recovered without their original key.

Use a consistent completed export. Do not bundle a directory while an export job
is writing to it. The bundle tool checks file changes, but it cannot make separate
database and Storage exports transactionally consistent. Record any maintenance
window and reconcile objects uploaded during the export. Never claim that copying
the website repository backs up team data.

## Encrypted local bundles

`scripts/recovery-bundle.mjs` operates only on local exports. It never contacts a
database, executes SQL, deletes data or changes provider settings. Files and their
manifest use AES-256-GCM with a fresh nonce per encrypted item. A SHA-256 inventory
verifies completeness; authenticated decryption detects corruption. A missing
completion manifest means the bundle is incomplete and must not be used.

Supply `CURLSTREAMER_BACKUP_KEY` through the process environment: a random 32-byte
key represented as 64 hexadecimal characters. Keep it separately in the password
manager, never in Git, chat, command-line arguments, or beside the backup. Losing
it makes recovery impossible. Use a new destination name each time:

```powershell
node scripts/recovery-bundle.mjs pack C:\Recovery\export-2026-09-13 C:\Recovery\encrypted-2026-09-13
node scripts/recovery-bundle.mjs verify C:\Recovery\encrypted-2026-09-13
node scripts/recovery-bundle.mjs restore C:\Recovery\encrypted-2026-09-13 C:\Recovery\isolated-restore-2026-09-13
```

The restore destination must not exist. It creates plaintext files there after
verifying the bundle; protect that directory with the operating system's access
controls. Windows does not enforce Unix file-mode bits. Do not extract into the
application checkout, a shared folder, or a production database directory.
If interrupted, keep the incomplete directory separate and use a fresh destination
for the next attempt. Keep an encrypted off-device copy; a second folder on the
same PC is not protection against losing that PC.

## Database restore rehearsal — still required

1. Verify live backup availability and retention in Supabase's Backups panel.
   Record the newest recovery point. Do not enable PITR or create a paid project
   without checking its cost with the owner.
2. Obtain a completed database export and corresponding media inventory/download.
   Compare record counts, media object counts and byte totals before sealing.
3. Restore into a disposable local Supabase instance or isolated staging project.
   Never select the live project's Restore action for a rehearsal.
4. Disable outgoing integrations in the target. Use Stripe sandbox only; omit
   live Google/Meta credentials and outbound email. Block indexing, pilot signup,
   public subdomain publication and public access to copied customer media.
5. Check team isolation, roles, trial state, append-only scoring and Undo, news,
   inline images, sponsors, event history and permanent subdomain ownership.
6. Record the recovery point, elapsed restore time, counts, sampled media hashes,
   failed checks and operator. A successfully decrypted SQL file alone does not
   prove that PostgreSQL or the application can use it.

## Storage limits — inventory before enforcement

Run `scripts/storage-usage-audit.sql` in the Supabase SQL editor. It is read-only
and returns per-team counts/recorded bytes and unknown-size counts, not filenames
or private content. It also reports current bucket limits. Old objects over the
new 300 kB upload limit are not automatically corrupt or safe to delete.

After reviewing actual usage, choose a per-team quota and expose usage to admins.
Enforce quota reservations atomically before uploads, including inline/draft media,
with release on failed upload and reconciliation of abandoned reservations. Do not
use a browser-only quota or a check-then-upload sum that concurrent requests can
bypass. No aggregate quota or orphan deletion has been activated yet.

## Availability and release controls

`node scripts/check-public-site.mjs` performs credential-free, read-only checks
and exits nonzero on bad status/content. It does not test sign-in, payment delivery
or a live broadcast. A manually dispatched `Public site check` workflow is provided;
GitHub's default branch must contain it before it appears in the Actions UI.
Recurring checks and alert delivery are not configured. Choose cadence and owner
notification preferences before enabling them; do not send customer data in alerts.

The public domains still use the pilot Preview environment. Before switching,
inventory environment-variable names/scopes and callbacks, require passing checks
for promotion, and establish isolated staging data. Never blindly promote the
older main deployment. See `HARDENING_RELEASE.md` for the current rollback procedure.
