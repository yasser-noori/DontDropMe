/** Each viewing surface unlocks an entrance only when its intro card is shown. */
const shown = new Set<string>();
export function introductionShown(round: number, playerId: string) { return shown.has(`${round}:${playerId}`); }
export function markIntroductionShown(round: number, playerId: string) {
  shown.add(`${round}:${playerId}`);
  if (shown.size > 100) shown.delete(shown.values().next().value!);
}
