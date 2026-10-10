# Managed audio — current build

Phone mic switches are on the scoring camera cards. Audio defaults off and is bound to the camera assignment generation. Permission failures leave video running; grant permission explicitly on the phone when needed. DirectPeer carries an optional audio track to the private OBS renderer. Peak/RMS observations remain local and expire after six seconds.

An isolated native Browser Source tone test proved nonzero 48 kHz stereo AAC output: peak 0.10021236, RMS 0.07068347, 191882 nonzero samples in two seconds. This proves the native audio bus, not physical phone capture or DJI delivery. Phone-to-YouTube audio and synchronization still need a short physical check.

## DJI receiver

Use USB and Q (Quadraphonic) mode for four independent channels. Studio can meter those before mixing to mono. Receiver Mono mode combines the transmitters upstream and cannot provide four independent software meters. DJI lists Windows Audacity as compatible; browser four-channel support remains to be verified on this hardware.

- https://www.dji.com/mic-3/faq
- https://dl.djicdn.com/downloads/DJI%20Mic%203/20250828/COMPATIBILITY_LIST/DJI_Mic_3_Quadraphonic_Computer_Software_Compatibility_List_EN.pdf

The new native Studio build uses shared-mode WASAPI instead of WebView2 for USB input. Find microphones enumerates active Windows inputs without opening capture. Use USB audio explicitly starts the selected input for the current game. Actual channels receive independent meters, mute and level controls. A fixed channel-count divisor mixes to mono, followed by 0.5 renderer gain for program headroom. This version requires 48 kHz. Windows microphone privacy permission still applies.

Mono float PCM travels over the authenticated local operator connection into a bounded private-renderer queue; no USB audio is stored or uploaded to Supabase. Empty packets flush playback, and changing games or closing Studio stops capture. The OBS renderer adds this mix to outgoing audio. Older Studio builds retain the browser-only input diagnostic until the native update is installed.

Synthetic native tests cover PCM16/24/32 and float decoding, four distinct channel meters, mute and mono mixing. Read-only endpoint enumeration passed. John reports that all four physical microphone meters now respond independently, but that YouTube is silent. Physical microphone delivery to YouTube is still unresolved.

The September 10 local check used the installed recorder and OBS runtime with the real private program bridge, including its cookie and CSP. A generated 440 Hz tone reached the AAC recording (peak 0.38025, RMS 0.14329); flushing the queue left a silent tail. Preview-only mode also fetched USB PCM successfully. These checks bypass physical capture and the native Workspace-to-operator POST, and do not establish YouTube reception. The earlier standalone tone fixture did not exercise the private bridge. Evidence and scripts remain under ignored `work/native-audio-proof`.

The compact Audio panel puts USB setup and Disconnect in its header and retains the capture listener when collapsed. Camera microphone switches stay on the camera cards. Four microphone controls fit across a sufficiently wide panel; narrower panels use two columns to preserve usable volume sliders.

John confirmed the YouTube player is unmuted and completely silent. Workspace now exposes count-only USB delivery diagnostics and writes the latest snapshot to `%LOCALAPPDATA%/CurlStreamer/Studio/usb-delivery.json` at most every five seconds. It records time, capture running state, accepted POST packets/bytes and generic failure counts, never microphone samples or credentials. Isolated profiles use their own directory. After the next installed-build test, use this to distinguish capture-only meters from accepted delivery to the local output process. Both local recording and RTMP currently share the native AAC encoder and audio track; no proven RTMP encoder defect has been found.

## Cost and cleanup

Studio keeps sponsor image versions in its persistent SponsorAssets cache, bounded to 128 MB on disk and 32 MB in memory. Reopening Studio reuses the local copy; signed URL rotation does not download it again. Uploading a replacement creates a new object path and downloads the new version. Removed sponsors stop being served on the next authorized projection. This reduces image bandwidth, not cloud storage capacity. Full-game control polling remains a further egress improvement.

The retired M1 Supabase project raavodkuvcbbkddfpwet was deleted at John's request on September 9. Installed Studio uses hoogvyhuxevihttbutwl. The old local .env.local is archived under ignored work/retired-m1.env.local and its development listener was stopped. Active project credentials were unchanged. No SQL migration is needed: generation checks make old mic intent inert after release.
