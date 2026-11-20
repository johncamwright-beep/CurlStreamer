/** Keep local watchdogs frequent without renewing a healthy cloud lease each tick.
 * Short/aging grants and failed renewals must retry rather than assume authority. */
export function cloudRenewalDue(elapsedMs: number, remainingMs: number) {
  return elapsedMs >= 15_000 || remainingMs <= 20_000;
}
