# Studio session flow

User direction, September 9, 2026: opening a game prepares Studio; phones connect
without starting a local recording. The operator scores and checks the cameras,
then chooses Go live. End game stops the broadcast and removes temporary local
video automatically. Start recording and Saved videos are not part of the normal
product interface. Existing recordings are outside this cleanup change.

## Implementation boundary

The current preview starts its receiver, renderer and recorder together. Removing
the buttons alone would prevent phones from connecting. Separate receiver lifetime
from broadcast output before changing the controls:

1. Selecting a game prepares one game-scoped receiver session in Studio. Display
   readiness and camera assignment/release controls beside scoring and QR codes.
2. Connecting a phone captures its camera for preview and sends it to the PC;
   it does not save a video or publish a broadcast. The phone retains a clear
   connected indicator, Disconnect and hardware zoom where supported.
3. Go live starts the encoder and YouTube delivery in the background. Confirm
   actual delivery before displaying Live. Any required local files are temporary.
4. Stopping a broadcast leaves the game and cameras ready to resume. Ending the
   game stops delivery, closes camera sessions, finalizes the game and removes only
   that session's temporary video after the output process has confirmed shutdown.
5. After a crash, reconcile output state and clean up owned temporary files on the
   next launch. Never delete existing user recordings or files outside the managed
   session directory. Keep scores, schedule, sponsors and any YouTube replay.

The operator should see progress and actionable failures, not private source links,
signaling terminology, file paths or routine cleanup controls. Remote scoring stays
available from a phone or tablet on the same game.

## Current connection repair

Live Supabase logs showed hundreds of thousands of SQLSTATE 40001 conflicts per
hour from write_game_state, and the dashboard reported 100% CPU. Supabase documents
an endless PostgREST retry loop for application exceptions using that code:
https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b

Migration 0032 changes only the application conflict codes to PT409 in six affected
functions. All revision, locking, completion and assignment checks remain. Server
callers accept PT409 and the legacy code during rollout. The live repair applied
the same exact code replacement to the six existing function definitions, retaining
their ownership and grants; all six verified PT409 with no remaining 40001 clause.
This removes the identified retry trigger. Physical phone reconnection still needs
verification; the new receiver/broadcast lifetime is not implemented yet.
