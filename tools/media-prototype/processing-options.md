# Scoring computer and cloud processing options

Product direction under consideration: offer the same scoring controls with a
choice of where the broadcast is processed. No desktop application is implemented
by this prototype.

## Scoring-computer mode

Two phones publish camera feeds; an authorized broadcaster on the scoring laptop
or desktop receives them, composes cameras, score and sponsors, encodes 720p60,
and sends the result directly to YouTube. A small installed helper can hide encoder
configuration behind the existing Start/Stop controls. Reuse the composition
rules, lifecycle and diagnostics across local and cloud modes; do not build a
general-purpose OBS replacement.

This removes the cloud GPU encoder and its outgoing YouTube traffic for those
games. It does not automatically remove camera relay costs: the current LiveKit
SFU still forwards both feeds. Direct local WebRTC between phones and computer
would be a separate transport change, requiring signaling and TURN fallback.

The scoring computer must remain awake, powered, connected, and able to sustain
two decodes plus composition and hardware encoding. Test actual hardware rather
than promising all laptops work. With a 6 Mbps video target, leave upload headroom
for audio, protocol overhead and other traffic; if the phones and computer use
the same internet connection, cloud-relayed camera uploads also consume that
connection's upload capacity. Test USB audio explicitly and never silently select
a phone microphone.

## Browser-only variant

Modern browsers can compose frames and use WebCodecs for encoding, but hardware
support is not guaranteed. WebCodecs supplies encoded chunks; container muxing,
delivery, reconnects and lifecycle still need implementation. Do not promise a
browser tab can directly replace a native RTMPS encoder. A thin relay is a possible
alternative to an installed helper, but retains relay bandwidth costs and adds a
service to operate. Prototype this only if avoiding installation is a priority.

## Cloud mode

Keep the cloud processor for phone/tablet scoring or users who do not have a
suitable computer. Its lifecycle must be independent of the scoring browser.
The current endurance runner exercises that independence for a test job; the
ten-minute camera lab is still an ephemeral web prototype.

Suggested sequence: complete the cloud pipeline's measurement and reusable output
adapter, benchmark the intended scoring computer, then choose the default mode
based on measured performance and setup effort. Keep production streaming on its
existing provider until the chosen replacement passes full lifecycle checks.

Sources: [WebCodecs specification](https://www.w3.org/TR/webcodecs/),
[YouTube RTMPS ingestion](https://developers.google.com/youtube/v3/live/guides/rtmps-ingestion).
