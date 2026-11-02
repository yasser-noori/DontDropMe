import Matter from 'phaser/src/physics/matter-js/CustomMain';
import { DESTINATION_LEDGE, FLOATING_PLATFORMS, ZONES, type Vec } from '../shared/maze';

const { Bodies, Body, Composite, Engine, Events, Query } = Matter;
export type ToyKind = 'block' | 'triangle' | 'ball';
export type ToyPiece = { body: MatterJS.BodyType; kind: ToyKind; tower: number; start: Vec; hitAt: number; removed: boolean };

/** An independently stepped rigid-body world: real rotation, contact and rolling. */
export class ToyPhysics {
  readonly pieces: ToyPiece[] = [];
  private engine = Engine.create({ positionIterations: 8, velocityIterations: 8, enableSleeping: true });
  private actor = Bodies.rectangle(-100, -100, 22, 34, { friction: .12, frictionAir: 0, restitution: .04, collisionFilter: { category: 4, mask: 2, group: 0 } });
  private broken = new Set<number>();
  private time = 0;
  private active = false;
  private resistance = 0;
  private impactDirection: Vec = { x: 0, y: 0 };

  constructor() {
    this.engine.gravity.y = 1; this.engine.gravity.scale = .00065;
    Body.setMass(this.actor, 1.4); Body.setInertia(this.actor, Infinity);
    const ledges = [...FLOATING_PLATFORMS, { x: 35, y: 420, w: 165, h: 18 },
      ...Object.values(ZONES).map(z => ({ x: DESTINATION_LEDGE.x, y: z.y, w: DESTINATION_LEDGE.w, h: 18 })),
      { x: 0, y: 530, w: 960, h: 40 }];
    for (const p of ledges) Composite.add(this.engine.world, Bodies.rectangle(p.x + p.w / 2, p.y + p.h / 2, p.w, p.h, { isStatic: true, friction: .45, restitution: .12, collisionFilter: { category: 1, mask: 2, group: 0 } }));
    FLOATING_PLATFORMS.forEach((platform, tower) => {
      const center = platform.x + platform.w / 2;
      if (tower === 0) {
        for (let row = 0; row < 4; row++) this.add(center + (row % 2 ? 3 : -3), platform.y - 10 - row * 20, tower, 'block');
      } else {
        const spacing = tower === 2 ? 22 : 24, rise = tower === 2 ? 19.1 : 22;
        for (let row = 0; row < 3; row++) for (let col = 0; col < 3 - row; col++) {
          this.add(center + (col - (2 - row) / 2) * spacing, platform.y - (tower === 2 ? 11 : 7.33) - row * rise, tower, tower === 1 ? 'triangle' : 'ball');
        }
      }
    });
    Composite.add(this.engine.world, this.actor);
    // Release only the contacted tower before the solver calculates mass response.
    Events.on(this.engine, 'beforeSolve', () => {
      if (!this.active) return;
      for (const piece of this.pieces) if (!piece.removed && !this.broken.has(piece.tower) && Query.collides(this.actor, [piece.body]).length) {
        this.broken.add(piece.tower);
        const speed = Math.hypot(this.actor.velocity.x, this.actor.velocity.y);
        if (speed > .1) {
          this.impactDirection = { x: this.actor.velocity.x / speed, y: this.actor.velocity.y / speed };
          this.resistance = Math.min(.3, Math.max(.12, speed / 16));
        }
        for (const member of this.pieces.filter(p => p.tower === piece.tower)) {
          Body.setStatic(member.body, false); member.hitAt = this.time;
          Matter.Sleeping.set(member.body, false);
          // A gentle destabilizing nudge starts the collapse even on slow contact.
          const direction = Math.abs(this.actor.velocity.x) > .1 ? Math.sign(this.actor.velocity.x) : (member.body.position.x >= this.actor.position.x ? 1 : -1);
          Body.setVelocity(member.body, { x: direction * (member === piece ? 1.8 : .65), y: 0 });
          Body.setAngularVelocity(member.body, direction * (member.kind === 'ball' ? .025 : .045));
        }
      }
    });
  }

  private add(x: number, y: number, tower: number, kind: ToyKind) {
    const options = { friction: kind === 'ball' ? .025 : .12, frictionStatic: .16, frictionAir: .006, restitution: kind === 'ball' ? .3 : .2, sleepThreshold: 90, collisionFilter: { category: 2, mask: 7, group: 0 } };
    const body = kind === 'ball' ? Bodies.circle(x, y, 11, options)
      : kind === 'triangle' ? Bodies.fromVertices(x, y, [[{ x: 0, y: -14.67 }, { x: 11, y: 7.33 }, { x: -11, y: 7.33 }]], options)
      : Bodies.rectangle(x, y, 36, 20, { ...options, chamfer: { radius: 2 } });
    Body.setMass(body, kind === 'block' ? .16 : kind === 'triangle' ? .12 : .09);
    Body.setStatic(body, true);
    this.pieces.push({ body, kind, tower, start: { x, y }, hitAt: -Infinity, removed: false });
    Composite.add(this.engine.world, body);
  }

  reset() {
    this.time = 0; this.broken.clear(); Engine.clear(this.engine);
    for (const piece of this.pieces) {
      if (piece.removed) Composite.add(this.engine.world, piece.body);
      Body.setStatic(piece.body, false); Body.setPosition(piece.body, piece.start); Body.setAngle(piece.body, 0);
      Body.setVelocity(piece.body, { x: 0, y: 0 }); Body.setAngularVelocity(piece.body, 0);
      Matter.Sleeping.set(piece.body, false); Body.setStatic(piece.body, true);
      piece.hitAt = -Infinity; piece.removed = false;
    }
    this.active = false; this.resistance = 0; this.actor.collisionFilter.mask = 0;
    Composite.setModified(this.engine.world, true, false, false);
  }

  step(dt: number, from: Vec, target: Vec, active: boolean): Vec {
    if (dt <= 0) return { ...target };
    const elapsed = Math.min(dt, .05), count = Math.ceil(elapsed * 120), step = elapsed / count;
    this.active = active; this.actor.collisionFilter.mask = active ? 2 : 0;
    if (!active) this.resistance = 0;
    Body.setPosition(this.actor, { x: from.x, y: from.y - 17 });
    Matter.Sleeping.set(this.actor, false);
    const travel = { x: target.x - from.x, y: target.y - from.y };
    for (let i = 0; i < count; i++) {
      this.time += step;
      // A finite-mass motor follows the hand. The solver takes movement away on contact.
      const motor = { x: travel.x / elapsed / 60, y: travel.y / elapsed / 60 };
      const into = Math.max(0, motor.x * this.impactDirection.x + motor.y * this.impactDirection.y);
      Body.setVelocity(this.actor, { x: motor.x - this.impactDirection.x * into * this.resistance, y: motor.y - this.impactDirection.y * into * this.resistance });
      // Short hand drag makes impact readable; pulling away stays responsive.
      this.resistance *= Math.exp(-step / .09);
      this.actor.force.y = -this.actor.mass * this.engine.gravity.y * this.engine.gravity.scale;
      Engine.update(this.engine, step * 1000);
      for (const p of this.pieces) if (!p.body.isStatic && !p.removed) {
        // Preserve falling and rolling, but cap the energy of fast hand swipes.
        Body.setVelocity(p.body, { x: Math.max(-4.2, Math.min(4.2, p.body.velocity.x)), y: Math.max(-3, Math.min(12, p.body.velocity.y)) });
        Body.setAngularVelocity(p.body, Math.max(-.11, Math.min(.11, p.body.angularVelocity)));
        if (this.time - p.hitAt > 7 || p.body.position.y > 650) { Composite.remove(this.engine.world, p.body); p.removed = true; }
      }
    }
    return active ? { x: this.actor.position.x, y: this.actor.position.y + 17 } : { ...target };
  }

  alpha(piece: ToyPiece) { return piece.hitAt === -Infinity ? 1 : Math.max(0, 1 - Math.max(0, this.time - piece.hitAt - 5.8) / 1.2); }
  destroy() { Composite.clear(this.engine.world, false); Engine.clear(this.engine); }
}
