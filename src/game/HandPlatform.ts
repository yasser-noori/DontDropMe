import { moveConstrained } from '../shared/maze';
export type Point = { x: number; y: number };
export type TrackingState = 'tracked' | 'grace' | 'inactive';
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export function stepToward(from: Point, to: Point, max: number): Point {
  const dx = to.x - from.x, dy = to.y - from.y;
  const scale = Math.min(1, max / (Math.hypot(dx, dy) || 1));
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

/** Pure tracking filter; Phaser owns actual platform motion, below. Times are seconds. */
export class PalmFilter {
  raw: Point | null = null;
  target: Point = { x: 330, y: 365 };
  state: TrackingState = 'inactive';
  private lastSeen = -Infinity;
  private lastObservation = -Infinity;
  private initialized = false;
  observe(point: Point | null, now: number) {
    if (!point || !Number.isFinite(point.x + point.y)) { this.raw = null; return; }
    const bounded = { x: clamp(point.x, 70, 890), y: clamp(point.y, 100, 500) };
    // A discontinuous observation is approached, never copied onto an existing rider.
    const elapsed = clamp(now - this.lastObservation, 0.01, 0.1);
    this.raw = this.initialized ? stepToward(this.target, bounded, 1100 * elapsed) : bounded;
    if (!this.initialized) { this.target = { ...bounded }; this.initialized = true; }
    this.lastObservation = now;
    this.lastSeen = now;
    this.state = 'tracked';
  }
  update(now: number, dt: number) {
    this.state = now - this.lastSeen <= 0.12 && this.raw ? 'tracked' : now - this.lastSeen <= 0.35 ? 'grace' : 'inactive';
    if (this.state === 'tracked' && this.raw) {
      const alpha = 1 - Math.exp(-clamp(dt, 0, 0.05) / 0.075);
      this.target.x += (this.raw.x - this.target.x) * alpha;
      this.target.y += (this.raw.y - this.target.y) * alpha;
    }
  }
  reset() { this.raw = null; this.state = 'inactive'; this.lastSeen = -Infinity; this.lastObservation = -Infinity; }
  resume(now: number) {
    if (this.state !== 'inactive') { this.lastSeen = now; this.lastObservation = now; this.raw = null; this.state = 'grace'; }
  }
}

/** The only final platform position. Displacement is computed once per scene step. */
export class HandPlatform {
  readonly width = 144;
  readonly collisionWidth = 22;
  collisionOffset = 0;
  position: Point = { x: 330, y: 365 };
  delta: Point = { x: 0, y: 0 };
  state: TrackingState = 'inactive';
  maze = false;
  sanctuary = false;
  move(target: Point, state: TrackingState, dt: number) {
    this.state = state;
    let next = state === 'tracked' ? stepToward(this.position, target, 720 * clamp(dt, 0, 0.05)) : this.position;
    if (this.maze) {
      const offset = this.collisionOffset;
      const feet = moveConstrained({ x: this.position.x + offset, y: this.position.y }, { x: next.x + offset, y: next.y }, this.collisionWidth / 2, 36, 0, this.sanctuary);
      next = { x: feet.x - offset, y: feet.y };
    }
    this.delta.x = next.x - this.position.x;
    this.delta.y = next.y - this.position.y;
    this.position = next;
  }
  get active() { return this.state !== 'inactive'; }
}

export type RiderState = 'spawn' | 'boarding' | 'riding' | 'exiting' | 'falling' | 'rescued';
/** A short climb to a nearby platform, with no route through maze walls. */
export function canClimbAboard(feet: Point, paddle: HandPlatform) {
  if (!paddle.active || Math.abs(feet.x - paddle.position.x) > paddle.width / 2 + 20 || Math.abs(feet.y - paddle.position.y) > 34) return false;
  const target = { ...paddle.position };
  const reached = moveConstrained(feet, target, 12, 35, 0);
  return Math.hypot(reached.x - target.x, reached.y - target.y) < 1;
}
/** Absolute attachment avoids incremental offset drift and double displacement. */
export class RiderAttachment {
  offset = 0;
  attach(feet: Point, paddle: HandPlatform) { this.offset = clamp(feet.x - paddle.position.x, -52, 52); }
  feet(paddle: HandPlatform): Point { return { x: paddle.position.x + this.offset, y: paddle.position.y }; }
  walk(distance: number, paddle: HandPlatform) { this.offset += distance; return Math.abs(this.offset) <= paddle.width / 2; }
}

export function canTransfer(paddle: HandPlatform, edgeX: number, top: number, side: 'spawn' | 'exit') {
  if (!paddle.active || Math.abs(paddle.position.y - top) > 40) return false;
  const near = side === 'spawn' ? paddle.position.x - paddle.width / 2 - edgeX : edgeX - (paddle.position.x + paddle.width / 2);
  return near <= 32 && near >= -95;
}
