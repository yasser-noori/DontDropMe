import { afterEach, describe, expect, it, vi } from 'vitest';
import { canClimbAboard, HandPlatform, RiderAttachment } from '../src/game/HandPlatform';

vi.mock('phaser', () => ({ default: { Scene: class {}, GameObjects: { Container: class {} } } }));
import { TrustScene } from '../src/game/TrustScene';

afterEach(() => vi.unstubAllGlobals());

function fallenScene() {
  vi.stubGlobal('document', { hidden: false });
  const scene = new TrustScene();
  const actor = {
    x: 440, y: 530, state: 'falling', rider: new RiderAttachment(),
    body: { blocked: { down: false }, touching: { down: false } },
    attach: vi.fn(), release: vi.fn(), animate: vi.fn(), setAngle: vi.fn(),
    setFeet(point: { x: number; y: number }) { this.x = point.x; this.y = point.y; },
  };
  scene.frank = actor as unknown as typeof scene.frank;
  scene.motion = 'falling';
  // Drawing is independent of motion; exercise the actual scene state machine.
  (scene as unknown as { draw: () => void }).draw = () => {};
  return { scene, actor };
}

describe('falling and nearby reboarding', () => {
  it('does not start a return route near the floor and waits where physics lands', () => {
    const { scene, actor } = fallenScene();
    scene.update(0, 16);
    expect(scene.motion).toBe('falling');
    expect(actor.attach).not.toHaveBeenCalled();
    actor.body.blocked.down = true;
    scene.update(16, 16);
    expect(scene.motion).toBe('grounded');
    for (let i = 0; i < 60; i++) scene.update(i * 16, 16);
    expect({ x: actor.x, y: actor.y }).toEqual({ x: 440, y: 530 });
    expect(scene.motion).toBe('grounded');
  });

  it('climbs onto a returned platform and falls again if it leaves reach', () => {
    const { scene, actor } = fallenScene();
    actor.body.touching.down = true;
    scene.update(0, 16);
    scene.paddle.position = { x: 440, y: 500 };
    scene.setMode('mouse');
    (scene as unknown as { pointer: { x: number; y: number } }).pointer = { x: 440, y: 500 };
    scene.update(16, 16);
    expect(scene.motion).toBe('boarding');
    for (let i = 0; i < 20; i++) scene.update(32 + i * 16, 16);
    expect(scene.motion).toBe('riding');
    expect(actor.y).toBe(500);
    scene.motion = 'boarding';
    scene.paddle.position = { x: 700, y: 300 };
    scene.update(400, 16);
    expect(scene.motion).toBe('falling');
    expect(actor.release).toHaveBeenCalled();
  });

  it('requires a nearby active platform and allows climbing across former walls', () => {
    const paddle = new HandPlatform(); paddle.position = { x: 440, y: 500 };
    expect(canClimbAboard({ x: 440, y: 530 }, paddle)).toBe(false);
    paddle.state = 'tracked';
    expect(canClimbAboard({ x: 440, y: 530 }, paddle)).toBe(true);
    expect(canClimbAboard({ x: 340, y: 530 }, paddle)).toBe(false);
    expect(canClimbAboard({ x: 440, y: 460 }, paddle)).toBe(false);
    paddle.position = { x: 365, y: 250 };
    expect(canClimbAboard({ x: 280, y: 250 }, paddle)).toBe(true);
  });
});
