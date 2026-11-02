import { introductionShown } from '../character-introductions';
import { escapePoint, pinchClosed, pinchTouches, type Pinch } from '../shared/escape';
import Phaser from 'phaser';
import { Character } from './Character';
import { Playground } from './Playground';
import { HandPlatform, PalmFilter, canClimbAboard, clamp, stepToward, type Point } from './HandPlatform';
import { DESTINATION_LEDGE, ENTRANCE, FLOATING_PLATFORMS, ZONES, canLand, landedZone, moveConstrained, near, type Zone } from '../shared/maze';
import type { ActorFrame, PublicState, SimState } from '../shared/protocol';

type Motion = 'hidden' | 'entrance' | 'spawn' | 'boarding' | 'riding' | 'walking' | 'delivered' | 'falling' | 'grounded' | 'escape' | 'captured';
export class TrustScene extends Phaser.Scene {
  frank!: Character;
  paddle = new HandPlatform();
  filter = new PalmFilter();
  mode: 'idle' | 'mouse' | 'camera' = 'idle';
  paused = false;
  debug = false;
  state?: PublicState;
  sim: SimState = { input: { x: 0, y: 0, dash: false } };
  motion: Motion = 'hidden';
  onFrame: (frame: ActorFrame) => void = () => {};
  onReady: () => void = () => {};
  onAction: (type: string, data?: Record<string, unknown>) => Promise<boolean> = async () => false;
  spectator = false;
  private incoming?: ActorFrame;
  private pendingRestore?: ActorFrame;
  private pinch?: Pinch;
  private pinchAt = 0;
  private art!: Phaser.GameObjects.Graphics;
  private actorKey = '';
  private pointer: Point = { x: 220, y: 420 };
  private destination?: Zone;
  private dwell = 0;
  private capture = 0;
  private sending = false;
  private elapsed = 0;
  private frameAccumulator = 0;
  private parked = new Map<string, { position: Point; label: Phaser.GameObjects.Text }>();
  private lastRound = 0;
  private returningActor = false;
  private playground?: Playground;
  private destinationPlatforms: Phaser.GameObjects.Rectangle[] = [];
  constructor() { super('TrustFall'); this.paddle.maze = true; this.paddle.position = { x: 210, y: 420 }; }
  preload() {
    this.load.image('save-cave', '/assets/caves/happy-cave.png');
    this.load.image('drop-cave', '/assets/caves/scary-cave.png');
  }
  create() {
    const g = this.add.graphics();
    for (let i = 0; i < 55; i++) g.fillStyle(0xa9bcae, .12).fillCircle((i * 197 + 21) % 960, (i * 83 + 55) % 540, 1);
    const solids = this.physics.add.staticGroup();
    for (const platform of FLOATING_PLATFORMS) {
      solids.add(this.add.rectangle(platform.x + platform.w / 2, platform.y + platform.h / 2, platform.w, platform.h, 0x97bca9, .9));
      g.lineStyle(2, 0xe4f5e9, .9).lineBetween(platform.x + 4, platform.y, platform.x + platform.w - 4, platform.y);
    }
    this.physics.world.setBounds(0, 75, 960, 455);
    const label = (x: number, y: number, value: string, color = '#61796c', size = 10) => this.add.text(x, y, value, { fontFamily: 'DM Sans, sans-serif', fontSize: `${size}px`, color }).setDepth(12);
    const ledge = (x: number, y: number, w: number, name: string, color: number) => {
      const surface = this.add.rectangle(x + w / 2, y + 9, w, 18, name.startsWith('DROP') ? 0xf1c6d0 : 0xc5dfcf, .95);
      solids.add(surface);
      if (!name.startsWith('01')) this.destinationPlatforms.push(surface);
      if (name.startsWith('01')) g.lineStyle(2, color, .9).lineBetween(x + 6, y, x + w - 6, y);
      if (!name.startsWith('01')) label(x + w / 2, y + 9, name.startsWith('DROP') ? 'Impostor' : 'Safe', name.startsWith('DROP') ? '#6b2038' : '#254c36', 14).setOrigin(.5).setFontStyle('bold');
    };
    ledge(35, 420, 165, '01 / PICKUP', 0x4b987b);
    ledge(DESTINATION_LEDGE.x, ZONES.SAVE.y, DESTINATION_LEDGE.w, 'SAVE / THREE SURVIVE', 0x49a57b);
    ledge(DESTINATION_LEDGE.x, ZONES.DROP.y, DESTINATION_LEDGE.w, 'DROP / ONE SUSPECT', 0xd8657e);
    this.playground = new Playground(this);
    // Decorative backdrops share the existing landing surfaces and sit behind riders.
    // Fit the art between ledges so neither cave covers the other landing zone.
    for (const zone of ['SAVE', 'DROP'] as const) {
      const cave = this.add.image(DESTINATION_LEDGE.x + DESTINATION_LEDGE.w / 2, ZONES[zone].y + 2, zone === 'SAVE' ? 'save-cave' : 'drop-cave').setOrigin(.5, 1).setDepth(-1);
      cave.setScale(Math.min(160 / cave.width, 74 / cave.height));
    }
    this.art = this.add.graphics().setDepth(9);
    this.frank = new Character(this); this.frank.setVisible(false); this.frank.attach();
    this.frank.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.frank, solids, undefined, () => this.motion === 'falling');
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => { this.pointer = { x: clamp(p.x, 72, 888), y: clamp(p.y, 113, 520) }; });
    this.input.keyboard?.on('keydown-P', (e: KeyboardEvent) => { if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) void this.onAction('pause'); });
    this.onReady();
  }
  setMode(mode: 'idle' | 'mouse' | 'camera') { this.mode = mode; this.filter.reset(); this.pinch = undefined; }
  observe(point: Point | null) { this.filter.observe(point, performance.now() / 1000); }
  observePinch(pinch: Pinch | null) { this.pinch = pinch || undefined; this.pinchAt = performance.now(); }
  resetTiming() { this.filter.resume(performance.now() / 1000); }
  receiveFrame(frame: ActorFrame) {
    if (this.spectator && this.frank && (!this.incoming || this.incoming.id !== frame.id)) { this.frank.setFeet(frame.position); this.paddle.position = { ...frame.paddle }; }
    this.incoming = frame;
  }
  private canShowCurrent() { return !this.state?.current || introductionShown(this.state.round, this.state.current); }
  restoreFrame(frame: ActorFrame) {
    if (!this.frank || !this.state || frame.id !== this.state.current) return;
    const actor = this.state.players.find(p => p.id === frame.id); if (!actor) return;
    if (!this.canShowCurrent()) { this.pendingRestore = frame; this.frank.setVisible(false); return; }
    this.actorKey = `${this.state.round}:${actor.id}`;
    this.frank.id = actor.id; this.frank.label.setText(actor.name); this.frank.color = actor.color;
    this.frank.setVisible(this.canShowCurrent()).setAlpha(1).setScale(1); this.frank.attach(); this.frank.setFeet(frame.position);
    this.paddle.position = { ...frame.paddle }; this.motion = frame.state === 'recovery' ? 'falling' : frame.state as Motion; this.destination = landedZone(frame.position); this.dwell = 0; this.capture = 0; this.sending = false;
    if (this.motion === 'falling') this.frank.release();
    if (this.motion === 'grounded') this.frank.state = 'spawn';
    if (this.motion === 'riding' || this.motion === 'boarding') this.frank.rider.attach(frame.position, this.paddle);
  }
  sync(state: PublicState) {
    const previous = this.state;
    this.state = state;
    if (previous?.phase !== state.phase) this.sending = false;
    if (!this.frank) return;
    this.playground?.reset(`${state.round}:${state.current || 'waiting'}`);
    const paused = state.paused || !state.hostConnected;
    if (paused !== this.paused || this.physics.world.isPaused !== paused) {
      this.paused = paused; this.resetTiming(); paused ? this.physics.pause() : this.physics.resume();
      if (!paused && ['riding', 'boarding'].includes(this.motion) && this.mode !== 'idle') { const now = performance.now() / 1000; this.filter.observe(this.paddle.position, now); this.filter.observe(null, now); }
    }
    if (this.lastRound !== state.round) { this.parked.forEach(v => v.label.destroy()); this.parked.clear(); this.lastRound = state.round; }
    for (const player of state.players) if (player.id !== state.current && player.outcome === 'SAVE') {
      if (!this.parked.has(player.id)) this.parked.set(player.id, { position: { ...(player.position || ZONES.SAVE) }, label: this.add.text(0, 0, player.name, { fontFamily: 'DM Sans, sans-serif', fontSize: '9px', color: '#536b5a' }).setOrigin(.5).setDepth(12) });
    }
    this.parked.forEach((v, id) => v.label.setVisible(id !== state.current && introductionShown(state.round, id) && state.players.some(p => p.id === id && p.delivered)));
    if (this.returningActor) return;
    if (previous?.round === state.round && previous.current === this.frank.id && previous.current !== state.current && this.motion === 'riding') {
      this.returningActor = true; this.beginFall(); return;
    }
    const actor = state.players.find(p => p.id === state.current);
    if (!actor || !this.canShowCurrent() || !['INTERROGATION', 'IMPOSTOR_GUESS', 'DECISIONS', 'ESCAPE', 'REVEAL', 'RESULTS'].includes(state.phase)) { this.motion = 'hidden'; this.frank.setVisible(false); this.actorKey = ''; this.destination = undefined; this.dwell = 0; this.capture = 0; return; }
    if (this.pendingRestore?.id === actor.id) { const frame = this.pendingRestore; this.pendingRestore = undefined; this.restoreFrame(frame); }
    const key = `${state.round}:${actor.id}`;
    if (key !== this.actorKey && !['REVEAL', 'RESULTS'].includes(state.phase)) {
      this.actorKey = key; this.frank.id = actor.id; this.frank.label.setText(actor.name); this.frank.color = actor.color; this.frank.attach();
      this.elapsed = 0; this.dwell = 0; this.destination = undefined; this.sending = false;
      if (state.phase === 'DECISIONS' && actor.delivered) {
        this.frank.setFeet(this.parked.get(actor.id)?.position || actor.position || ENTRANCE); this.frank.setVisible(true).setAlpha(1).setScale(1); this.beginFall();
      } else {
        this.frank.setFeet({ x: ENTRANCE.x - 50, y: ENTRANCE.y }); this.frank.setVisible(true).setAlpha(0).setScale(.7); this.motion = 'entrance';
      }
    }
    if (state.phase === 'ESCAPE' && state.escape === 'captured' && this.motion !== 'captured') { this.motion = 'captured'; this.destination = undefined; this.capture = 0; this.dwell = 0; }
    if (state.phase === 'ESCAPE' && !['escape', 'captured'].includes(this.motion)) {
      this.motion = 'escape'; this.frank.attach(); this.frank.state = 'falling'; this.elapsed = 0; this.capture = 0; this.sending = false;
    }
    this.frank.worried = this.destination === 'DROP' || state.phase === 'ESCAPE';
  }
  private moveFeet(target: Point, speed: number, dt: number) {
    const f = this.frank;
    const next = moveConstrained({ x: f.x, y: f.y }, stepToward(f, target, speed * dt), 12, 35, 0);
    f.setFeet(next); return near(next, target, 2);
  }
  private beginFall(vx = 0) {
    this.motion = 'falling'; this.destination = undefined; this.dwell = 0;
    this.frank.state = 'falling'; this.frank.release(vx);
  }
  update(time: number, delta: number) {
    if (!this.frank) return;
    const dt = Math.min(delta / 1000, .0334), s = this.state, f = this.frank, p = this.paddle;
    const previousFeet = { x: f.x, y: f.y };
    if (!this.canShowCurrent()) { f.setVisible(false); this.motion = 'hidden'; this.actorKey = ''; this.draw(time); return; }
    s?.players.forEach((v, i) => { const parked = this.parked.get(v.id); if (parked && v.id !== s.current) { const z = v.outcome === 'SAVE' ? { x: DESTINATION_LEDGE.x + 17 + i * 38, y: ZONES.SAVE.y } : parked.position; parked.position = stepToward(parked.position, z, this.paused ? 0 : 45 * dt); parked.label.setPosition(parked.position.x, parked.position.y - 34); } });
    if (this.spectator) {
      if (this.incoming && this.incoming.id === s?.current) { f.setVisible(true); f.setFeet(stepToward(f, this.incoming.position, 1500 * dt)); p.position = stepToward(p.position, this.incoming.paddle, 1500 * dt); p.state = this.incoming.active ? 'tracked' : 'inactive'; this.motion = this.incoming.state as Motion; }
      this.playground?.update(this.paused ? 0 : dt, p, !this.paused && p.active && this.motion === 'riding', f, previousFeet, s?.phase === 'ESCAPE');
      f.animate(time); this.draw(time); return;
    }
    if (!this.paused && !document.hidden) {
      this.elapsed += dt;
      if (this.mode === 'mouse') this.filter.observe(this.pointer, performance.now() / 1000);
      this.filter.update(performance.now() / 1000, dt);
      p.sanctuary = false;
      if (this.mode === 'mouse') {
        const gap = this.input?.activePointer?.isDown ? 8 : 30;
        this.pinch = { thumb: { x: this.pointer.x - gap, y: this.pointer.y }, index: { x: this.pointer.x + gap, y: this.pointer.y }, ratio: gap === 8 ? .2 : .8 };
        this.pinchAt = performance.now();
      }
      if (performance.now() - this.pinchAt > 200) this.pinch = undefined;
      p.collisionOffset = this.motion === 'riding' ? f.rider.offset : 0;
      p.move(this.filter.target, this.mode === 'idle' ? 'inactive' : this.filter.state, dt);
      if (this.motion === 'entrance') {
        f.setAlpha(Math.min(1, this.elapsed * 2)).setScale(Math.min(1, .7 + this.elapsed));
        f.state = 'boarding'; if (this.moveFeet(ENTRANCE, 90, dt)) { this.motion = 'spawn'; f.state = 'spawn'; }
      } else if (this.motion === 'spawn') {
        f.state = 'spawn'; this.moveFeet({ x: 180, y: 420 }, 50, dt);
        if (p.active && p.position.x >= 190 && p.position.x <= 255 && Math.abs(p.position.y - 420) <= 28 && f.x > 170) { this.motion = 'boarding'; f.state = 'boarding'; f.rider.offset = 0; }
      } else if (this.motion === 'boarding') {
        if (!canClimbAboard(f, p)) this.beginFall();
        else if (this.moveFeet(p.position, 180, dt)) { f.rider.offset = 0; this.motion = 'riding'; f.state = 'riding'; }
      } else if (this.motion === 'riding') {
        if (!p.active) this.beginFall(clamp(p.delta.x * 60, -120, 120));
        else {
          const centered = moveConstrained(f.rider.feet(p), { x: p.position.x, y: p.position.y }, 11, 36, 0);
          f.rider.offset = centered.x - p.position.x; f.setFeet(f.rider.feet(p));
          const actor = s?.players.find(v => v.id === f.id);
          if (s && actor && !actor.outcome && (s.phase === 'DECISIONS' || s.phase === 'INTERROGATION' && actor.answer)) {
            const zone = (['SAVE', 'DROP'] as Zone[]).find(zone => canLand(p.position, zone) && (zone === 'SAVE' ? s.saved < s.players.length - 1 : s.dropped === 0));
            if (zone) { this.destination = zone; this.motion = 'walking'; f.state = 'exiting'; f.worried = zone === 'DROP'; this.dwell = 0; }
          }
        }
      } else if (this.motion === 'walking' && this.destination) {
        if (this.moveFeet(ZONES[this.destination], 180, dt)) { this.motion = 'delivered'; f.state = 'rescued'; this.dwell = 0; }
      } else if (this.motion === 'delivered' && this.destination && s && ['INTERROGATION', 'DECISIONS'].includes(s.phase) && !s.players.find(v => v.id === f.id)?.outcome) {
        this.dwell += dt;
        if (this.dwell >= .7 && !this.sending && !s.demoSpeaking) { this.sending = true; void this.onAction('delivery').then(ok => { if (!ok) this.sending = false; }); }
      } else if (this.motion === 'falling') {
        if (f.body.blocked.down || f.body.touching.down) {
          f.attach(); this.motion = 'grounded'; f.state = 'spawn';
          if (this.returningActor) {
            if (!this.parked.has(f.id)) this.parked.set(f.id, { position: { x: f.x, y: f.y }, label: this.add.text(f.x, f.y - 34, f.label.text, { fontFamily: 'DM Sans, sans-serif', fontSize: '9px', color: '#536b5a' }).setOrigin(.5).setDepth(12) });
            this.returningActor = false; this.motion = 'hidden'; this.actorKey = ''; if (this.state) this.sync(this.state);
          }
        }
      } else if (this.motion === 'grounded') {
        if (canClimbAboard(f, p)) { f.rider.attach(f, p); this.motion = 'boarding'; f.state = 'boarding'; }
      } else if (this.motion === 'escape' && s?.phase === 'ESCAPE') {
        const ready = s.escape === 'active' && p.state === 'tracked';
        if (ready) {
          const gripping = pinchTouches(this.pinch, f) || this.capture > 0 && pinchClosed(this.pinch);
          if (gripping && this.pinch) {
            f.setFeet({ x: (this.pinch.thumb.x + this.pinch.index.x) / 2, y: (this.pinch.thumb.y + this.pinch.index.y) / 2 + 18 });
            this.capture += dt;
          } else {
            this.capture = 0;
            f.setFeet(stepToward(f, escapePoint(s.escapeProgress || 0), 160 * dt));
          }
          if (!this.sending && this.capture >= .3) {
            this.sending = true; void this.onAction('capture', { player: f.id }).then(ok => { this.sending = false; if (ok) { this.motion = 'captured'; this.destination = undefined; this.capture = 0; this.dwell = 0; } });
          }
          if (!this.sending && this.sim.ring && (s.escapeProgress || 0) >= 1 && near({ x: f.x, y: f.y - 18 }, this.sim.ring, 23)) { this.sending = true; void this.onAction('ring', { player: f.id }).then(ok => { if (!ok) this.sending = false; }); }
        } else this.capture = 0;
      } else if (this.motion === 'captured' && s?.phase === 'ESCAPE') {
        if (this.destination === 'DROP') {
          if (this.moveFeet(ZONES.DROP, 220, dt)) this.dwell += dt;
          if (this.dwell >= .7 && !this.sending) {
            this.sending = true;
            void this.onAction('returnCaptured', { player: f.id }).then(ok => { if (!ok) this.sending = false; });
          }
        } else if (this.pinch) {
          // Feet are below the finger midpoint so the body is held between the fingertips.
          f.setFeet({ x: (this.pinch.thumb.x + this.pinch.index.x) / 2, y: (this.pinch.thumb.y + this.pinch.index.y) / 2 + 18 });
          if (canLand(f, 'DROP')) { this.destination = 'DROP'; this.dwell = 0; }
        }
      }
    }
    const interacting = !this.paused && !document.hidden && p.active && this.motion === 'riding';
    const corrected = this.playground?.update(this.paused || document.hidden ? 0 : dt, p, interacting, f, previousFeet, s?.phase === 'ESCAPE');
    if (interacting && corrected) {
      const feet = moveConstrained(f, corrected, 11, 36, 0, p.sanctuary);
      const dx = feet.x - f.x, dy = feet.y - f.y;
      p.position = { x: p.position.x + dx, y: p.position.y + dy };
      p.delta = { x: p.delta.x + dx, y: p.delta.y + dy };
      f.setFeet(feet);
    }
    this.frameAccumulator += dt;
    if (s?.current === f.id && !this.returningActor && this.motion !== 'hidden' && this.frameAccumulator >= .05) {
      this.frameAccumulator = 0;
      this.onFrame({ id: f.id, position: { x: f.x, y: f.y }, paddle: { ...p.position }, active: !this.paused && !document.hidden && p.state === 'tracked', riding: this.motion === 'riding', state: this.motion, capture: this.capture, dwell: this.dwell, pinch: this.pinch });
    }
    f.animate(time); f.setAngle(s?.phase === 'ESCAPE' && s.escape === 'starting' ? Math.sin(time / 35) * 8 : 0); this.draw(time);
  }
  private draw(time: number) {
    const g = this.art.clear(), p = this.paddle, s = this.state;
    this.destinationPlatforms.forEach(platform => platform.setVisible(this.debug));
    if (this.debug && (p.active && this.mode !== 'idle' || this.spectator && p.active)) {
      const { x, y } = p.position;
      g.fillStyle(0x63f5e2, .1).fillRoundedRect(x - 80, y - 5, 160, 24, 10);
      g.fillStyle(0x79b69b, .85).fillRoundedRect(x - 72, y, 144, 10, 5);
      g.lineStyle(3, 0x4c8d70, p.state === 'grace' ? .4 : 1).lineBetween(x - 69, y, x + 69, y);
      if (this.mode === 'camera' && Math.hypot(this.filter.target.x - x, this.filter.target.y - y) > 45) {
        g.lineStyle(1, 0xffd28f, .5).lineBetween(x, y, this.filter.target.x, this.filter.target.y);
        g.lineStyle(1, 0xffd28f, .6).strokeCircle(this.filter.target.x, this.filter.target.y, 7);
      }
    }
    if (this.debug) {
      const pinch = this.spectator ? this.incoming?.pinch : performance.now() - this.pinchAt <= 200 ? this.pinch : undefined;
      if (pinch) {
        const closed = pinch.ratio <= .35;
        g.lineStyle(2, closed ? 0xff83bc : 0x8c6eff, .9).lineBetween(pinch.thumb.x, pinch.thumb.y, pinch.index.x, pinch.index.y);
        g.lineStyle(3, 0xffb65c, 1).strokeCircle(pinch.thumb.x, pinch.thumb.y, 9);
        g.lineStyle(3, 0x79dfff, 1).strokeCircle(pinch.index.x, pinch.index.y, 9);
      }
    }
    if (s?.phase === 'ESCAPE') {
      let last: Point | undefined;
      for (let i = 0; i <= 160; i++) {
        const t = i / 160, point = escapePoint(t);
        if (last && Math.hypot(point.x - last.x, point.y - last.y) < 34 && i < 160) continue;
        last = point;
        if (s.escape === 'active' && t < (s.escapeProgress || 0)) continue;
        g.fillStyle(0xffd66b, .18).fillCircle(point.x, point.y - 18, 11);
        g.fillStyle(0xffdf79, 1).fillEllipse(point.x, point.y - 18, 9, 13);
      }
    }
    if (this.destination && this.dwell > 0 && this.motion !== 'captured') { const z = ZONES[this.destination]; g.lineStyle(4, 0xa4ffe0).beginPath().arc(z.x, z.y - 21, 27, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, this.dwell / .7)).strokePath(); }

    s?.players.filter(v => v.id !== s.current && introductionShown(s.round, v.id) && (this.parked.has(v.id) || v.outcome === 'SAVE')).forEach((v, i) => {
      const point = this.parked.get(v.id)?.position || { x: DESTINATION_LEDGE.x + 17 + i * 38, y: ZONES.SAVE.y };
      g.fillStyle(v.color).fillRoundedRect(point.x - 7, point.y - 21, 14, 21, 5); g.fillStyle(0x132138).fillCircle(point.x - 3, point.y - 15, 1.3).fillCircle(point.x + 3, point.y - 15, 1.3);
    });
  }
}
