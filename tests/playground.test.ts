import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { HandPlatform } from '../src/game/HandPlatform';
import { Playground } from '../src/game/Playground';
import { FLOATING_PLATFORMS } from '../src/shared/maze';

// Exercise renderer / coin lifecycle; real body contacts run in toy-physics.test.ts.
function harness() {
  const calls = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
  const graphics = new Proxy({}, { get: (_target, name) => {
    if (!calls.has(name)) calls.set(name, vi.fn(() => graphics));
    return calls.get(name);
  } });
  const sprites: ReturnType<typeof sprite>[] = [];
  function sprite(x: number, y: number) {
    const object = {
      x, y, visible: true, angle: 0, alpha: 1,
      setDepth() { return this; },
      setVisible(value: boolean) { this.visible = value; return this; }, setAlpha(value: number) { this.alpha = value; return this; },
      setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }, setRotation(angle: number) { this.angle = angle; return this; },
    };
    return object;
  }
  const scene = { events: { once: vi.fn() }, make: { graphics: () => graphics }, add: { graphics: () => graphics, image: (x: number, y: number) => { const s = sprite(x, y); sprites.push(s); return s; } } };
  const playground = new Playground(scene as unknown as Phaser.Scene);
  return { playground, sprites, calls };
}

describe('breakable playground', () => {
  it('renders all three stacks and preserves their reset positions', () => {
    const { playground, sprites } = harness();
    const hand = new HandPlatform(); hand.position = { x: 70, y: 300 };
    playground.update(.016, hand, false);
    expect(sprites).toHaveLength(16);
    expect(sprites.every(s => s.visible && s.alpha === 1 && s.angle === 0)).toBe(true);
    expect(hand.position).toEqual({ x: 70, y: 300 });
  });
  it('keeps destruction during a turn and rebuilds balls and towers on the next turn', () => {
    const { playground, sprites } = harness();
    const hand = new HandPlatform();
    playground.reset('1:alice');
    let feet = { x: FLOATING_PLATFORMS[2].x - 20, y: FLOATING_PLATFORMS[2].y - 5 };
    for (let i = 0; i < 45; i++) feet = playground.update(1 / 60, hand, true, { x: feet.x + 4, y: feet.y }, feet);
    const positions = sprites.map(s => s.x);
    playground.reset('1:alice');
    expect(sprites.map(s => s.x)).toEqual(positions);
    for (let i = 0; i < 8 * 60; i++) playground.update(1 / 60, hand, false);
    expect(sprites.slice(10).every(s => !s.visible)).toBe(true);
    playground.reset('1:bob');
    expect(sprites.every(s => s.visible && s.alpha === 1 && s.angle === 0)).toBe(true);
  });
  it('collects coins once, holds them collected, and refills them for the next player', () => {
    const { playground, calls } = harness();
    const hand = new HandPlatform(); hand.position = { x: FLOATING_PLATFORMS[0].x + FLOATING_PLATFORMS[0].w / 2, y: FLOATING_PLATFORMS[0].y - 45 + 18 };
    playground.reset('1:alice');
    const sparkles = calls.get('strokeCircle')!; sparkles.mockClear();
    playground.update(.016, hand, false);
    expect(sparkles).not.toHaveBeenCalled();
    playground.update(.016, hand, true);
    expect(sparkles).toHaveBeenCalled();
    sparkles.mockClear(); playground.update(.5, hand, true);
    playground.reset('1:alice'); playground.update(.016, hand, true);
    expect(sparkles).not.toHaveBeenCalled();
    playground.reset('1:bob'); playground.update(.016, hand, true);
    expect(sparkles).toHaveBeenCalled();
  });
});
