# Game polling

Game-state reads use an adaptive cadence in `GameSync`:

- Visible active games: one second between ordinary polls.
- Hidden ordinary pages: 15 seconds; returning to the page requests a refresh.
- Completed, closed and deleted games: 30 seconds, retaining eventual deletion/access updates.
- Failed reads: ten seconds, with existing manual retry controls retained.
- Camera and Broadcast receivers: independent active polls continue even in the background, so a stalled older response cannot block an authoritative terminal response.

Ordinary timer-driven reads are sequential. Each game fetch has a ten-second timeout. Initial navigation enrichment remains independent of routine state reads, preserving recovery when metadata is slow. User actions and cross-tab updates continue to refresh state. The existing revision/lifecycle gates and server authorization are unchanged.

This change reduces background and post-game request volume; it does not claim a measured reduction in total Supabase usage. The camera zoom panel intentionally retains its separately authorized read. Device heartbeats and media transport are unchanged. Use Supabase request logs to measure the traffic breakdown before further changes.
