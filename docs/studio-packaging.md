# Windows Studio preview

Version 0.3.0-preview.1 embeds the hosted account/game workspace in a Windows
WebView2 window. Games and schedules, seasons, sponsors, account settings, scoring
and QR invitations use the existing website. A separate persistent app profile
keeps the user's sign-in; the first launch requires signing in again.

Native Start recording checks the selected game's PC, asks the signed-in website
for a scoped recording grant and sends it to the local recorder in memory.
Neither the game URL nor the private source needs copying. Stop & save recording
finalizes the file. Closing Studio waits for controller cleanup. Navigation and
grant responses are restricted to the configured origin and exact game.

The workspace uses Microsoft's WebView2 Runtime (already installed on the
development PC); the pinned SDK and loader are included in the package. Clean
machine runtime bootstrap remains a distribution prerequisite. No host objects
or generic native commands are exposed to web content. External OAuth setup
still uses the normal website; integrated YouTube controls remain subsequent work.
Streaming remains disabled in this private preview.

The earlier 0.2 launcher and its manual link controls are retained for legacy
build tests. They are not the current desktop user experience.

## Implemented

- Integrated workspace, native recording handoff, scoped remote-scoring/camera
  invitations and persistent account profile in 0.3.0-preview.1.

- Windows Forms launch window: paste a game page link, open/reopen controls, open
  recordings, and finish/close Studio. No installed Node or PowerShell is needed
  for the assembled application.
- One instance per Windows session, hidden child process, sanitized environment,
  embedded hashes for the Node executable and controller.
- Public configuration with one HTTPS website origin, Supabase publishable
  configuration and an explicit streaming flag. No fixed game or account tokens.
- Full component SHA-256 manifest and pinned Node version; corrupted, missing,
  duplicate and escaping manifest entries are rejected. Hashes check integrity;
  release signing remains separate work.
- Recordings in `%LOCALAPPDATA%/CurlStreamer/Studio/Recordings`; disposable CEF
  caches in the adjacent `Cache` directory, outside the installation.
- Exit waits for recording finalization and reports uncertain cleanup instead of
  silently succeeding. Stream stop remains independent of recording stop.
- Compiled Inno Setup private preview for a per-user Windows installer and Start menu shortcut.
  Install/uninstall checks the running-app mutex and retains recordings.

## Developer build

PowerShell 7, npm dependencies, Node 22 or 24 and the Windows Framework compiler
are build dependencies. The Node executable used for the build is copied and its
exact version/hash pinned. The current private assembly uses Node 24.19.0.

Create a private `studio.json` with only:

```json
{
  "version": 1,
  "website": "https://curlstreamer.vercel.app",
  "realtimeUrl": "https://example.supabase.co",
  "realtimeKey": "sb_publishable_example",
  "streamingEnabled": false
}
```

Then assemble into a new directory:

```powershell
./scripts/build-m5-studio.ps1 -SetupRoot C:/CurlStreamer-setup -Destination C:/Studio-staging -Configuration C:/private/studio.json
node scripts/check-m5-studio.mjs C:/Studio-staging
```

The builder uses the rehearsed readiness recorder, default-deny and production
service builds, PC host and OBS 32.2.2 runtime from the explicit setup directory.
It copies only OBS `bin`, `data` and `obs-plugins`; never a developer OBS profile.
It rebuilds the controller and renderer without modifying repository renderer
assets. The smoke check uses an empty data profile and unarmed native PC check;
no pairing, recording or provider activation is requested by that check.

Layout: `CurlStreamer Studio.exe`, `studio.json`, `manifest.json`, `node/`,
`app/`, `native/`, `renderer/`, `obs/`. The private assembly is not a release asset.

## Evidence and remaining work

September 9: launcher compiled; relocated package passed full hash validation,
empty-profile controller startup, native PC check and confirmed shutdown. The
relocated recorder also rendered a local two-panel test scene, finalized MKV,
and passed decoded-frame checks including local ICE visibility. Focused unit
checks cover configuration, origin boundaries, corruption and finalization.
These are local automated checks, not a clean Windows installation or GUI review.

The private installer now compiles with Inno Setup 6.7.3. Its running-app guard,
install, same-version reinstall, installed controller/native check and uninstall
are exercised locally; a synthetic recording-data marker survives each step.
The approximately 151 MB installer records component-manifest and installer hashes.
The test suppresses shortcuts and does not claim Start menu or visual validation.

Before publishing binaries: complete bundled
licenses/source notices, verify prerequisites on a clean Windows machine, review
the native window at normal/high DPI, test upgrades and crash recovery, and
integrate ordinary game selection/pairing with the deployed website. Production
streaming remains disabled in this private assembly. No installer is published.

After Windows was unlocked, the native launcher passed visual review at the current
display scale, empty-link validation, opening browser controls and normal Finish/close
with both launcher and controller exiting. Separate display-scale testing remains.

Inno Setup's [AppMutex](https://jrsoftware.org/ishelp/topic_setup_appmutex.htm)
provides the running-app install/uninstall guard. The launch window uses Windows
Forms on the Windows .NET Framework; see Microsoft's
[Framework release notes](https://devblogs.microsoft.com/dotnet/announcing-the-net-framework-4-8/).

The original development operator build remains available through
`scripts/build-m4-operator-local.ps1 -SetupRoot ... -Readiness` for existing pilot
workflows. Desktop packaging does not deploy Vercel, apply migrations, or create
a YouTube broadcast.

## Installer build and local lifecycle check

```powershell
./scripts/build-m5-installer.ps1 -StudioSource C:/Studio-staging -InstallerOutput C:/Studio-installer -CompilerPath C:/build-tools/Inno/ISCC.exe
./scripts/check-m5-installer.ps1 -Installer C:/Studio-installer/CurlStreamer-Studio-0.2.0-preview.2-Setup.exe -TestRoot C:/Studio-install-check
```

The builder checks every listed hash, rejects unlisted files and links, and accepts
only public configuration with streaming disabled. Installer output must be
outside the assembly. Setup requires Windows 10 build 17763 or newer and .NET
Framework 4.8 or newer; it does not change Windows prerequisites automatically.

The lifecycle check refuses to run if Studio is already installed or open. It
installs into a new test directory, runs the offline installed-controller check,
reinstalls, repeats the check and uninstalls. It checks that registration/executable
are removed while a uniquely named synthetic marker in the recording directory
survives. It removes only its own marker. This tests the current PC, not a clean
Windows machine or a version-changing upgrade.

Compiler acquisition: [official Inno Setup downloads](https://jrsoftware.org/isdl.php),
6.7.3, with a valid Pyrsys B.V. Authenticode signature checked locally. The .NET
check uses the documented [IsDotNetInstalled](https://jrsoftware.org/ishelp/topic_isxfunc_isdotnetinstalled.htm)
function. Downloaded build tools and compiled installers stay outside Git.

## Game-page handoff

Game administrators and same-game organizers now use **Set up Windows Studio**
from the ordinary game page. `/games/{id}/studio` presents the launch/copy fallback,
camera invitations and private recording handoff, and pairing/YouTube preparation.
Camera and streaming sections reflect existing deployment gates; visiting the
page never enables those gates or performs a resource write. Completed games and
scorer/viewer access do not expose setup controls. Every existing API continues to
enforce its own authorization.

Preview 0.2.0-preview.2 installs a per-user `curlstreamer:` URL handler. The website
sends only an encoded HTTPS game page URL, never invitation or approval codes.
Studio validates the link and prefills its game field; the operator still clicks
Open Studio. The configured website origin is checked by the controller before
any game connection. An already-open instance is left alone and asks the operator
to finish its current game. Uninstall removes the handler.

The copy-link/manual launch path remains available when the app or browser handler
is unavailable. No public installer download link is shown until an installer is
published. Use a Studio build configured for the same website origin; production
and Vercel branch-preview origins are distinct.

Native parser checks reject extra commands, malformed URLs and embedded tokens.
Desktop/mobile browser checks verify navigation, role gating and no automatic
writes. The updated installer lifecycle check also verifies the quoted URL-handler
command and its removal. Interactive launch with a protocol argument was blocked
by automatic tool approval review; it remains distinct from the passing parser
and registry checks.
