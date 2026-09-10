# Managed audio — current build

Phone mic switches are on the scoring camera cards. Audio defaults off and is bound to the camera assignment generation. Permission failures leave video running; grant permission explicitly on the phone when needed. DirectPeer carries an optional audio track to the private OBS renderer. Peak/RMS observations remain local and expire after six seconds.

An isolated native Browser Source tone test proved nonzero 48 kHz stereo AAC output: peak 0.10021236, RMS 0.07068347, 191882 nonzero samples in two seconds. This proves the native audio bus, not physical phone capture or DJI delivery. Phone-to-YouTube audio and synchronization still need a short physical check.

## DJI receiver

Use USB and Q (Quadraphonic) mode for four independent channels. Studio can meter those before mixing to mono. Receiver Mono mode combines the transmitters upstream and cannot provide four independent software meters. DJI lists Windows Audacity as compatible; browser four-channel support remains to be verified on this hardware.

- https://www.dji.com/mic-3/faq
- https://dl.djicdn.com/downloads/DJI%20Mic%203/20250828/COMPATIBILITY_LIST/DJI_Mic_3_Quadraphonic_Computer_Software_Compatibility_List_EN.pdf

The Audio tile currently provides an explicitly labelled USB input check, not sent to YouTube yet. Select the device, grant permission, and speak into each transmitter separately. Only actual reported channels get meters. The diagnostic mono mix has mute and headroom, no speaker monitoring, and stops on device removal or teardown. Native Windows four-channel input and connection to the outgoing broadcast remain to implement.

## Cost and cleanup

Studio keeps sponsor image versions in its persistent SponsorAssets cache, bounded to 128 MB on disk and 32 MB in memory. Reopening Studio reuses the local copy; signed URL rotation does not download it again. Uploading a replacement creates a new object path and downloads the new version. Removed sponsors stop being served on the next authorized projection. This reduces image bandwidth, not cloud storage capacity. Full-game control polling remains a further egress improvement.

The retired M1 Supabase project raavodkuvcbbkddfpwet was deleted at John's request on September 9. Installed Studio uses hoogvyhuxevihttbutwl. The old local .env.local is archived under ignored work/retired-m1.env.local and its development listener was stopped. Active project credentials were unchanged. No SQL migration is needed: generation checks make old mic intent inert after release.
