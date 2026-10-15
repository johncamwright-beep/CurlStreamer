type NumberedGame = { eventId: string | null; gameNumber: number | null };

/** Continue above the highest number saved for this event, including games
 * just created in this form before the server page is refreshed. */
export function nextEventGameNumber(
  eventId: string,
  games: readonly NumberedGame[],
  newlySaved: readonly string[] = [],
) {
  if (!eventId) return "";
  let highest = 0;
  for (const game of games) {
    if (
      game.eventId === eventId &&
      game.gameNumber !== null &&
      Number.isSafeInteger(game.gameNumber) &&
      game.gameNumber > highest
    )
      highest = game.gameNumber;
  }
  for (const saved of newlySaved) {
    if (!saved.startsWith(`${eventId}:`)) continue;
    const number = Number(saved.slice(eventId.length + 1));
    if (Number.isSafeInteger(number) && number > highest) highest = number;
  }
  return String(highest + 1);
}
