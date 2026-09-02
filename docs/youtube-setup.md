# YouTube RTMP pilot setup

Create a reusable stream in YouTube Studio, set it Unlisted by default, and place its RTMPS URL/key in server environment variables. Never paste the key into a browser field. LiveKit Web/RoomComposite Egress will render `/broadcast/:id` at 1920×1080 and send H.264/AAC output to that target.

The provider interface exists, but the pilot egress call is intentionally not implemented in Milestones 1–3. Before enabling it, add idempotency records, reconcile Egress status, redact provider errors, require stop confirmation, and test refused/dropped RTMP. Later OAuth should encrypt refresh tokens as described in security docs and create/bind/transition broadcasts through YouTube APIs.
