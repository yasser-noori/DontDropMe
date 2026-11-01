import { describe, expect, it } from 'vitest';
import { HandPlatform, RiderAttachment, canTransfer } from '../src/game/HandPlatform';

describe('rider attachment', () => {
  it('follows a platform in both axes without accumulating offset over 10 seconds', () => {
    const paddle = new HandPlatform(), rider = new RiderAttachment();
    rider.attach({ x: paddle.position.x + 17, y: paddle.position.y }, paddle);
    for (let i = 0; i < 600; i++) {
      paddle.move({ x: 400 + Math.sin(i / 40) * 210, y: 290 + Math.cos(i / 35) * 100 }, 'tracked', 1 / 60);
      const feet = rider.feet(paddle);
      expect(feet.x - paddle.position.x).toBeCloseTo(17, 10);
      expect(feet.y).toBe(paddle.position.y);
    }
    expect(rider.walk(1000, paddle)).toBe(false);
  });
  it('permits forgiving transfers only near the correct edge and height', () => {
    const paddle = new HandPlatform(); paddle.state = 'tracked'; paddle.position = { x: 350, y: 385 };
    expect(canTransfer(paddle, 260, 366, 'spawn')).toBe(true);
    expect(canTransfer(paddle, 710, 320, 'exit')).toBe(false);
    paddle.position = { x: 630, y: 325 };
    expect(canTransfer(paddle, 710, 320, 'exit')).toBe(true);
    paddle.state = 'inactive'; expect(canTransfer(paddle, 710, 320, 'exit')).toBe(false);
  });
});
