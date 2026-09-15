# CurlCoach discovery and module plan

Status: proposal, September 13, 2026, updated after inspecting the user-supplied Updated Shot Tracker.xlsx. No application functionality implemented. See [the workbook mapping](curlcoach-shot-tracker-mapping.md) for verified fields, calculations and compatibility questions.

## Research findings

- Curling Canada's [2026–2027 NextGen program](https://www.curling.ca/high-performance/nextgen-program/) explicitly requires coaches to use its Shot Tracker in competition and includes video/analytics review. This establishes official use, but the page does not supply a downloadable workbook or integration specification.
- [Curl BC's high-performance resource](https://curlbc.ca/hp/) also recommends the Curling Canada Shot Tracker. Public searches did not locate a verifiable current Excel template. This does not establish that none exists; it may be distributed through the program.
- Curling Canada's [history of its statistical system](https://ww1.curling.ca/hof/people/brian-cassidy/) describes recording turn, shot category, and execution scores of 0–4, with historical bonus scores of 5–6. This is historical context, not sufficient evidence for the current Shot Tracker rubric. Do not assume the two systems are identical.
- The user subsequently supplied Updated Shot Tracker.xlsx. Its Details tab credits Renee Sonnenberg and supplies category definitions and exclusions. This resolves the missing-template dependency for initial design. Obtain a completed example and clarify numeric-score guidance and scoreboard analysis before claiming complete calculation parity. The supplied file alone does not establish product endorsement. No outreach has been sent.
- An existing [Curl Coach product manual](https://www.curlcoach.com/Curl_Coach/pdf/CC1Manual.pdf) surfaced during research. Treat CurlCoach as a working module name until product naming is settled.

## Proposed coach experience

1. Organizer enables the add-on for a team/game and displays a coach QR invitation. The coach scans it on a tablet, signs in and claims scoped access. A persistent coach account owns access to the review library; an expiring game device session alone is insufficient.
2. Confirm the roster, throwing order, team being charted and scoring profile. Support all players, substitutions and optional opponent charting. Start with four-person curling; mixed doubles needs an explicit format implementation.
3. Show four tablet tabs: Chart shots, Flags, Game report and Library. Keep a persistent broadcast-audio status/control visible. Use accessible controls at least 44px high, and preserve uncropped video.
4. Chart a shot with player, end, stone number, shot type, turn and execution grade. Optional miss tags, notes and a video flag add coaching detail. Proposed tags include heavy, light, inside and outside; map the official vocabulary only after inspecting the workbook.
5. Tap Flag immediately to capture the moment, then choose 30 seconds, 1, 2 or 5 minutes back, or a custom duration. Default the segment end to the captured moment; allow tail time and later trimming. Add player/shot, category and notes. Interpret flags as private review markers by default; a public broadcast graphic is a separate optional action that never exposes private notes.
6. At game completion, generate player and team reports and a review queue. Coaches can correct charting later through audited revisions without changing the finalized game result. Save reports and notes under team/organization access rules for future games and seasons.

## Scoring and reporting

Keep end-result scoring separate from shot evaluation. The existing scoreboard remains authoritative for end points and hammer; charting evaluates individual attempts.

The supplied workbook uses numeric shot scores of 0–5 and separate Make, Partial, Limited and Xmiss execution categories. Overall shooting percentage is 100 × total numeric shot scores / (5 × numerically scored attempts). For example, 60 points across 16 scored attempts is 75%. Do not automatically convert execution categories to numeric grades: the workbook supplies separate inputs and no inspected mapping between them. Version the scoring profile so future rule changes do not silently alter historical reports. Picks, burnt rocks and throw-throughs are explicitly excluded from scoring and retained as notes. See the mapping for the workbook's differing per-category denominator behavior.

Reports should include execution percentage and attempt counts by player, game, end, shot category and turn; the distribution of grades; miss reasons; and linked review segments. Show missing/ungraded attempts and coverage. Never count an ungraded or unthrown stone as a miss. Distinguish made/partial/missed counts from execution percentage, with explicit profile definitions for those labels. Compute team percentages from underlying totals, not averages of rounded player percentages. Season reports should compare compatible profiles and show sample sizes.

Generate a dated report revision after the coach reconciles missing shots. Store the underlying events plus profile version and report revision, so corrected reports remain reproducible. CSV/PDF export and spreadsheet compatibility can follow the verified template mapping.

## Broadcast mute

The current ScoringProgramControls UI explicitly says audio is simulated and does not control YouTube sound. The DJI test plan also leaves external capture/publication as future work. This is a prerequisite, not a finished feature to expose to coaches.

Implement mute in the actual outgoing program audio path, upstream of the YouTube encoder. Muting a tablet player would only mute that tablet. Decide whether the initial action silences all program audio or an isolated team-microphone bus; a mixed microphone input cannot selectively remove individual voices.

Use an explicit coach mute hold alongside organizer and sponsor holds. Releasing one hold must not override another. Return requested/applied/unknown states and show a clear acknowledgement before the coach starts a private conversation. Keep an applied mute latched across disconnects until authorized release. Never replay stale queued unmute commands after reconnect. Preserve a visible timer and organizer recovery control. Test actual outgoing audio and archive output through reconnect, source replacement and sponsor transitions. Already-transmitted speech cannot be removed by a later mute.

## Flags and YouTube review

Store segment metadata in CurlCoach and play the source replay in an embedded YouTube player. The [IFrame API](https://developers.google.com/youtube/iframe_api_reference) supports start/end playback positions and seeking; seeking can invalidate the configured end position, so the review controller must enforce the segment boundary again. These are virtual segments, not independent video files.

Store event time, server receipt time, capture clock offset, broadcast session/video ID, selected lookback/tail and calibrated replay positions. Distinguish rink-side flags from flags made while watching delayed video: use the player position for the latter. Do not derive exact replay timing from game creation time. Calibrate against a recognizable moment, represent gaps or reconnects as separate timing segments, and let the coach adjust replay alignment. Example: a flag at replay 42:10 with a two-minute lookback becomes 40:10–42:10.

Live rewind depends on [YouTube DVR](https://support.google.com/youtube/answer/9296823?hl=en). Native [YouTube Clips](https://support.google.com/youtube/answer/10332730?hl=en) have eligibility restrictions, so they should not be a core dependency. Save flags even before an archive is ready and show pending/unavailable status. Private or removed videos remain subject to YouTube access; CurlCoach access does not grant YouTube access. Keep notes/statistics if a video disappears.

If standalone downloadable clips become necessary, plan an authorized parallel recording and rendering service with storage/retention costs. Do not base that feature on downloading YouTube playback.

## Fit with the current repository

- Extend the existing invitation/session flow with a coach role; current Role only includes two cameras and scorer. Review every role validation, authorization check and lifecycle transition.
- Reuse organization/game boundaries, Zod validation and append-only score-event conventions. New coach permissions should separately cover charting, private notes and audio control. Public game responses must exclude coaching records.
- Existing Supabase and YouTube broadcast-session work provides integration points. See live-youtube-broadcasting.md; runtime deployment and provider credentials still need verification. The root README describes an older mock slice and is not a complete account of current implementation.
- Proposed records: coach memberships, roster/player identities and game roster snapshots, scoring profiles, shot events with corrections, review flags/notes, broadcast timeline anchors, audio commands/holds/acknowledgements and report revisions. Associate every record with its organization and game/team as appropriate.
- Queue charting/flags locally for network interruptions with unique request IDs, original occurrence times and visible sync status. Reconcile concurrent corrections rather than silently overwriting them. Audio commands require a live connection and acknowledgement.
- Keep provider adapters under src/lib/providers and credentials server-only. Gate add-on access server-side, independently of whether its menu is visible.

## Delivery sequence and acceptance

1. Use the supplied tracker and completed field/formula mapping; validate a scored example and settle numeric-grade guidance, scoreboard analysis, audio scope and flag visibility.
2. Build coach access, roster and shot charting with provisional/verified profile labels, durable storage, audited corrections and player reports. Verify a complete manually scored fixture, omissions, substitutions, zero-attempt players and cross-team access denial.
3. Add flags, notes, replay calibration and saved review sessions. Verify timestamps across delayed viewing, reconnects and unavailable archives.
4. Deliver real audio capture/mixing and acknowledged tablet mute. Gate release on an end-to-end broadcast audio test; charting can ship before this dependency is ready.
5. Add season comparisons, exports and optional standalone clip rendering.

For implementation run the repository's required format check, typecheck, unit tests, build and end-to-end suite, plus relevant database authorization tests and physical tablet/broadcast checks. This discovery document alone does not verify runtime behavior.
