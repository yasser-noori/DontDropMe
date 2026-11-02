import { describe, expect, it } from 'vitest';
import { ToyPhysics } from '../src/game/ToyPhysics';
import { FLOATING_PLATFORMS } from '../src/shared/maze';

function push(world: ToyPhysics, tower: number, direction = 1, speed = 240, fps = 60) {
  const platform = FLOATING_PLATFORMS[tower];
  let feet = { x: platform.x + platform.w / 2 - direction * 70, y: platform.y - 5 };
  let lag = 0;
  for (let i = 0; i < fps * .8; i++) {
    const target = { x: feet.x + direction * speed / fps, y: feet.y };
    const reached = world.step(1 / fps, feet, target, true);
    lag += direction * (target.x - reached.x); feet = reached;
  }
  return { feet, lag };
}

describe('toy rigid-body contacts', () => {
  it.each([0, 1, 2])('topples tower %i with contact resistance and leaves other stacks intact', tower => {
    const world = new ToyPhysics();
    const { lag } = push(world, tower);
    const pieces = world.pieces.filter(p => p.tower === tower);
    expect(lag).toBeGreaterThan(15);
    expect(pieces.every(p => !p.body.isStatic)).toBe(true);
    expect(pieces.some(p => Math.abs(p.body.angle) > .12)).toBe(true);
    expect(world.pieces.filter(p => p.tower !== tower).every(p => p.body.isStatic && p.body.position.x === p.start.x)).toBe(true);
    for (const p of pieces) {
      expect(Math.abs(p.body.velocity.x)).toBeLessThanOrEqual(4.201);
      expect(Math.abs(p.body.angularVelocity)).toBeLessThanOrEqual(.111);
    }
    world.destroy();
  });

  it('responds from either side and releases on a downward hit', () => {
    for (const direction of [-1, 1]) {
      const world = new ToyPhysics();
      expect(push(world, 0, direction).lag).toBeGreaterThan(3);
      expect(world.pieces.slice(0, 4).some(p => direction * (p.body.position.x - p.start.x) > 10)).toBe(true);
      world.destroy();
    }
    const world = new ToyPhysics(), top = world.pieces[3].start;
    let feet = { x: top.x + 8, y: top.y - 45 };
    let lag = 0;
    for (let i = 0; i < 35; i++) {
      const target = { x: feet.x, y: feet.y + 3 };
      const reached = world.step(1 / 60, feet, target, true);
      lag += target.y - reached.y; feet = reached;
    }
    expect(lag).toBeGreaterThan(2);
    expect(world.pieces.slice(0, 4).every(p => !p.body.isStatic)).toBe(true);
  });

  it('limits fast swipes, freezes at zero dt, and restores collisions after a turn reset', () => {
    const world = new ToyPhysics(); push(world, 2, 1, 720);
    const before = world.pieces.map(p => ({ ...p.body.position }));
    world.step(0, { x: 0, y: 0 }, { x: 900, y: 100 }, true);
    expect(world.pieces.map(p => p.body.position)).toEqual(before);
    for (let i = 0; i < 8 * 60; i++) world.step(1 / 60, { x: 0, y: 0 }, { x: 0, y: 0 }, false);
    expect(world.pieces.filter(p => p.tower === 2).every(p => p.removed)).toBe(true);
    world.reset();
    expect(world.pieces.every(p => !p.removed && p.body.isStatic && p.body.angle === 0 && world.alpha(p) === 1)).toBe(true);
    expect(push(world, 2).lag).toBeGreaterThan(3);
  });

  it('preserves free movement and keeps contact behavior consistent at 30, 60 and 120 fps', () => {
    const outcomes = [30, 60, 120].map(fps => {
      const world = new ToyPhysics();
      const free = world.step(1 / fps, { x: 70, y: 300 }, { x: 70 + 240 / fps, y: 300 }, true);
      expect(free.x).toBeCloseTo(70 + 240 / fps, 1);
      expect(free.y).toBeCloseTo(300, 1);
      return push(world, 0, 1, 240, fps).lag;
    });
    expect(Math.max(...outcomes) - Math.min(...outcomes)).toBeLessThan(15);
  });
});
