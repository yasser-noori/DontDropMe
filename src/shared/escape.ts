import { messageDuration } from './message-timing';
import { ZONES, type Vec } from './maze';
export const ESCAPE_COUNTDOWN = Math.ceil(messageDuration('game', escapeCountdownText(8)) / 1000);
export function escapeCountdownText(seconds: number) { return `Escape in ${seconds}… The impostor will follow the curved coins to Safe. Pinch thumb and index finger around them to catch them.`; }
export const ESCAPE_RUN_SECONDS = 10;
/** Feet positions along the same curved route used by the escape coins. */
export function escapePoint(progress: number): Vec {
  const t = Math.max(0, Math.min(1, progress)), u = 1 - t;
  const a = ZONES.DROP, b = { x: 510, y: 490 }, c = { x: 510, y: 185 }, d = ZONES.SAVE;
  return { x: u ** 3 * a.x + 3 * u ** 2 * t * b.x + 3 * u * t ** 2 * c.x + t ** 3 * d.x,
    y: u ** 3 * a.y + 3 * u ** 2 * t * b.y + 3 * u * t ** 2 * c.y + t ** 3 * d.y };
}
export type Pinch = { thumb: Vec; index: Vec; ratio: number };
export function pinchClosed(pinch: Pinch | undefined): pinch is Pinch {
  return !!pinch && Number.isFinite(pinch.ratio) && pinch.ratio >= 0 && pinch.ratio <= .5
    && [pinch.thumb?.x, pinch.thumb?.y, pinch.index?.x, pinch.index?.y].every(Number.isFinite)
    && Math.hypot(pinch.thumb.x - pinch.index.x, pinch.thumb.y - pinch.index.y) <= 64;
}
export function pinchTouches(pinch: Pinch | undefined, feet: Vec): boolean {
  if (!pinchClosed(pinch)) return false;
  return Math.hypot((pinch.thumb.x + pinch.index.x) / 2 - feet.x, (pinch.thumb.y + pinch.index.y) / 2 - (feet.y - 18)) <= 40;
}
