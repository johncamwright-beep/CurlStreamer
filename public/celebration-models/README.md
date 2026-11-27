# Locally hosted celebration photo preparation

The browser loads these version-pinned models and MediaPipe Tasks Vision 0.10.32 WASM from this origin. No photograph is sent to Google or another AI service. Only a coach-approved 512 px alpha PNG is uploaded to CurlCast.

- Selfie multiclass segmentation, float32 version 1: https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite
- BlazeFace short-range detection, float16 version 1: https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite
- Runtime files copied without modification from `@mediapipe/tasks-vision@0.10.32/wasm`.

Google MediaPipe and models are Apache-2.0 licensed (see LICENSE). Model cards:
https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf
https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf

Official API guides:
https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter/web_js
https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector/web_js

Segmentation isolates hair, face skin, and accessories. These are approximate masks, not identity recognition. Preparation requires one detected face and a usable mask. Unsupported browsers, missing models, multiple faces, and failed extraction expose an explicitly labeled adjustable manual oval crop. The user must review either result.

## Storage and rollout

Apply `supabase/migrations/0090_celebration_headshots.sql` before using setup. It adds a service-role-only metadata table and private PNG storage bucket. List and trigger responses sign cutouts for five minutes; trigger resolution always refreshes the selected player's signature. Coach writes require same-origin requests and owner/team-admin access to the game's own organization. Roster IDs retain the existing charting algorithm; headshots get separate UUIDs and are never matched by position alone.

Replacing or removing a cutout unlinks it from future cues. Immutable objects have a one-hour grace period so active cues can finish. Each save/removal opportunistically prunes up to 1,000 old, unreferenced objects in the authenticated organization. Inactive organizations retain obsolete objects until their next photo write; a scheduled cleanup can call the same scoped pruning helper if immediate unattended reclamation is needed. No original photos are retained.

Renaming or repositioning a roster player creates a different existing charting identity. Their old photo is not assigned automatically to anyone in the new roster: upload/relink a reviewed photo for the current player again. This favors safe assignment over guessing from a position or similar name.

## Coach identity and private seed contract

A team administrator may add one coach name and approved photo alongside the current four-player roster. The coach gets a stable organization-derived celebration identity; changing the coach name never changes curling roster/charting IDs. Remove photo unlinks the coach from future selection until a new coach photo is added. Playing the clip requires a saved photo for the selected person.

For a private preparation/import manifest, use `{ "people": [{ "kind": "roster", "playerName": "...", "position": "Lead", "preparedPng": "<private absolute path>" }, { "kind": "coach", "playerName": "...", "preparedPng": "<private absolute path>" }] }`. Resolve roster IDs from the authorized target organization's current roster at import time; derive the coach ID on the server. Keep this manifest and personal cutouts outside tracked/public assets. The manifest does not itself authorize importing or deploying data.
