import Phaser from 'phaser';
import { RiderAttachment, type Point, type RiderState } from './HandPlatform';

export class Character extends Phaser.GameObjects.Container {
  declare body: Phaser.Physics.Arcade.Body;
  state: RiderState = 'spawn';
  readonly rider = new RiderAttachment();
  readonly art: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
  id = 'frank';
  color = 0xffc66d;
  worried = false;
  constructor(scene: Phaser.Scene) {
    super(scene, 105, 366);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.body.setSize(22, 34).setOffset(-11, -34);
    this.art = scene.add.graphics();
    this.label = scene.add.text(0, -55, 'Frank', { fontFamily: 'DM Sans, sans-serif', fontSize: '11px', color: '#f5e4ba', backgroundColor: '#101a2bd9', padding: { x: 8, y: 3 } }).setOrigin(.5);
    this.add([this.art, this.label]);
    this.setDepth(10);
  }
  setFeet(p: Point) { this.setPosition(p.x, p.y); this.body.reset(p.x, p.y); }
  attach() { this.body.setAllowGravity(false); this.body.setVelocity(0); this.body.enable = false; }
  release(vx = 0, vy = 0) { this.body.enable = true; this.body.reset(this.x, this.y); this.body.setAllowGravity(true); this.body.setVelocity(vx, vy); }
  spawn(id = 'frank', name = 'Frank') {
    this.id = id; this.label.setText(name.slice(0, 24)); this.state = 'spawn';
    this.setAlpha(1).setScale(1); this.setFeet({ x: 105, y: 366 }); this.release();
  }
  animate(time: number) {
    const g = this.art.clear(), walking = this.state === 'boarding' || this.state === 'exiting' || (this.state === 'spawn' && this.body.velocity.x > 0);
    const stride = walking ? Math.sin(time / 80) * 3 : Math.sin(time / 280) * .6;
    g.fillStyle(0x070c19, .3).fillEllipse(0, 0, 30, 7);
    g.lineStyle(4, 0xd6a975).lineBetween(-5, -8, -6 - stride, -2).lineBetween(5, -8, 6 + stride, -2);
    g.fillStyle(this.color).fillRoundedRect(-11, -29, 22, 23, 7);
    g.fillStyle(0xffe1a8).fillRoundedRect(-11, -36 + stride * .1, 22, 18, 7);
    g.fillStyle(0x19243b).fillCircle(-4, -28, 2).fillCircle(5, -28, 2);
    g.lineStyle(1.4, 0x9f604a).beginPath().arc(1, this.worried ? -21 : -24, 3, this.worried ? Math.PI : 0, this.worried ? Math.PI * 2 : Math.PI).strokePath();
    g.lineStyle(3, 0xffc66d).lineBetween(-11, -18, -15, this.state === 'riding' ? -25 : -12 + stride).lineBetween(11, -18, 15, this.state === 'riding' ? -25 : -12 - stride);
    g.fillStyle(0xf58c7b, .55).fillEllipse(-7, -24, 4, 2).fillEllipse(8, -24, 4, 2);
  }
}
