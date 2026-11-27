# Coaching local video flags

Coaches use **Shot Tracker → Flag recent video**. Studio supplies a paired rolling video buffer on the laptop; it does not initiate each flag.

## First connection and phone acceptance test

1. Run the matching game in updated Studio with a connected camera. Let its buffer collect footage.
2. Keep the phone and laptop on the same private router. In Studio's **Phone review** settings, read the laptop address and pairing code.
3. In the phone's Shot Tracker game, choose **Flag recent video → Laptop connection**. Enter that address (explicit `http://`) and code.
4. Tap **Capture recent video**. A temporary laptop connection window downloads the clip over LAN and returns it to the Shot Tracker overlay. Allow the window if Safari asks.
5. Scrub to a visibly different frame, use the one-second adjustments if needed, choose current player or team, add notes, and save. Confirm the flag in the top-navigation Flagged shots page; the current scoring draft must be unchanged.
6. Capture again without entering the code. Check that the window is newer. Also test closing the overlay during capture and reconnecting after Studio restarts.

The address is remembered per account on this browser. Pairing cookies expire after two hours; restarting Studio or changing games also requires pairing again. No cloud video is uploaded. Saved review links continue to use the broadcast's existing timestamp mapping; they do not preserve a standalone copy of the local clip.

## Browser boundary

The hosted coaching page is HTTPS; an iPhone cannot simply embed/fetch the laptop's HTTP video. A short-lived top-level LAN window performs same-origin pairing and capture, then sends a bounded MP4 Blob back through `postMessage`. The coach's scrubber, audience and notes remain in Shot Tracker. The LAN page validates the configured HTTPS origin, exact opener, per-capture nonce and game identity. The parent validates the exact local origin/window/nonce, game, timing, media type and 40 MB size limit. There is no permissive CORS, no iframe permission change, and no mixed-content exception.

Existing HttpOnly/SameSite pairing, exact Host checks, same-origin JSON POST checks and cookie-owned clip access remain enforced. Only flag metadata reaches the authenticated, organization/game-authorized local-review API. Saving a standalone flag does not write a shot grade or change the charting position. Retried saves reuse the same immutable request ID and payload.

Studio attempts to open paired access on a private interface at port 3189 when recording starts. A listener failure does not stop recording or streaming; Phone review settings provide manual connection setup. Access closes with the recorder. Legacy direct local-page review remains available while real iPhone acceptance is completed.

Automated coverage exercises HTTPS-to-LAN popup transfer, local seeking without new media requests, repeat capture using the pairing cookie, and player/team metadata-only saves in desktop and Chromium phone layouts. A physical iPhone test is still required; emulation does not prove Safari popup or local-network permissions.
