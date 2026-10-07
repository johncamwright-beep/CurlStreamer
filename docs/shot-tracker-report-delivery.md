# Shot Tracker reports and delivery

Reports remain an explicit, once-per-event action within the existing twenty-event team season allowance. Viewing, exporting and emailing a saved report do not call the AI service or consume another event.

## Miss diagnosis and PDF

All displayed percentages include their available sample basis. Shooting is a weighted grade: points out of five possible per graded shot, with the number of shots shown separately. It must not be described as binary completions. Miss and execution distributions show actual outcomes out of the applicable denominator. Existing reports can gain exact bases only against an identical saved source; otherwise their stored sample size is displayed without inventing a numerator.

Every report ends with the shared charting-code legend. PDFs embed licensed Bitstream Vera regular/bold fonts and compress the logo, avoiding reliance on a reader's local font substitution. This mitigates font portability problems; a Windows “Font Capture” Acrobat application failure may still require Acrobat's own update/repair. Do not disable Acrobat security protections or claim that export changes repair the reader installation.

Policy v5 gives future coach, team and individual narratives shot-type, turn and game miss evidence. A miss rate is the share of classified, non-excluded execution outcomes marked Partial, Limited or Miss. A miss category share uses those miss outcomes as its denominator, including outcomes with no directional tag. This differs from the grade-based shooting percentage. Ties and small samples are shown; a tag is not proof of a delivery fault.

The report shows the most frequent categories, shot and turn concentrations, game comparisons, supporting percentages beside narrative findings, and two practical exercises selected from the recorded patterns. Team-facing analysis contains no player identifiers. Practice suggestions are observations to test, not a technical diagnosis or national performance standard. Background coaching resources: [Curling Canada drills](https://www.curling.ca/curling-drills/).

Browser downloads and email attachments share a branded PDF renderer with the local CurlStreamer logo, heading hierarchy, summary cards, striped tables, repeated headers and page numbers. Individual reports retain game summaries and measurement tables. `node scripts/preview-shot-tracker-pdf.mjs` makes a synthetic seven-game layout sample; it never reads real team records, generates AI prose or sends mail.

Saved AI prose is not regenerated. Deterministic miss analysis can be added when its original source fingerprint matches the current event using the saved policy. Otherwise the original snapshot remains unchanged. Newly generated player reports store their charting player ID. Legacy IDs are recovered only from a matching source snapshot and exact title; ambiguous reports cannot be emailed as an individual report.

## Private player addresses

Team administrators can save optional addresses under Team settings. They are in `team_player_contacts`, separate from public roster settings. The existing organization/position/name charting identity is retained. Changing a name or position requires verifying and saving that person's address for the new identity; another person's address is never inherited by roster index.

Only the team report can be sent to the roster. An individual report's primary recipient remains the contact bound to that report's player ID and name. Coach reports have no email action. Clicking an email button opens a modal with recipients, missing addresses, an editable subject and coach's message, and the selected PDF attachment. The sender display name is Coach followed by the entered coach name, initially suggested from the signed-in account. The sending address remains INVITATION_FROM_EMAIL. Only Confirm and send submits delivery; Cancel or Escape sends nothing.

The coach may explicitly enter up to ten CC email addresses for parents or another coach. The UI explains these are separate private copies, not shared CC headers: each address receives the selected report once, even when copying a team report sent to several players. Addresses are deduplicated against primary recipients, case-insensitively. CC addresses are not saved to the player roster.

The server rebuilds the recipient plan at send time and rejects a stale preview. It rechecks coach access and uses saved report content, never client-supplied primary recipients or PDFs; only the validated, explicitly entered copy addresses may be supplied by the client. Delivery claims prevent duplicate sends. An explicit resend is available with a cooldown; sends are rate-limited per organization. SMTP acceptance is not a delivery/read receipt. Ambiguous SMTP outcomes are not automatically retried.

## Release and validation

Apply `supabase/migrations/0080_private_player_report_email.sql` before deploying the email controls. Contacts are inaccessible to anonymous/authenticated database clients. Delivery claim/finish functions are service-only and recheck report authorization. `node scripts/check-report-email.mjs <path-to-pglite/dist/index.js>` validates the migration against an isolated PGlite database, including private grants, duplicate prevention and rate limits.

Reuse existing server-only `ZOHO_SMTP_HOST`, `ZOHO_SMTP_PORT`, `ZOHO_SMTP_USER`, `ZOHO_SMTP_PASSWORD` and `INVITATION_FROM_EMAIL`. No new dependency or API key is required. Never log SMTP credentials. Local browser tests mock send requests and cannot contact real recipients.
