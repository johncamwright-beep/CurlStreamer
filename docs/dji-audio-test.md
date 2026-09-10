# Managed audio — current build

Phone mic switches are on the scoring camera cards. Audio defaults off and is bound to the camera assignment generation. Permission failures leave video running; grant permission explicitly on the phone when needed. DirectPeer carries an optional audio track to the private OBS renderer. Peak/RMS observations remain local and expire after six seconds.

An isolated native Browser Source tone test proved nonzero 48 kHz stereo AAC output: peak 0.10021236, RMS 0.07068347, 191882 nonzero samples in two seconds. This proves the native audio bus, not physical phone capture or DJI delivery. Phone-to-YouTube audio and synchronization still need a short physical check.

## DJI receiver

Use USB and Q (Quadraphonic) mode for four independent channels. Studio can meter those before mixing to mono. Receiver Mono mode combines the transmitters upstream and cannot provide four independent software meters. DJI lists Windows Audacity as compatible; browser four-channel support remains to be verified on this hardware.

- https://www.dji.com/mic-3/faq
- https://dl.djicdn.com/downloads/DJI%20Mic%203/20250828/COMPATIBILITY_LIST/DJI_Mic_3_Quadraphonic_Computer_Software_Compatibility_List_EN.pdf

The new native Studio build uses shared-mode WASAPI instead of WebView2 for USB input. Find microphones enumerates active Windows inputs without opening capture. Use USB audio explicitly starts the selected input for the current game. Actual channels receive independent meters, mute and level controls. A fixed channel-count divisor mixes to mono, followed by 0.5 renderer gain for program headroom. This version requires 48 kHz. Windows microphone privacy permission still applies.

Mono float PCM travels over the authenticated local operator connection into a bounded private-renderer queue; no USB audio is stored or uploaded to Supabase. Empty packets flush playback, and changing games or closing Studio stops capture. The OBS renderer adds this mix to outgoing audio. Older Studio builds retain the browser-only input diagnostic until the native update is installed.

Synthetic native tests cover PCM16/24/32 and float decoding, four distinct channel meters, mute and mono mixing. Read-only endpoint enumeration passed. Physical DJI capture, channel identity and end-to-end microphone delivery remain unverified. The update is staged under work/studio-native-usb; do not replace the running app while Studio/OBS are active.

## Cost and cleanup

Studio keeps sponsor image versions in its persistent SponsorAssets cache, bounded to 128 MB on disk and 32 MB in memory. Reopening Studio reuses the local copy; signed URL rotation does not download it again. Uploading a replacement creates a new object path and downloads the new version. Removed sponsors stop being served on the next authorized projection. This reduces image bandwidth, not cloud storage capacity. Full-game control polling remains a further egress improvement.

The retired M1 Supabase project raavodkuvcbbkddfpwet was deleted at John's request on September 9. Installed Studio uses hoogvyhuxevihttbutwl. The old local .env.local is archived under ignored work/retired-m1.env.local and its development listener was stopped. Active project credentials were unchanged. No SQL migration is needed: generation checks make old mic intent inert after release.
