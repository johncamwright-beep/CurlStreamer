# Managed audio — current build

Phone mic switches are on the scoring camera cards. Audio defaults off and is bound to the camera assignment generation. Permission failures leave video running; grant permission explicitly on the phone when needed. DirectPeer carries an optional audio track to the private OBS renderer. Peak/RMS observations remain local and expire after six seconds.

An isolated native Browser Source tone test proved nonzero 48 kHz stereo AAC output: peak 0.10021236, RMS 0.07068347, 191882 nonzero samples in two seconds. This proves the native audio bus, not physical phone capture or DJI delivery. Phone-to-YouTube audio and synchronization still need a short physical check.

## DJI receiver

Use USB and Q (Quadraphonic) mode for four independent channels. Studio can meter those before mixing to mono. Receiver Mono mode combines the transmitters upstream and cannot provide four independent software meters. DJI lists Windows Audacity as compatible; browser four-channel support remains to be verified on this hardware.

- https://www.dji.com/mic-3/faq
- https://dl.djicdn.com/downloads/DJI%20Mic%203/20250828/COMPATIBILITY_LIST/DJI_Mic_3_Quadraphonic_Computer_Software_Compatibility_List_EN.pdf

Native Studio uses raw shared-mode WASAPI instead of WebView2 for USB input. Find microphones enumerates active Windows inputs without opening capture. Use USB audio explicitly starts the selected input for the current game. The receiver must use 48 kHz; Windows microphone privacy permission still applies. Each physical channel is processed separately before its mute/stream-level fader, then summed to mono without dividing by the number of silent microphones. Finite floating-point input above full scale is preserved until processing and final peak protection.

## Audio cleanup and meters

USB setup contains two compact selectors. Noise reduction has Off, Gentle, and Strong modes; Gentle is the default for a new Studio session. It runs a pinned, locally bundled RNNoise model on each microphone, with no cloud audio upload or runtime download. Gentle blends the filtered signal with an equally delayed original to preserve quiet speech; Strong uses the filtered signal. A missing library keeps capture working, shows an unavailable message, and reports noise reduction Off.

The hum selector has Off, 50 Hz, and 60 Hz modes. Narrow notches target the selected mains frequency and its first harmonic. Start with 60 Hz for Ontario electrical hum; leave it off if there is no audible buzz. LED drivers can produce other frequencies, so this is not a promise to remove every lighting noise. The shared program microphone bus also has an 80 Hz low cut, speech compression with makeup gain after compression, and final peak protection. Sponsor media does not pass through the microphone noise reducer.

Per-microphone meters show receiver input peaks in dBFS, before cleanup, mute, or stream-level changes. Peaks are accumulated between status publications. Amber indicates less than 6 dB of headroom; red means full scale was reached, held for three seconds. This indicates input saturation risk, not proof of where distortion originated. Lowering the Studio stream fader cannot repair already distorted input. Stalled input meters decay to silence instead of displaying old levels.

The denoiser adapter uses 480-sample blocks at 48 kHz and aligns its original/filtered branches with a fixed 960-sample (20 ms) delay, including bypass. Changing noise modes does not change the audio offset. The existing program queue and signed microphone sync adjustment remain separate. Shared speech processing adds no onset delay compared with the previous graph; real microphone-to-YouTube sync still needs a clap check.

## Physical check before a game

John heard the same intermittent crackling in headphones connected directly to the DJI receiver and in the stream. That establishes an upstream problem which Studio cleanup cannot repair. Home testing with one transmitter was clearer; it does not establish that four transmitters will be clean at the rink.

1. Test all four transmitters together with headphones in the receiver. Compare receiver-only operation with USB connected, keeping transmitter positions unchanged. If USB connection changes the noise, investigate receiver power/cable/computer coupling before assuming radio interference.
2. Compare Noise reduction Off and Gentle while one player speaks softly, normally, and shouts. Try Strong only if it improves speech without swallowing words. Check the receiver input meter and listen to the processed recording separately.
3. Enable the appropriate hum filter only when electrical buzz is audible. Other teams' voices overlap wanted speech and cannot be reliably removed by a simple filter.
4. Record a clap in an unlisted test stream and adjust signed microphone sync only after the timing settles. Check quiet speech recovery after a shout and confirm no clicks when changing cleanup settings.

Internal 32-bit float recordings on each DJI transmitter are useful independent backups for later editing; they do not change live USB delivery. A clean internal recording alongside receiver crackle helps distinguish a transmission problem from distorted microphone capture.

Mono float PCM travels over the authenticated local operator connection into a bounded private-renderer queue; no USB audio is stored or uploaded to Supabase. Empty packets flush playback, and changing games or closing Studio stops capture. The OBS renderer adds this mix to outgoing audio. Older Studio builds retain the browser-only input diagnostic until the native update is installed.

Synthetic native tests cover PCM16/24/32 and float decoding, four distinct channel meters, mute, floating-point headroom, interval peaks, full-scale hold, and mono mixing. Earlier read-only endpoint enumeration passed. John has confirmed microphone audio reaches the stream; the current unresolved physical issue is intermittent crackling already audible at the receiver.

The September 10 local check used the installed recorder and OBS runtime with the real private program bridge, including its cookie and CSP. A generated 440 Hz tone reached the AAC recording (peak 0.38025, RMS 0.14329); flushing the queue left a silent tail. Preview-only mode also fetched USB PCM successfully. These checks bypass physical capture and the native Workspace-to-operator POST, and do not establish YouTube reception. The earlier standalone tone fixture did not exercise the private bridge. Evidence and scripts remain under ignored `work/native-audio-proof`.

The compact Audio panel keeps four microphone meter/fader slots visible. USB setup opens a dialog containing receiver selection, cleanup settings, and Disconnect. Closing this dialog keeps capture running. Camera microphone switches stay on the camera cards. Four microphone controls fit across a sufficiently wide panel; narrower panels use two columns to preserve usable volume sliders.

Workspace exposes count-only USB delivery diagnostics and writes the latest snapshot to `%LOCALAPPDATA%/CurlStreamer/Studio/usb-delivery.json` at most every five seconds. It records time, capture running state, accepted POST packets/bytes and generic failure counts, never microphone samples or credentials. Isolated profiles use their own directory. Use this to distinguish capture-only meters from accepted delivery to the local output process. Both local recording and RTMP share the native AAC encoder and audio track; no proven RTMP encoder defect has been found.

## Cost and cleanup

Studio keeps sponsor image versions in its persistent SponsorAssets cache, bounded to 128 MB on disk and 32 MB in memory. Reopening Studio reuses the local copy; signed URL rotation does not download it again. Uploading a replacement creates a new object path and downloads the new version. Removed sponsors stop being served on the next authorized projection. This reduces image bandwidth, not cloud storage capacity. Full-game control polling remains a further egress improvement.

The retired M1 Supabase project raavodkuvcbbkddfpwet was deleted at John's request on September 9. Installed Studio uses hoogvyhuxevihttbutwl. The old local .env.local is archived under ignored work/retired-m1.env.local and its development listener was stopped. Active project credentials were unchanged. No SQL migration is needed: generation checks make old mic intent inert after release.
