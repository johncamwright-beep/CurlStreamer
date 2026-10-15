# Studio session flow

Opening an authorized game in the Windows workspace prepares its receiver and
preview. There is no separate Start Game action. The native `--preview-only` mode
initializes the program without opening an MKV file or starting a recording.
YouTube starts only when the operator chooses **Broadcast to YouTube**.

Saved IP sources start off in each new Studio session. Use **Connect** on each
camera tile to begin receiving it. The same button becomes **Hide from broadcast**
or **Show in broadcast** after connection; hiding keeps the camera connection warm.
Reconnect is a recovery action for an enabled camera that has lost fresh video.
Returning to the same running game preserves its connection intent.

Leaving a game during a broadcast asks **Continue broadcast**, **Pause broadcast**,
or **Stay here**. Continue retains the cameras and USB microphone while visiting
other pages. Pause waits for Studio to confirm its temporary card before leaving;
the sender and YouTube watch link remain alive. A status beside End Game shows the
current broadcast state. Other pages show the running game's title, **Return to
game**, and Pause/Resume controls. Browser Back and full document navigation use
the same choice. An approved authentication redirect does not ask a second time.

Opening another game does not replace the existing Studio session. Return to its
game to manage a live broadcast. If YouTube output is fully inactive, **Switch
Studio to this game** explicitly releases its preview and microphone before
preparing the other game; saved scores and watch links remain intact.

Studio must stay open to continue or send the pause card. Fully exiting for a
restart stops its sender; YouTube may show a connection spinner until Studio
returns. Closing without ending the game retains the game and watch link. Ending
the game uses the existing final-card flow and releases the native session.

The monitoring image is 1280x720 at a target of 15 updates per second, rather than
two 1080p snapshots. Requests run sequentially to avoid cancelling a slow image
before it loads. Shared-memory reads retry a concurrent frame write briefly.
The underlying OBS program is still 1920x1080 at 30 fps. Actual device smoothness
must be checked after the new desktop version is installed.

A server heartbeat is labelled Phone online / Waiting for video. Only advancing,
verified decoded-frame counters from Studio's private renderer yield Video
receiving. Counters expire after five seconds; the web display also expires if
the native status bridge stops. QR codes collapse when video is received.
Regular browsers cannot infer PC video reception from a heartbeat.

For a connected phone whose host/prflx addresses are redacted, DirectPeer permits
a fresh, negotiation-scoped path-confirmed message from the authenticated receiver
as complementary evidence. Only the receiver emits it after its own unchanged
path checks pass. It is rejected from the camera side, expires after five seconds,
and cannot admit relays, server-reflexive candidates or explicitly invalid/public
endpoints. The phone waits up to eight seconds for this proof; the PC still rejects
an unproven receive path. Physical Camera 2 recovery remains to be verified.

Validation includes native preview-only startup without an MKV, correct program
quadrants, clean shutdown, WebView image decoding and game/freshness isolation,
receiver-confirmation expiry/role/relay boundaries, renderer-only frame reports,
stale counters, and 18 browser checks for cameras and card state. Full integration
checks run in CI before final handoff. Automatic foreground game preparation and
physical camera reception require checking in the installed app.

The earlier Supabase retry storm was addressed by migration 0032: application
conflicts use PT409 instead of PostgREST's retried SQLSTATE 40001. Authorization,
revision checks, row locks and existing game data were preserved.

## Compact workspace follow-up

The user confirmed both physical cameras connect and the Preview 6 picture looks
good. Preview 7 removes diagnostic text from the native program composition and
the game-details overlay from the preview. The native camera-action bar is removed;
a short status notice remains only while preparing or when the session is not ready.
The scoring header places the hamburger beside the game title. Desktop scoring has
a compact score summary, static camera/remote-scorer cards, visible camera-layout
and sponsor controls below score entry, then End Game. The primary desktop layout
fits a 1280x850 fixture with sponsor playback active; QR codes and final-score review
can expand as needed. Existing non-desktop program controls remain available.
