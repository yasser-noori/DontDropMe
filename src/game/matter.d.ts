declare module 'phaser/src/physics/matter-js/CustomMain' {
  // Phaser's bundled declarations predate its Engine.gravity / Query.collides API.
  type Engine = { world: MatterJS.CompositeType; gravity: { x: number; y: number; scale: number } };
  const Matter: {
    Bodies: typeof MatterJS.Bodies;
    Body: typeof MatterJS.Body;
    Composite: typeof MatterJS.Composite;
    Sleeping: typeof MatterJS.Sleeping;
    Query: { collides(body: MatterJS.BodyType, bodies: MatterJS.BodyType[]): MatterJS.ICollisionData[] };
    Events: { on(engine: Engine, event: string, callback: () => void): void };
    Engine: {
      create(options: MatterJS.IEngineDefinition): Engine;
      update(engine: Engine, delta: number): void;
      clear(engine: Engine): void;
    };
  };
  export default Matter;
}
