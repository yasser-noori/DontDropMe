import Phaser from 'phaser';
import { Character } from './Character';
import { HandPlatform, PalmFilter, canTransfer, clamp, type Point } from './HandPlatform';

export type GameCommand = { type: 'spawn'; id: string; name: string } | { type: 'reset' } | { type: 'pause' } | { type: 'resume' };
export class GameScene extends Phaser.Scene {
  frank!: Character;
  paddle = new HandPlatform();
  filter = new PalmFilter();
  mode: 'idle' | 'mouse' | 'camera' = 'idle';
  paused = false;
  rescues = 0;
  private art!: Phaser.GameObjects.Graphics;
  private portal!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private score!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private transition = 0;
  private transitionStart: Point = { x: 0, y: 0 };
  private clock = 0;
  private respawnAt = Infinity;
  private mouseTarget: Point = { x: 330, y: 366 };
  constructor() { super('Rescue'); }
  create() {
    const bg = this.add.graphics();
    for (let i = 0; i < 65; i++) { const x = (i * 197 + 17) % 960, y = (i * 83 + 40) % 500; bg.fillStyle(0x94b9d9, i % 3 === 0 ? .25 : .09).fillCircle(x, y, i % 3 === 0 ? 1.4 : .8); }
    bg.lineStyle(1, 0x9ab5d4, .06); for (let x = 0; x < 960; x += 60) bg.lineBetween(x, 100, x, 540);
    this.art = this.add.graphics().setDepth(5);
    this.portal = this.add.graphics().setDepth(3);
    const solids = this.physics.add.staticGroup();
    for (const [x, y, w] of [[150, 380, 220], [815, 334, 210]]) {
      const body = this.add.rectangle(x, y, w, 28, 0x14243c, .95);
      solids.add(body);
      const g = this.add.graphics();
      g.fillStyle(0x344861, .16).fillRoundedRect(x - w / 2 - 7, y - 12, w + 14, 40, 12);
      g.fillStyle(0x17263e, .95).fillRoundedRect(x - w / 2, y - 14, w, 28, 9);
      g.lineStyle(2, x < 300 ? 0x7db3bb : 0xb991ff, .8).lineBetween(x - w / 2 + 12, y - 14, x + w / 2 - 12, y - 14);
      for (let n = 0; n < 3; n++) g.fillStyle(0x97b7ce, .2).fillRoundedRect(x - 20 + n * 14, y + 2, 7, 3, 1);
    }
    const text = (x: number, y: number, value: string, size = 11, color = '#8297b4') => this.add.text(x, y, value, { fontFamily: 'DM Sans, sans-serif', fontSize: `${size}px`, color });
    text(44, 405, '01 / PICKUP', 10); text(711, 360, '03 / HOME', 10);
    text(40, 28, '●  HOLD MY CHAT', 12, '#c1d3e9');
    this.hud = text(40, 52, 'CHOOSE YOUR MODE', 10, '#6f849f');
    this.score = text(916, 26, '00', 34, '#f1f5ff').setOrigin(1, 0);
    text(916, 66, 'RESCUED', 9, '#a6b6cd').setOrigin(1, 0);
    this.hint = text(480, 116, 'A tiny life. In the palm of your hand.', 19, '#e4edf9').setOrigin(.5);
    text(480, 486, 'Move close to a platform. Frank handles the walking.', 11).setOrigin(.5);
    this.banner = text(480, 205, '', 24, '#95ffe4').setOrigin(.5).setDepth(20);
    this.frank = new Character(this);
    this.physics.add.collider(this.frank, solids, undefined, () => ['spawn', 'falling', 'exiting'].includes(this.frank.state) && this.frank.body.enable);
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => { this.mouseTarget = { x: clamp(pointer.x, 72, 888), y: clamp(pointer.y, 100, 500) }; });
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.repeat || (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(e.target.tagName))) return;
      if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); this.spawnCharacter({ id: 'frank', name: 'Frank' }); }
      if (e.code === 'KeyR') this.command({ type: 'reset' });
      if (e.code === 'KeyP') this.command({ type: this.paused ? 'resume' : 'pause' });
    });
  }
  setMode(mode: 'idle' | 'mouse' | 'camera') { this.mode = mode; this.filter.reset(); if (mode === 'idle') this.paddle.state = 'inactive'; }
  observe(point: Point | null) { this.filter.observe(point, performance.now() / 1000); }
  resetTiming() { this.filter.resume(performance.now() / 1000); this.paddle.delta = { x: 0, y: 0 }; }
  spawnCharacter({ id, name }: { id: string; name: string }) { this.tweens.killTweensOf(this.frank); this.frank.spawn(id, name); this.transition = 0; this.respawnAt = Infinity; this.banner.setText(''); }
  command(command: GameCommand) {
    if (command.type === 'spawn') this.spawnCharacter(command);
    if (command.type === 'reset') { this.rescues = 0; this.score.setText('00'); this.spawnCharacter({ id: 'frank', name: 'Frank' }); }
    if (command.type === 'pause' || command.type === 'resume') {
      this.paused = command.type === 'pause'; this.resetTiming();
      this.paused ? this.physics.pause() : this.physics.resume();
      this.paused ? this.tweens.pauseAll() : this.tweens.resumeAll();
      document.querySelector<HTMLElement>('#pause-overlay')!.hidden = !this.paused;
      document.querySelector('#pause')!.textContent = this.paused ? '▶ Resume' : 'Ⅱ Pause';
    }
  }
  private fall() {
    this.frank.state = 'falling';
    this.frank.release(clamp(this.paddle.delta.x * 60, -160, 160), clamp(this.paddle.delta.y * 60, -100, 180));
  }
  update(time: number, delta: number) {
    if (this.paused || document.hidden || !this.frank) return;
    const dt = Math.min(delta / 1000, .0334); this.clock += dt;
    if (this.mode === 'mouse') { this.filter.observe(this.mouseTarget, performance.now() / 1000); }
    this.filter.update(performance.now() / 1000, dt);
    this.paddle.move(this.filter.target, this.mode === 'idle' ? 'inactive' : this.filter.state, dt);
    const f = this.frank, p = this.paddle;
    if (f.state === 'spawn') {
      f.body.setVelocityX(f.x < 235 ? 45 : 0);
      if (f.x >= 230 && canTransfer(p, 260, 366, 'spawn')) {
        f.state = 'boarding'; f.attach(); f.rider.offset = -30;
        this.transition = 0; this.transitionStart = { x: f.x, y: f.y };
      }
    }
    if (f.state === 'boarding') {
      if (!p.active) this.fall();
      else {
        this.transition = Math.min(1, this.transition + dt / .55);
        const end = f.rider.feet(p), t = Phaser.Math.Easing.Sine.InOut(this.transition);
        f.setFeet({ x: Phaser.Math.Linear(this.transitionStart.x, end.x, t), y: Phaser.Math.Linear(this.transitionStart.y, end.y, t) - Math.sin(t * Math.PI) * 6 });
        if (this.transition === 1) f.state = 'riding';
      }
    } else if (f.state === 'riding') {
      if (!p.active) this.fall();
      else {
        // Small intentional walk toward the middle; never auto-walk off during transport.
        if (!f.rider.walk(clamp(-f.rider.offset, -12 * dt, 12 * dt), p)) { this.fall(); return; }
        f.setFeet(f.rider.feet(p));
        if (canTransfer(p, 710, 320, 'exit')) {
          f.state = 'exiting'; this.transition = 0; this.transitionStart = { x: f.x, y: f.y };
        }
      }
    } else if (f.state === 'exiting') {
      if (!f.body.enable) {
        this.transition = Math.min(1, this.transition + dt / .6);
        const t = Phaser.Math.Easing.Sine.InOut(this.transition);
        f.setFeet({ x: Phaser.Math.Linear(this.transitionStart.x, 745, t), y: Phaser.Math.Linear(this.transitionStart.y, 320, t) - Math.sin(t * Math.PI) * 8 });
        if (this.transition === 1) f.release(65, 0);
      } else {
        f.body.setVelocityX(65);
        if (f.x >= 844) this.rescue();
      }
    }
    if (f.state === 'falling' && f.y > 610) this.spawnCharacter({ id: f.id, name: f.label.text });
    if (this.clock >= this.respawnAt) this.spawnCharacter({ id: f.id, name: f.label.text });
    f.animate(time);
    this.draw(time);
  }
  private rescue() {
    const f = this.frank; f.state = 'rescued'; f.attach(); this.rescues++;
    this.score.setText(String(this.rescues).padStart(2, '0'));
    this.tweens.add({ targets: this.score, scale: 1.25, duration: 160, yoyo: true });
    this.banner.setText(`${f.label.text} made it home!  +1`);
    this.tweens.add({ targets: f, alpha: 0, scale: .3, x: 857, y: 282, duration: 450 });
    for (let i = 0; i < 30; i++) {
      const bit = this.add.rectangle(852, 282, 3 + i % 3, 7, [0x79ffe0, 0xbc91ff, 0xffd279][i % 3]).setDepth(15);
      this.tweens.add({ targets: bit, x: 852 + Phaser.Math.Between(-160, 90), y: 282 + Phaser.Math.Between(-110, 80), angle: Phaser.Math.Between(-300, 300), alpha: 0, duration: 900, onComplete: () => bit.destroy() });
    }
    this.respawnAt = this.clock + 1.6;
  }
  private draw(time: number) {
    const g = this.art.clear(), p = this.paddle, x = p.position.x, y = p.position.y;
    if (p.active) {
      const a = p.state === 'grace' ? .45 : 1;
      g.fillStyle(0x55eddf, .05 * a).fillRoundedRect(x - 84, y - 10, 168, 30, 15);
      g.fillStyle(0x55eddf, .12 * a).fillRoundedRect(x - 78, y - 5, 156, 19, 9);
      g.fillStyle(0x123c4c, .9 * a).fillRoundedRect(x - 72, y, 144, 10, 5);
      g.lineStyle(3, 0x7affec, a).lineBetween(x - 66, y, x + 66, y);
      g.lineStyle(1, 0x7affec, .3 * a).lineBetween(x - 36, y + 16, x + 36, y + 16);
      g.fillStyle(0xd3fff7, a).fillCircle(x, y + 5, 2);
    } else if (this.mode === 'idle') {
      g.lineStyle(1, 0x65e9df, .3); g.strokeRoundedRect(276, 363, 144, 10, 5);
      g.lineStyle(1, 0x65e9df, .15).lineBetween(350, 350, 410, 300);
    }
    const r = this.portal.clear(), pulse = .6 + Math.sin(time / 400) * .15;
    r.fillStyle(0xa36bff, .04).fillEllipse(852, 276, 104, 127);
    r.fillStyle(0xb07cff, .09).fillEllipse(852, 276, 78, 106);
    r.fillStyle(0x281a54, .85).fillEllipse(852, 276, 49, 80);
    r.lineStyle(5, 0x7d4fdb, .3).strokeEllipse(852, 276, 58, 88);
    r.lineStyle(2.5, 0xd5adff, pulse).strokeEllipse(852, 276, 49, 80);
    r.lineStyle(1, 0xc6a1ff, .3).strokeEllipse(852, 276, 35 + Math.sin(time / 700) * 6, 67);
    for (let i = 0; i < 8; i++) { const a = time / 1400 + i * Math.PI / 4; r.fillStyle(0xe5c5ff, .7).fillCircle(852 + Math.cos(a) * 30, 276 + Math.sin(a) * 47, 1.5); }
    const status = this.mode === 'mouse' ? 'MOUSE TEST MODE' : this.mode === 'camera' ? p.state === 'tracked' ? '● HAND TRACKED' : p.state === 'grace' ? '◌ BRING YOUR HAND BACK' : '◌ LOOKING FOR YOUR HAND' : 'CHOOSE YOUR MODE';
    this.hud.setText(status).setColor(p.state === 'tracked' ? '#79ffe0' : '#b2bcd0');
    const hints = { spawn: 'Bring your palm beside Frank', boarding: 'All aboard. Hold steady…', riding: 'You’ve got him. Carry him to the portal →', exiting: 'Almost home. Frank’s got this.', falling: 'Oops! A fresh start is on the way.', rescued: 'One small rescue. One big moment.' };
    this.hint.setText(this.mode === 'idle' ? 'A tiny life. In the palm of your hand.' : p.state === 'grace' ? 'Bring your hand back — holding on…' : hints[this.frank.state]);
  }
}
