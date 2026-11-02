import Phaser from 'phaser';
import { Character } from './Character';
import { HandPlatform, PalmFilter, clamp, stepToward, type Point } from './HandPlatform';
import { ENTRANCE, WALLS, SANCTUARY, ZONES, canLand, moveConstrained, near, type Zone } from '../shared/maze';
import type { ActorFrame, PublicState, SimState } from '../shared/protocol';

type Motion = 'hidden' | 'entrance' | 'spawn' | 'boarding' | 'riding' | 'walking' | 'delivered' | 'falling' | 'recovery' | 'escape' | 'captured';
export class TrustScene extends Phaser.Scene {
  frank!: Character;
  paddle = new HandPlatform();
  filter = new PalmFilter();
  mode: 'idle' | 'mouse' | 'camera' = 'idle';
  paused = false;
  state?: PublicState;
  sim: SimState = { input: { x: 0, y: 0, dash: false } };
  motion: Motion = 'hidden';
  onFrame: (frame: ActorFrame) => void = () => {};
  onReady: () => void = () => {};
  onAction: (type: string, data?: Record<string, unknown>) => Promise<boolean> = async () => false;
  spectator = false;
  private incoming?: ActorFrame;
  private art!: Phaser.GameObjects.Graphics;
  private info!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private bubble!: Phaser.GameObjects.Text;
  private actorKey = '';
  private pointer: Point = { x: 220, y: 420 };
  private destination?: Zone;
  private dwell = 0;
  private capture = 0;
  private sending = false;
  private elapsed = 0;
  private frameAccumulator = 0;
  private recovery: Point[] = [];
  private parked = new Map<string, { position: Point; label: Phaser.GameObjects.Text }>();
  private lastRound = 0;
  private returningActor = false;
  constructor() { super('TrustFall'); this.paddle.maze = true; this.paddle.position = { x: 210, y: 420 }; }
  create() {
    const g = this.add.graphics();
    for (let i = 0; i < 55; i++) g.fillStyle(0xb5cbea, .12).fillCircle((i * 197 + 21) % 960, (i * 83 + 55) % 540, 1);
    const solids = this.physics.add.staticGroup();
    for (const wall of WALLS) {
      solids.add(this.add.rectangle(wall.x + wall.w / 2, wall.y + wall.h / 2, wall.w, wall.h, 0x142f47, .88));
      g.lineStyle(2, 0x4f7a99, .65).strokeRoundedRect(wall.x, wall.y, wall.w, wall.h, 5);
      for (let y = wall.y + 12; y < wall.y + wall.h - 8; y += 17) g.lineStyle(1, 0xa6d6e4, .2).lineBetween(wall.x + 5, y, wall.x + 18, y + 5);
    }
    this.physics.world.setBounds(0, 75, 960, 455);
    const label = (x: number, y: number, value: string, color = '#a0b6ce', size = 10) => this.add.text(x, y, value, { fontFamily: 'DM Sans, sans-serif', fontSize: `${size}px`, color }).setDepth(12);
    const ledge = (x: number, y: number, w: number, name: string, color: number) => {
      solids.add(this.add.rectangle(x + w / 2, y + 9, w, 18, 0x17283f, .9));
      g.lineStyle(2, color, .9).lineBetween(x + 6, y, x + w - 6, y);
      label(x + 6, y + 23, name, Phaser.Display.Color.IntegerToColor(color).rgba);
    };
    ledge(35, 420, 165, '01 / PICKUP', 0x78e7df);
    ledge(755, 345, 175, 'SAVE / THREE SURVIVE', 0x81eac3);
    ledge(755, 450, 175, 'DROP / ONE SUSPECT', 0xff8d9f);
    g.fillStyle(0x9b91ff, .07).fillRoundedRect(SANCTUARY.x, SANCTUARY.y, SANCTUARY.w, SANCTUARY.h, 12);
    g.lineStyle(1, 0xb6a0ff, .4).strokeRoundedRect(SANCTUARY.x, SANCTUARY.y, SANCTUARY.w, SANCTUARY.h, 12);
    label(775, 89, 'SANCTUARY · NO HAND', '#c2aef4', 9);
    label(45, 25, 'HOLD MY CHAT / TRUST FALL', '#dbf5f2', 12);
    label(355, 492, '↓ UNDER 01     ↑ OVER 02', '#7691ab', 10);
    this.info = label(480, 34, 'CREATE A ROOM TO BEGIN', '#95f4dc', 13).setOrigin(.5);
    this.status = label(45, 50, 'CHOOSE CAMERA OR MOUSE', '#94a8bf', 10);
    this.bubble = label(480, 85, '', '#edf4ff', 13).setOrigin(.5).setWordWrapWidth(330).setBackgroundColor('#101c30db').setPadding(8);
    this.art = this.add.graphics().setDepth(9);
    this.frank = new Character(this); this.frank.setVisible(false); this.frank.attach();
    this.frank.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.frank, solids, undefined, () => this.motion === 'falling');
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => { this.pointer = { x: clamp(p.x, 72, 888), y: clamp(p.y, 113, 520) }; });
    this.input.keyboard?.on('keydown-P', (e: KeyboardEvent) => { if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) void this.onAction('pause'); });
    this.onReady();
  }
  setMode(mode: 'idle' | 'mouse' | 'camera') { this.mode = mode; this.filter.reset(); }
  observe(point: Point | null) { this.filter.observe(point, performance.now() / 1000); }
  resetTiming() { this.filter.resume(performance.now() / 1000); }
  receiveFrame(frame: ActorFrame) {
    if (this.spectator && this.frank && (!this.incoming || this.incoming.id !== frame.id)) { this.frank.setFeet(frame.position); this.paddle.position = { ...frame.paddle }; }
    this.incoming = frame;
  }
  restoreFrame(frame: ActorFrame) {
    if (!this.frank || !this.state || frame.id !== this.state.current) return;
    const actor = this.state.players.find(p => p.id === frame.id); if (!actor) return;
    this.actorKey = `${this.state.round}:${actor.id}`;
    this.frank.id = actor.id; this.frank.label.setText(actor.name); this.frank.color = actor.color;
    this.frank.setVisible(true).setAlpha(1).setScale(1); this.frank.attach(); this.frank.setFeet(frame.position);
    this.paddle.position = { ...frame.paddle }; this.motion = frame.state as Motion; this.destination = this.state.armed; this.dwell = 0; this.capture = 0; this.sending = false;
    if (this.motion === 'falling') this.frank.release();
    if (this.motion === 'recovery') this.recover();
  }
  sync(state: PublicState) {
    const previous = this.state;
    this.state = state;
    if (!this.frank) return;
    const paused = state.paused || !state.hostConnected;
    if (paused !== this.paused || this.physics.world.isPaused !== paused) {
      this.paused = paused; this.resetTiming(); paused ? this.physics.pause() : this.physics.resume();
      if (!paused && ['riding', 'boarding'].includes(this.motion) && this.mode !== 'idle') { const now = performance.now() / 1000; this.filter.observe(this.paddle.position, now); this.filter.observe(null, now); }
    }
    if (this.lastRound !== state.round) { this.parked.forEach(v => v.label.destroy()); this.parked.clear(); this.lastRound = state.round; }
    for (const player of state.players) if (player.id !== state.current && player.outcome === 'SAVE') {
      if (!this.parked.has(player.id)) this.parked.set(player.id, { position: { ...(player.position || ZONES.SAVE) }, label: this.add.text(0, 0, player.name, { fontFamily: 'DM Sans, sans-serif', fontSize: '9px', color: '#d8e5ee' }).setOrigin(.5).setDepth(12) });
    }
    this.parked.forEach((v, id) => v.label.setVisible(id !== state.current && state.players.some(p => p.id === id && p.delivered)));
    if (this.returningActor) return;
    if (previous?.round === state.round && previous.current === this.frank.id && previous.current !== state.current && this.motion === 'riding') {
      this.returningActor = true; this.recover(); return;
    }
    const actor = state.players.find(p => p.id === state.current);
    if (!actor || !['INTERROGATION', 'IMPOSTOR_GUESS', 'DECISIONS', 'ESCAPE', 'REVEAL', 'RESULTS'].includes(state.phase)) { this.motion = 'hidden'; this.frank.setVisible(false); this.actorKey = ''; this.destination = undefined; this.dwell = 0; this.capture = 0; return; }
    const key = `${state.round}:${actor.id}`;
    if (key !== this.actorKey && !['REVEAL', 'RESULTS'].includes(state.phase)) {
      this.actorKey = key; this.frank.id = actor.id; this.frank.label.setText(actor.name); this.frank.color = actor.color; this.frank.attach();
      this.elapsed = 0; this.dwell = 0; this.destination = undefined; this.sending = false;
      if (state.phase === 'DECISIONS' && actor.delivered) {
        this.frank.setFeet(this.parked.get(actor.id)?.position || actor.position || ENTRANCE); this.frank.setVisible(true).setAlpha(1).setScale(1); this.recover();
      } else {
        this.frank.setFeet({ x: ENTRANCE.x - 50, y: ENTRANCE.y }); this.frank.setVisible(true).setAlpha(0).setScale(.7); this.motion = 'entrance';
      }
    }
    if (state.phase === 'ESCAPE' && !['escape', 'captured'].includes(this.motion)) {
      this.motion = 'escape'; this.frank.attach(); this.frank.state = 'falling'; this.elapsed = 0; this.capture = 0; this.sending = false;
    }
    this.frank.worried = state.armed === 'DROP' || state.phase === 'ESCAPE';
  }
  private moveFeet(target: Point, speed: number, dt: number) {
    const f = this.frank;
    const next = moveConstrained({ x: f.x, y: f.y }, stepToward(f, target, speed * dt), 12, 35, 0);
    f.setFeet(next); return near(next, target, 2);
  }
  private recover() {
    const f = this.frank; f.attach(); this.motion = 'recovery'; this.destination = undefined; this.dwell = 0;
    this.recovery = f.x > 585 ? [{ x: 680, y: f.y }, { x: 680, y: 235 }, { x: 440, y: 235 }, { x: 440, y: 400 }, ENTRANCE] : f.x > 280 ? [{ x: 440, y: f.y }, { x: 440, y: 400 }, ENTRANCE] : [ENTRANCE];
  }
  returnToPickup() { if (!this.spectator && this.state?.current && ['DECISIONS', 'INTERROGATION'].includes(this.state.phase)) this.recover(); }
  update(time: number, delta: number) {
    if (!this.frank) return;
    const dt = Math.min(delta / 1000, .0334), s = this.state, f = this.frank, p = this.paddle;
    s?.players.forEach((v, i) => { const parked = this.parked.get(v.id); if (parked && v.id !== s.current) { const z = v.outcome === 'SAVE' ? { x: 772 + i * 38, y: ZONES.SAVE.y } : parked.position.x < 230 ? { x: 45 + i * 36, y: ENTRANCE.y } : parked.position; parked.position = stepToward(parked.position, z, this.paused ? 0 : 45 * dt); parked.label.setPosition(parked.position.x, parked.position.y - 34); } });
    if (this.spectator) {
      if (this.incoming && this.incoming.id === s?.current) { f.setVisible(true); f.setFeet(stepToward(f, this.incoming.position, 1500 * dt)); p.position = stepToward(p.position, this.incoming.paddle, 1500 * dt); p.state = this.incoming.active ? 'tracked' : 'inactive'; this.motion = this.incoming.state as Motion; }
      f.animate(time); this.draw(time); return;
    }
    if (!this.paused && !document.hidden) {
      this.elapsed += dt;
      if (this.mode === 'mouse') this.filter.observe(this.pointer, performance.now() / 1000);
      this.filter.update(performance.now() / 1000, dt);
      p.sanctuary = true;
      p.move(this.filter.target, this.mode === 'idle' ? 'inactive' : this.filter.state, dt);
      if (this.motion === 'entrance') {
        f.setAlpha(Math.min(1, this.elapsed * 2)).setScale(Math.min(1, .7 + this.elapsed));
        f.state = 'boarding'; if (this.moveFeet(ENTRANCE, 90, dt)) { this.motion = 'spawn'; f.state = 'spawn'; }
      } else if (this.motion === 'spawn') {
        f.state = 'spawn'; this.moveFeet({ x: 180, y: 420 }, 50, dt);
        if (p.active && p.position.x >= 190 && p.position.x <= 255 && Math.abs(p.position.y - 420) <= 28 && f.x > 170) { this.motion = 'boarding'; f.state = 'boarding'; f.rider.offset = -25; }
      } else if (this.motion === 'boarding') {
        if (!p.active) { this.motion = 'falling'; f.state = 'falling'; f.release(); }
        else if (this.moveFeet(f.rider.feet(p), 180, dt)) { this.motion = 'riding'; f.state = 'riding'; }
      } else if (this.motion === 'riding') {
        if (!p.active) { this.motion = 'falling'; f.state = 'falling'; f.release(clamp(p.delta.x * 60, -120, 120), 0); }
        else {
          f.rider.walk(clamp(-f.rider.offset, -10 * dt, 10 * dt), p); f.setFeet(f.rider.feet(p));
          if (s?.armed) {
            if (canLand(p.position, s.armed)) {
              this.destination = s.armed; this.motion = 'walking'; f.state = 'exiting'; this.dwell = 0;
            }
          }
        }
      } else if (this.motion === 'walking' && this.destination) {
        if (this.moveFeet(ZONES[this.destination], 180, dt)) { this.motion = 'delivered'; f.state = 'rescued'; this.dwell = 0; }
      } else if (this.motion === 'delivered' && this.destination && s?.armed === this.destination) {
        this.dwell += dt;
        if (this.dwell >= .7 && !this.sending) { this.sending = true; void this.onAction('delivery').then(ok => { if (!ok) this.sending = false; }); }
      } else if (this.motion === 'falling' && f.y >= 510) this.recover();
      else if (this.motion === 'recovery') {
        f.state = 'boarding'; const point = this.recovery[0];
        if (point && this.moveFeet(point, 200, dt)) this.recovery.shift();
        if (!this.recovery.length) {
          this.motion = 'spawn'; f.state = 'spawn';
          if (this.returningActor) {
            if (!this.parked.has(f.id)) this.parked.set(f.id, { position: { x: f.x, y: f.y }, label: this.add.text(f.x, f.y - 34, f.label.text, { fontFamily: 'DM Sans, sans-serif', fontSize: '9px', color: '#d8e5ee' }).setOrigin(.5).setDepth(12) });
            this.returningActor = false; this.motion = 'hidden'; this.actorKey = ''; if (this.state) this.sync(this.state);
          }
        }
      } else if (this.motion === 'escape' && s?.phase === 'ESCAPE') {
        const ready = s.escape === 'active' && p.state === 'tracked';
        if (ready) {
          const input = this.sim.input, length = Math.max(1, Math.hypot(input.x, input.y)), speed = input.dash ? 470 : 195;
          f.setFeet(moveConstrained(f, { x: f.x + input.x / length * speed * dt, y: f.y + input.y / length * speed * dt }, 12, 35, 0));
          const safe = f.x >= SANCTUARY.x && f.y <= SANCTUARY.y + SANCTUARY.h;
          this.capture = !safe && near(f, p.position, 80) ? this.capture + dt : 0;
          if (!this.sending && this.capture >= .48) {
            this.sending = true; void this.onAction('capture', { player: f.id }).then(ok => { this.sending = false; if (ok) { this.motion = 'captured'; f.rider.attach(f, p); } });
          }
          if (!this.sending && this.sim.ring && near({ x: f.x, y: f.y - 18 }, this.sim.ring, 23)) { this.sending = true; void this.onAction('ring', { player: f.id }).then(ok => { if (!ok) this.sending = false; }); }
        } else this.capture = 0;
      } else if (this.motion === 'captured') this.moveFeet(f.rider.feet(p), 220, dt);
    }
    this.frameAccumulator += dt;
    if (s?.current === f.id && !this.returningActor && this.motion !== 'hidden' && this.frameAccumulator >= .05) {
      this.frameAccumulator = 0;
      this.onFrame({ id: f.id, position: { x: f.x, y: f.y }, paddle: { ...p.position }, active: !this.paused && !document.hidden && p.state === 'tracked', riding: this.motion === 'riding', state: this.motion, capture: this.capture, dwell: this.dwell });
    }
    f.animate(time); f.setAngle(s?.phase === 'ESCAPE' && s.escape === 'starting' ? Math.sin(time / 35) * 8 : 0); this.draw(time);
  }
  private draw(time: number) {
    const g = this.art.clear(), p = this.paddle, s = this.state;
    if (p.active && this.mode !== 'idle' || this.spectator && p.active) {
      const { x, y } = p.position;
      g.fillStyle(0x63f5e2, .1).fillRoundedRect(x - 80, y - 5, 160, 24, 10);
      g.fillStyle(0x164851, .85).fillRoundedRect(x - 72, y, 144, 10, 5);
      g.lineStyle(3, 0x8affeb, p.state === 'grace' ? .4 : 1).lineBetween(x - 69, y, x + 69, y);
      if (this.mode === 'camera' && Math.hypot(this.filter.target.x - x, this.filter.target.y - y) > 45) {
        g.lineStyle(1, 0xffd28f, .5).lineBetween(x, y, this.filter.target.x, this.filter.target.y);
        g.lineStyle(1, 0xffd28f, .6).strokeCircle(this.filter.target.x, this.filter.target.y, 7);
      }
    }
    if (this.destination && this.dwell > 0) { const z = ZONES[this.destination]; g.lineStyle(4, 0xa4ffe0).beginPath().arc(z.x, z.y - 21, 27, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, this.dwell / .7)).strokePath(); }
    if (this.capture > 0 && s?.phase === 'ESCAPE') g.lineStyle(3, 0xffa8c2).strokeCircle(this.frank.x, this.frank.y - 18, 30 + Math.sin(time / 50) * 3);
    s?.players.filter(v => v.id !== s.current && (this.parked.has(v.id) || v.outcome === 'SAVE')).forEach((v, i) => {
      const point = this.parked.get(v.id)?.position || { x: 772 + i * 38, y: ZONES.SAVE.y };
      g.fillStyle(v.color).fillRoundedRect(point.x - 7, point.y - 21, 14, 21, 5); g.fillStyle(0x132138).fillCircle(point.x - 3, point.y - 15, 1.3).fillCircle(point.x + 3, point.y - 15, 1.3);
    });
    const current = s?.players.find(v => v.id === s.current);
    this.info.setText(s?.result || (s ? `${s.category || 'TRUST FALL'}  ·  ${s.phase.replaceAll('_', ' ')}${s.phase === 'ESCAPE' ? `  ${s.escapeLeft.toFixed(1)}s` : ''}` : 'CREATE A ROOM TO BEGIN'));
    this.status.setText(this.spectator ? 'PUBLIC BROADCAST' : this.paused ? 'PAUSED · HOST CONTROLS BELOW' : this.mode === 'mouse' ? 'MOUSE TEST MODE · SAME MAZE & RIDER LOGIC' : this.mode === 'camera' ? p.state === 'tracked' ? '● HAND TRACKED' : 'BRING YOUR HAND BACK · HOLDING THE CLOCK' : 'CHOOSE CAMERA OR MOUSE');
    this.bubble.setText(s?.feedback || (this.motion === 'recovery' ? `${current?.name} is returning to pickup…` : current ? `${current.name}: ${current.answer || current.clue || 'Waiting for your question…'}` : 'Four viewers. Three truths. One impostor.'));
  }
}
