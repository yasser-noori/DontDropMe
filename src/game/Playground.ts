import type Phaser from 'phaser';
import { FLOATING_PLATFORMS, ZONES, type Vec } from '../shared/maze';
import type { HandPlatform } from './HandPlatform';
import { ToyPhysics, type ToyPiece } from './ToyPhysics';

type Piece = { sprite: Phaser.GameObjects.Image; toy: ToyPiece };
type Coin = Vec & { collectedAt?: number };

/** Rotating rigid bodies push back on the rider; coins share the same turn lifecycle. */
export class Playground {
  private pieces: Piece[] = [];
  private physics = new ToyPhysics();
  private coins: Coin[] = [];
  private art: Phaser.GameObjects.Graphics;
  private clock = 0;
  private turn = '';
  constructor(scene: Phaser.Scene) {
    const pen = scene.make.graphics({ x: 0, y: 0 });
    for (const [key, color] of [['block', 0x9c8ce5], ['triangle', 0xf4ad72], ['ball', 0x77c9b1]] as const) {
      pen.clear().fillStyle(color).lineStyle(2, 0xffffff, .65);
      if (key === 'ball') pen.fillCircle(12, 12, 11).strokeCircle(12, 12, 10);
      else if (key === 'triangle') pen.fillTriangle(12, 1, 23, 23, 1, 23).strokeTriangle(12, 1, 23, 23, 1, 23);
      else pen.fillRoundedRect(0, 2, 36, 20, 4).strokeRoundedRect(1, 3, 34, 18, 4);
      pen.generateTexture(`toy-${key}`, key === 'block' ? 36 : 24, 24);
    }
    pen.destroy();
    this.pieces = this.physics.pieces.map(toy => ({ toy, sprite: scene.add.image(toy.start.x, toy.start.y, `toy-${toy.kind}`).setDepth(4) }));
    this.art = scene.add.graphics().setDepth(3);
    scene.events.once('shutdown', () => this.physics.destroy());
    this.reset('preview');
  }
  reset(turn: string) {
    if (this.turn === turn) return;
    this.turn = turn; this.clock = 0; this.physics.reset();
    this.renderPieces();
    // A smooth shared trail visits each toy, then forks toward the two caves.
    const [squares, pyramid, balls] = FLOATING_PLATFORMS.map(p => ({ x: p.x + p.w / 2, y: p.y - 45 }));
    this.coins = [];
    const coinSpacing = 34;
    const addTrail = (segments: Vec[][], branch = false) => {
      const points: Vec[] = [];
      for (const [a, b, c, d] of segments) for (let i = points.length ? 1 : 0; i <= 120; i++) {
        const t = i / 120, u = 1 - t;
        points.push({ x: u ** 3 * a.x + 3 * u ** 2 * t * b.x + 3 * u * t ** 2 * c.x + t ** 3 * d.x,
          y: u ** 3 * a.y + 3 * u ** 2 * t * b.y + 3 * u * t ** 2 * c.y + t ** 3 * d.y });
      }
      let remaining = coinSpacing;
      if (!branch) this.coins.push({ ...points[0] });
      for (let i = 1; i < points.length; i++) {
        let from = points[i - 1]; const to = points[i];
        let distance = Math.hypot(to.x - from.x, to.y - from.y);
        while (distance >= remaining) {
          const ratio = remaining / distance;
          from = { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
          this.coins.push({ ...from }); distance -= remaining; remaining = coinSpacing;
        }
        remaining -= distance;
      }
      const end = points[points.length - 1], last = this.coins[this.coins.length - 1];
      if (Math.hypot(end.x - last.x, end.y - last.y) > coinSpacing / 2) this.coins.push({ ...end });
      else Object.assign(last, end);
    };
    addTrail([
      [squares, { x: squares.x + 95, y: squares.y }, { x: pyramid.x - 100, y: pyramid.y }, pyramid],
      [pyramid, { x: pyramid.x + 100, y: pyramid.y }, { x: balls.x - 90, y: balls.y }, balls],
    ]);
    for (const zone of ['SAVE', 'DROP'] as const) {
      const cave = { x: ZONES[zone].x, y: ZONES[zone].y - 18 };
      addTrail([[balls, { x: balls.x + 65, y: balls.y }, { x: cave.x - 45, y: cave.y }, cave]], true);
    }

  }
  private renderPieces() {
    for (const { sprite, toy } of this.pieces) {
      const { x, y } = toy.body.position, angle = toy.body.angle;
      const offset = toy.kind === 'triangle' ? -3.67 : 0;
      sprite.setPosition(x - Math.sin(angle) * offset, y + Math.cos(angle) * offset).setRotation(angle).setVisible(!toy.removed).setAlpha(this.physics.alpha(toy));
    }
  }
  update(dt: number, paddle: HandPlatform, active: boolean, actor: Vec = paddle.position, previous: Vec = actor, escape = false) {
    const corrected = this.physics.step(dt, previous, actor, active);
    this.renderPieces();
    this.clock += dt;
    const g = this.art.clear();
    if (escape) return corrected;
    let count = 0;
    for (const coin of this.coins) {
      if (active && coin.collectedAt === undefined && Math.abs(coin.x - corrected.x) < 19 && Math.abs(coin.y - (corrected.y - 18)) < 27) coin.collectedAt = this.clock;
      if (coin.collectedAt !== undefined) {
        count++;
        const age = this.clock - coin.collectedAt;
        if (age < .4) {
          g.lineStyle(2, 0xffd76c, 1 - age / .4).strokeCircle(coin.x, coin.y - age * 30, 8 + age * 22);
          for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.fillStyle(0xffdc73, 1 - age / .4).fillCircle(coin.x + Math.cos(a) * age * 45, coin.y + Math.sin(a) * age * 45, 2); }
        }
      } else {
        const width = 4 + Math.abs(Math.cos(this.clock * 2.5 + coin.x)) * 8;
        g.fillStyle(0xffd66b, .14).fillCircle(coin.x, coin.y, 11);
        g.fillStyle(0xe4a536).fillEllipse(coin.x, coin.y + 1, width + 2, 15);
        g.fillStyle(0xffdf79).fillEllipse(coin.x, coin.y, width, 13);
        g.lineStyle(1, 0xfff5c2, .9).lineBetween(coin.x, coin.y - 3, coin.x, coin.y + 3);
      }
    }
    // A small in-scene counter is cosmetic and starts fresh with the next turn.
    g.fillStyle(0xffd66b).fillCircle(683, 60, 4);
    g.lineStyle(3, 0xe4a536, .65).lineBetween(695, 60, 695 + count / this.coins.length * 45, 60);
    return corrected;
  }
}
