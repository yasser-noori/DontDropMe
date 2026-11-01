import { describe, expect, it } from 'vitest';
import { HandPlatform, PalmFilter, RiderAttachment } from '../src/game/HandPlatform';
import { mapVideoPoint } from '../src/tracking/HandTracker';

describe('hand tracking resilience', () => {
  it('holds the last position during grace then deactivates after 350 ms', () => {
    const filter = new PalmFilter(), paddle = new HandPlatform();
    filter.observe({ x: 300, y: 360 }, 1); filter.update(1, 1 / 60);
    expect(filter.state).toBe('tracked');
    filter.observe(null, 1.04); filter.update(1.04, 1 / 60);
    expect(filter.state).toBe('grace');
    paddle.position = { ...filter.target }; const held = { ...paddle.position };
    filter.update(1.3, .016); paddle.move(filter.target, filter.state, .016);
    expect(paddle.active).toBe(true); expect(paddle.position).toEqual(held);
    filter.update(1.351, .016); paddle.move(filter.target, filter.state, .016);
    expect(filter.state).toBe('inactive'); expect(paddle.active).toBe(false);
  });
  it('bounds extreme reacquisition movement so an attached rider cannot teleport', () => {
    const filter = new PalmFilter(), paddle = new HandPlatform(), rider = new RiderAttachment();
    filter.observe({ x: 300, y: 350 }, 1); paddle.position = { ...filter.target }; rider.attach({ x: 310, y: 350 }, paddle);
    filter.observe(null, 1.1); filter.update(1.2, .016);
    const before = rider.feet(paddle);
    filter.observe({ x: 900, y: 100 }, 1.25); filter.update(1.25, 1 / 60); paddle.move(filter.target, filter.state, 1 / 60);
    const after = rider.feet(paddle);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThanOrEqual(12.001);
    expect(after.x - paddle.position.x).toBeCloseTo(10);
    // A long suspended tab still cannot produce a huge final movement.
    paddle.move({ x: 900, y: 100 }, 'tracked', 30);
    expect(Math.hypot(paddle.delta.x, paddle.delta.y)).toBeLessThanOrEqual(36.001);
  });
  it('maps mirrored normalized coordinates into the contained video rectangle', () => {
    expect(mapVideoPoint(0, 0, 640, 480)).toEqual({ x: 840, y: 0 });
    expect(mapVideoPoint(1, 1, 640, 480)).toEqual({ x: 120, y: 540 });
    expect(mapVideoPoint(.25, .5, 1280, 720)).toEqual({ x: 720, y: 270 });
    expect(mapVideoPoint(.5, .5, 480, 640)).toEqual({ x: 480, y: 270 });
  });
});
