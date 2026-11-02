/** One reading pace for every narration card, on both client and server. */
export const NARRATION_WPM = 180;
export function narrationText(text: string) {
  return text.replace(/\bSAVE\b/g, 'the Safe cave').replace(/\bDROP\b/g, 'the Impostor cave').replace(/good[- ]cave/gi, 'Safe cave');
}
export function messageDuration(_type: string, text: string) {
  const spoken = narrationText(text);
  const words = spoken.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length || 0;
  const sentences = spoken.match(/[.!?…]+(?=\s|$|[”"’])/gu)?.length || 0;
  const clauses = spoken.match(/[,;:—–]/gu)?.length || 0;
  // A short settling beat, natural punctuation pauses, and a small-card floor.
  // No upper cap: long paragraphs retain the same words-per-minute pace.
  return Math.ceil(Math.max(2400, 750 + words * 60000 / NARRATION_WPM + sentences * 220 + clauses * 120) / 100) * 100;
}

export function continuationText(nextRound: number) {
  return `Impostor is still present. Round ${nextRound} starts with a new word. Everyone in the Safe cave returns to the queue.`;
}
