# Coach companion — bookmarked for later

Requested by John, September 9, 2026. Backlog only; audio remains the active priority.

Coach joins the selected game on an iPad using a dedicated QR invitation. Provide shot tracking, private notes, and fast live review markers. Coach access must not grant camera, scoring, or stream-control authority.

Suggested first workflow: tap **Mark moment**, with a default look-back of 30 seconds and choices including 60 seconds/custom duration. Save the marker immediately; allow notes and player/shot/end tags afterward. Optional explicit start/end marking can follow. Preserve markers with the completed game and its YouTube replay. Selecting a marker later starts playback at the beginning of that review window.

These are replay references, not downloaded video clips. Separate clip export is a later feature. YouTube's IFrame API supports seeking and bounded playback with startSeconds/endSeconds: https://developers.google.com/youtube/iframe_api_reference

Before implementation, establish a reliable mapping from rink-time markers to the broadcast/video timeline. Store server time, broadcast ID/session, stream start and reconnect segments, look-back duration, and any coach calibration. Do not assume YouTube delay is constant or that a restarted broadcast has the same video ID. Handle offline notes, duplicate taps, and replay unavailable/private/processing states without losing notes. Review marker positions after archiving before claiming precise synchronization.

Decisions for later: shot tracking fields, shared versus coach-private notes, default look-back, marker edit/delete, and coach access duration. No new coach UI or database schema is part of the current audio update.
