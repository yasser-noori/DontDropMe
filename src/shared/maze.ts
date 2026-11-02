export type Vec = { x: number; y: number };
export type Rect = Vec & { w: number; h: number };
export const WALLS: Rect[] = [{ x: 300, y: 75, w: 24, h: 245 }, { x: 550, y: 295, w: 24, h: 245 }];
export const SANCTUARY: Rect = { x: 760, y: 75, w: 185, h: 105 };
export const ENTRANCE = { x: 125, y: 420 };
export const ZONES = { WAIT: { x: 800, y: 240 }, SAVE: { x: 800, y: 345 }, DROP: { x: 800, y: 450 } };
export type Zone = keyof typeof ZONES;
export function overlaps(p: Vec, halfX: number, above: number, below: number, r: Rect) {
  return p.x + halfX > r.x && p.x - halfX < r.x + r.w && p.y + below > r.y && p.y - above < r.y + r.h;
}
/** Small deterministic steps plus axis sliding, including the carried character envelope. */
export function moveConstrained(from: Vec, target: Vec, halfX = 72, above = 38, below = 10, sanctuary = false): Vec {
  const obstacles = sanctuary ? [...WALLS, SANCTUARY] : WALLS;
  const dx = target.x - from.x, dy = target.y - from.y;
  const count = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 3));
  const p = { ...from };
  const valid = (v: Vec) => v.x >= halfX && v.x <= 960 - halfX && v.y >= 75 + above && v.y <= 530 - below && !obstacles.some(r => overlaps(v, halfX, above, below, r));
  for (let i = 0; i < count; i++) {
    const horizontal = { x: p.x + dx / count, y: p.y };
    if (valid(horizontal)) p.x = horizontal.x;
    const vertical = { x: p.x, y: p.y + dy / count };
    if (valid(vertical)) p.y = vertical.y;
  }
  return p;
}
export function near(a: Vec, b: Vec, distance: number) { return Math.hypot(a.x - b.x, a.y - b.y) <= distance; }
