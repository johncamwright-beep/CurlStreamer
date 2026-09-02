# Product requirements and milestones

The north star is a three-phone workflow with no shared network or production laptop. Portrait 9:16 capture is a product invariant, not responsive styling. Cameras publish video only; the scorer publishes audio only and controls auditable scoring, layout, broadcast, and sponsor state.

Milestones 1–3 provide the mock vertical slice. Milestones 4–8 add real LiveKit tracks, DJI diagnostics, private Supabase image processing, Web Egress, and server-side YouTube RTMP. Google OAuth and multi-organization broadcast automation remain future work. Device claims, real cross-network service, and cloud persistence are not represented as complete today.

Acceptance focuses on complete uncropped portrait frames, hammer/blank/Undo correctness, exclusive role assignment, resilient sponsor state, privacy mute, accessible mobile controls, and explicit degraded states.

Access setup uses a 30-minute invitation, exchanged on claim for a six-hour device session. This supports setup and four-plus-hour games without making public links permanent; closing the game revokes effective access. Atomic consumption and durable revocation move to Supabase.
