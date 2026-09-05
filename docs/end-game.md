# End Game lifecycle

End Game is a server-only review, completion, and cleanup workflow. The browser
submits a validated optional YouTube watch link, reviews the database-derived
score, and confirms that exact revision. A stale review returns a conflict and
must be reviewed again. The immutable result remains saved even when provider
cleanup fails.

After completion, CurlCast asks LiveKit to remove both stable camera identities
and delete the game room. `complete` cleanup means every request returned a
success or already-missing response; `failed` means shutdown was not confirmed
and can be retried. Calls have an eight-second timeout and never log provider
keys. DeleteRoom disconnects current room participants. LiveKit Cloud documents
token revocation for removed identities, but self-hosted deployments do not
guarantee that an already-issued token is revoked; CurlCast additionally denies
future issuance, performs a post-sign lifecycle check, and repeats teardown if
completion wins that race.

Completed public reads expose only event/team names, the immutable result, the
validated watch link, and completion time. Actor IDs, review/completion IDs,
claims, provider details, and deleted-game summaries are not exposed. Legacy
`closed` games remain distinct and do not acquire a completion result.
