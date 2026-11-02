import { markIntroductionShown } from '../src/character-introductions';
import { afterEach, expect, it, vi } from 'vitest';
import { escapePoint, pinchTouches } from '../src/shared/escape';
import { ZONES } from '../src/shared/maze';
import type { PublicState } from '../src/shared/protocol';
vi.mock('phaser', () => ({ default: { Scene: class {}, GameObjects: { Container: class {} } } }));
import { TrustScene } from '../src/game/TrustScene';
afterEach(() => vi.unstubAllGlobals());

it('curves left between the Impostor and Safe caves while staying in the playfield', () => {
  expect(escapePoint(0)).toEqual(ZONES.DROP); expect(escapePoint(1)).toEqual(ZONES.SAVE);
  expect(escapePoint(.5).x).toBeLessThan(ZONES.DROP.x - 200);
  let previous = escapePoint(0);
  for (let i = 1; i <= 100; i++) {
    const point = escapePoint(i / 100);
    expect(point.y).toBeLessThan(previous.y); expect(point.x).toBeGreaterThan(0); expect(point.x).toBeLessThan(960);
    previous = point;
  }
});
it('requires a closed pinch around the body, rejecting open, distant and malformed fingers', () => {
  const feet = { x: 600, y: 300 }, pinch = { thumb: { x: 594, y: 282 }, index: { x: 606, y: 282 }, ratio: .2 };
  expect(pinchTouches(pinch, feet)).toBe(true);
  expect(pinchTouches(undefined, feet)).toBe(false);
  expect(pinchTouches({ ...pinch, ratio: .8 }, feet)).toBe(false);
  expect(pinchTouches(pinch, { x: 700, y: 300 })).toBe(false);
  expect(pinchTouches({ ...pinch, thumb: { x: NaN, y: 282 } }, feet)).toBe(false);
  expect(pinchTouches({ ...pinch, index: undefined } as unknown as typeof pinch, feet)).toBe(false);
});
it('moves along the curve automatically, holds still during countdown, and needs a pinch to request capture', async () => {
  vi.stubGlobal('document', { hidden: false });
  const scene = new TrustScene();
  const actor = { ...ZONES.DROP, id: 'suspect', state: 'falling', rider: { attach: vi.fn() }, animate: vi.fn(), setAngle: vi.fn(), setFeet(p: {x: number; y: number}) { this.x = p.x; this.y = p.y; } };
  scene.frank = actor as unknown as typeof scene.frank; scene.motion = 'escape'; scene.setMode('mouse');
  (scene as unknown as { draw: () => void }).draw = () => {};
  const state = { phase: 'ESCAPE', escape: 'starting', escapeProgress: 0, current: 'suspect', players: [], paused: false, hostConnected: true } as unknown as PublicState;
  markIntroductionShown(state.round, state.current!);
  scene.state = state; scene.onAction = vi.fn(async () => false);
  for (let i = 0; i < 30; i++) scene.update(i * 16, 16);
  expect({ x: actor.x, y: actor.y }).toEqual(ZONES.DROP);
  state.escape = 'active';
  for (let i = 0; i <= 300; i++) { state.escapeProgress = i / 600; scene.update(i * 16, 16); }
  expect(actor.x).toBeCloseTo(escapePoint(.5).x, 0);
  expect(actor.y).toBeCloseTo(escapePoint(.5).y, 0);
  expect(scene.onAction).not.toHaveBeenCalled();
  scene.setMode('camera');
  for (let i = 0; i < 45; i++) {
    scene.observe({ x: actor.x, y: actor.y });
    scene.observePinch({ thumb: { x: actor.x - 5, y: actor.y - 18 }, index: { x: actor.x + 5, y: actor.y - 18 }, ratio: .2 });
    const held = { x: actor.x, y: actor.y };
    scene.update(i * 16, 16);
    expect({ x: actor.x, y: actor.y }).toEqual(held);
  }
  expect(scene.onAction).toHaveBeenCalledWith('capture', { player: 'suspect' });
  await Promise.resolve();
});

it('holds the character at the fingertip midpoint and finishes only after returning to the Impostor cave', () => {
  vi.stubGlobal('document', { hidden: false });
  const scene = new TrustScene();
  const actor = { x: 500, y: 300, id: 'suspect', animate: vi.fn(), setAngle: vi.fn(), setFeet(p: { x: number; y: number }) { this.x = p.x; this.y = p.y; } };
  scene.frank = actor as unknown as typeof scene.frank; scene.motion = 'captured'; scene.setMode('camera');
  (scene as unknown as { draw: () => void }).draw = () => {};
  scene.state = { phase: 'ESCAPE', escape: 'captured', current: 'suspect', players: [] } as unknown as PublicState;
  scene.onAction = vi.fn(async () => false);
  scene.observe({ x: 250, y: 350 });
  scene.observePinch({ thumb: { x: 610, y: 300 }, index: { x: 630, y: 300 }, ratio: .2 });
  scene.update(0, 16);
  expect({ x: actor.x, y: actor.y }).toEqual({ x: 620, y: 318 });
  expect(scene.onAction).not.toHaveBeenCalled();
  scene.observePinch({ thumb: { x: ZONES.DROP.x - 5, y: ZONES.DROP.y - 18 }, index: { x: ZONES.DROP.x + 5, y: ZONES.DROP.y - 18 }, ratio: .2 });
  for (let i = 0; i < 50; i++) scene.update(i * 16, 16);
  expect(scene.onAction).toHaveBeenCalledWith('returnCaptured', { player: 'suspect' });
});

it('accepts a slightly relaxed pinch near the body but still rejects an open hand', () => {
  const feet = { x: 600, y: 300 };
  const pinch = { thumb: { x: 575, y: 282 }, index: { x: 625, y: 282 }, ratio: .45 };
  expect(pinchTouches(pinch, feet)).toBe(true);
  expect(pinchTouches({ ...pinch, ratio: .8 }, feet)).toBe(false);
});
