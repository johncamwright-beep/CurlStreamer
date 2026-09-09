# Source consolidation validation

September 9, 2026. The direct-network pilot was merged with GitHub main at
`6ced1d1`, preserving its newer dashboard, game setup, scoring and read-recovery work.

## Checks

- TypeScript: passed after merge conflict resolution.
- Unit suite: 1,183 passed, 85 skipped (158 passing files, 12 skipped files).
  Both real HTTP middleware checks passed in the environment-free source copy.
- Next production build: passed with local mock configuration; lint warnings remain.
- Broad browser suite: initially 108 passed, 20 skipped, six failed. The failures
  were outdated test expectations for opponent entry and explicit/sequential
  invitation creation. The affected game-control and vertical-slice files then
  passed all 20 cases on desktop/mobile. No failing case was removed or skipped.
- Dedicated YouTube settings, dashboard and setup suite: all 18 cases passed.
- Studio operator/renderer build: passed into separate staging with `-Readiness`.
- Source audit: no known private pilot identifiers, developer home paths or
  recognized real credential patterns in the publishable source. This is a
  bounded scan, not a guarantee that arbitrary secrets can always be detected.
- Staged diff whitespace check: passed. Intentional patch context/generated
  whitespace is declared in `.gitattributes`.
- Full formatting remains baseline debt: the working checkout reports 263 files.
  Touched consolidation files are formatted; the broad formatter also inspects
  older files and local handoff notes. This is not a green full-format claim.

Browser/build checks ran in an isolated source copy without `.env.local`; provider
fixtures used loopback addresses. No shared database mutation, real broadcast,
production deployment or native-runtime replacement was part of these checks.
Native and database skips need their separate dependency-enabled evidence.

## Automated checks

The new GitHub workflow runs npm installation, typecheck, units, renderer build,
mock production build and browser integration. Formatting debt is visible but
non-blocking until cleaned up separately. The workflow uses no production secrets
and does not deploy. Its first hosted result must be inspected independently of
the local Windows results above.

Configuration references: [setup-node v4](https://github.com/actions/setup-node/tree/v4)
and [Playwright CI guidance](https://playwright.dev/docs/ci-intro).
