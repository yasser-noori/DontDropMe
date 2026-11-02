import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Room, type Player } from '../server/Room';
import { HandPlatform, RiderAttachment } from '../src/game/HandPlatform';
import { WALLS, canLand, moveConstrained, overlaps, ZONES, type Zone } from '../src/shared/maze';
import type { Action } from '../src/shared/protocol';

function action(room: Room, actor: 'host' | Player, type: string, data?: Record<string, unknown>) {
  const command: Action = { id: crypto.randomUUID(), version: room.version, type, data }; room.act(actor, command); return command;
}
function room() { const r = new Room(); r.hostConnected = true; r.players.forEach(p => { p.connected = true; p.ready = true; }); action(r, 'host', 'start'); return r; }
function clues(r: Room) { action(r, 'host', 'clues'); r.active().forEach((p, i) => action(r, p, 'lock', { text: `subtle clue ${i}` })); }
function deliver(r: Room, zone: Zone) {
  action(r, 'host', 'arm', { zone });
  r.acceptFrame({ id: r.current!, position: { ...ZONES[zone] }, paddle: { x: 700, y: ZONES[zone].y }, active: true, riding: false, state: 'delivered', capture: 0, dwell: .8 }, r.frameSeq + 1);
  action(r, 'host', 'delivery');
}
function onHand(r: Room) { r.acceptFrame({ id: r.current!, position: { x: 440, y: 400 }, paddle: { x: 440, y: 400 }, active: true, riding: true, state: 'riding', capture: 0, dwell: 0 }, r.frameSeq + 1); }
function guess(r: Room, text = '') {
  clues(r);
  for (let i = 0; i < 4; i++) { action(r, r.currentPlayer()!, 'answer', { text: 'An ambiguous answer.' }); onHand(r); action(r, 'host', 'next'); }
  action(r, r.players.find(p => p.key === r.impostorKey)!, 'guess', { text });
}
function accuse(r: Room, suspect: Player) {
  for (const p of r.active().filter(p => p !== suspect)) { action(r, 'host', 'choose', { player: p.id }); deliver(r, 'SAVE'); }
  action(r, 'host', 'choose', { player: suspect.id }); deliver(r, 'DROP');
}
function activate(r: Room) { vi.setSystemTime(Date.now() + 800); r.acceptFrame({ ...r.frame!, active: true }, r.frameSeq + 1); r.tick(); expect(r.escape).toBe('active'); }
function escape(r: Room) {
  activate(r); r.acceptFrame({ ...r.frame!, position: { x: r.ring.x, y: r.ring.y + 18 } }, r.frameSeq + 1); action(r, 'host', 'ring', { player: r.current });
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('authoritative Trust Fall round', () => {
  it('assigns exactly one impostor and three informed players', () => {
    for (let i = 0; i < 20; i++) { const r = room(); expect(r.active().map(p => r.privateState(p).role).filter(role => role === 'impostor')).toHaveLength(1); }
  });
  it('projects only the appropriate private information and never leaks secrets to host/public', () => {
    const r = room(), impostor = r.players.find(p => p.key === r.impostorKey)!;
    expect(JSON.stringify(r.publicState())).not.toContain(r.word.word);
    expect(JSON.stringify(r.hostState('https://example.test'))).not.toContain(r.word.word);
    expect(r.publicState().reveal).toBeUndefined(); expect(r.privateState(impostor).word).toBeUndefined();
    expect(r.privateState(impostor).role).toBe('impostor');
    const innocent = r.players.find(p => p !== impostor)!; expect(r.privateState(innocent).word).toBe(r.word.word);
    expect(r.publicState()).not.toHaveProperty('ring'); expect(r.publicState()).not.toHaveProperty('impostorKey');
  });
  it('locks validated clues and rejects URLs and secret word disclosure', () => {
    const r = room(); action(r, 'host', 'clues'); const p = r.players[0];
    expect(() => action(r, p, 'clue', { text: r.word.word.toLowerCase() })).toThrow();
    expect(() => action(r, p, 'clue', { text: 'https://example.com' })).toThrow();
    expect(() => action(r, p, 'clue', { text: 'one two three four' })).toThrow();
    action(r, p, 'clue', { text: '  tiny   hint  ' }); expect(p.clue).toBe('tiny hint');
    action(r, p, 'lock', { text: 'tiny hint' }); expect(() => action(r, p, 'clue', { text: 'replacement' })).toThrow();
    expect(r.publicState().players[0].clue).toBeUndefined();
  });
  it('rejects invalid phase, unauthorized, stale, and premature next actions', () => {
    const r = room(); expect(() => action(r, 'host', 'next')).toThrow();
    expect(() => action(r, r.players[0], 'start')).toThrow();
    expect(() => r.act('host', { id: 'old', version: -1, type: 'clues' })).toThrow();
    clues(r); expect(() => action(r, 'host', 'next')).toThrow();
    expect(() => action(r, r.players.find(p => p.id !== r.current)!, 'answer', { text: 'wrong player' })).toThrow();
  });
  it('enforces three SAVE decisions, one DROP, no duplicates, and pre-drop undo', () => {
    const r = room(); guess(r); action(r, 'host', 'choose', { player: r.players[0].id });
    expect(() => action(r, 'host', 'arm', { zone: 'DROP' })).toThrow();
    deliver(r, 'SAVE'); expect(r.publicState().saved).toBe(1);
    expect(() => action(r, 'host', 'choose', { player: r.players[0].id })).toThrow();
    action(r, 'host', 'undo', { player: r.players[0].id }); expect(r.publicState().saved).toBe(0);
    accuse(r, r.players[0]); expect(r.publicState().saved).toBe(3); expect(r.publicState().dropped).toBe(1);
    expect(() => action(r, 'host', 'undo', { player: r.players[1].id })).toThrow();
  });
  it('activates escape exclusively for the correct impostor with an unused opportunity', () => {
    const right = room(); guess(right); accuse(right, right.players.find(p => p.key === right.impostorKey)!); expect(right.phase).toBe('ESCAPE');
    const wrong = room(); guess(wrong); accuse(wrong, wrong.players.find(p => p.key !== wrong.impostorKey)!); expect(wrong.phase).toBe('REVEAL'); expect(wrong.escape).toBe('inactive'); expect(wrong.result).toContain('DECEPTION');
  });
  it('rejects movement outside the active impostor escape', () => {
    const r = room(), controls = { x: 1, y: -1, dash: true };
    expect(() => r.control(r.players[0], controls)).toThrow(); guess(r); const impostor = r.players.find(p => p.key === r.impostorKey)!; accuse(r, impostor);
    expect(() => r.control(impostor, controls)).toThrow(); activate(r);
    expect(() => r.control(r.players.find(p => p !== impostor)!, controls)).toThrow(); r.control(impostor, controls); expect(r.dashUsed).toBe(true);
  });
  it('requires the active player, phase, timing, and actual ring contact', () => {
    const r = room(); expect(() => action(r, 'host', 'ring', { player: r.players[0].id })).toThrow(); guess(r); accuse(r, r.players.find(p => p.key === r.impostorKey)!); activate(r);
    expect(() => action(r, 'host', 'ring', { player: 'other' })).toThrow();
    expect(() => action(r, 'host', 'ring', { player: r.current })).toThrow();
    expect(() => action(r, r.currentPlayer()!, 'ring', { player: r.current })).toThrow();
    r.acceptFrame({ ...r.frame!, position: { x: r.ring.x, y: r.ring.y + 18 } }, r.frameSeq + 1); action(r, 'host', 'ring', { player: r.current }); expect(r.escape).toBe('escaped');
  });
  it('preserves authenticated identity and impostor assignment through an anonymous rematch', () => {
    const r = room(); guess(r); const impostor = r.players.find(p => p.key === r.impostorKey)!, key = impostor.key, oldId = impostor.id, word = r.word.word;
    accuse(r, impostor); escape(r); expect(r.rematch).toBe(true); action(r, 'host', 'rematch');
    expect(r.impostorKey).toBe(key); expect(impostor.id).not.toBe(oldId); expect(impostor.alias).not.toBe(impostor.name); expect(impostor.escapeSpent).toBe(true); expect(r.word.word).not.toBe(word);
    expect(r.privateState(impostor).realName).toBe(impostor.name);
    expect(r.hostState('https://example.test').candidates.map(p => p.id)).toEqual(r.publicState().players.map(p => p.id));
    expect(r.hostState('https://example.test').links).toBeUndefined();
    expect(JSON.stringify(r.hostState('https://example.test'))).not.toContain(impostor.key);
  });
  it('never grants the returning impostor a second escape', () => {
    const r = room(); guess(r); const impostor = r.players.find(p => p.key === r.impostorKey)!; accuse(r, impostor); escape(r); action(r, 'host', 'rematch'); guess(r); accuse(r, impostor);
    expect(r.phase).toBe('REVEAL'); expect(r.result).toContain('ELIMINATED'); expect(r.escape).toBe('inactive');
  });
  it('lets a correct normalized word guess override either deduction outcome', () => {
    for (const correctAccusation of [true, false]) {
      const r = room(); guess(r, `  ${r.word.word.toLowerCase()}!!! `); const suspect = r.players.find(p => (p.key === r.impostorKey) === correctAccusation)!; accuse(r, suspect);
      expect(r.result).toBe('IMPOSTOR WINS BY GUESSING'); expect(r.phase).toBe('REVEAL'); expect(r.rematch).toBe(false); expect(r.escape).toBe('inactive');
    }
  });
  it('deduplicates Socket.IO action IDs so SAVE cannot be committed twice', () => {
    const r = room(); guess(r); action(r, 'host', 'choose', { player: r.players[0].id }); action(r, 'host', 'arm', { zone: 'SAVE' });
    r.acceptFrame({ id: r.current!, position: ZONES.SAVE, paddle: { x: 700, y: 345 }, active: true, riding: false, state: 'delivered', capture: 0, dwell: .8 }, r.frameSeq + 1);
    const command = action(r, 'host', 'delivery'); expect(() => r.act('host', command)).toThrow('Duplicate'); expect(r.publicState().saved).toBe(1);
  });
  it('pauses escape on host/tracking loss and requires sustained capture contact', () => {
    const r = room(); guess(r); accuse(r, r.players.find(p => p.key === r.impostorKey)!); activate(r);
    r.hostConnected = false; const before = r.escapeLeft; vi.setSystemTime(Date.now() + 5000); r.tick(); expect(r.escapeLeft).toBe(before);
    r.hostConnected = true; r.tracking = false; r.tick(); expect(r.escapeLeft).toBe(before);
    r.acceptFrame({ ...r.frame!, active: true, paddle: { ...r.frame!.position } }, r.frameSeq + 1);
    expect(() => action(r, 'host', 'capture', { player: r.current })).toThrow();
    vi.setSystemTime(Date.now() + 450); r.acceptFrame({ ...r.frame!, active: true }, r.frameSeq + 1); r.tick(); action(r, 'host', 'capture', { player: r.current }); expect(r.escape).toBe('captured');
  });
  it('counts verified advisory voters once, replaces votes, and resets each voting window', () => {
    const r = room(); r.mode = 'twitch'; clues(r); r.twitchConnected = true;
    r.vote('viewer1', 'trust'); expect(r.currentPlayer()!.votes.trust).toBe(0);
    action(r, 'host', 'voting'); r.vote('viewer1', 'trust'); r.vote('viewer1', 'drop'); r.vote('viewer2', 'trust');
    expect(r.currentPlayer()!.votes).toEqual({ trust: 1, drop: 1 });
    r.twitchConnected = false; r.vote('viewer3', 'trust'); expect(r.currentPlayer()!.votes.trust).toBe(1);
    action(r, r.currentPlayer()!, 'answer', { text: 'A response' }); onHand(r); action(r, 'host', 'next');
    expect(r.voteMap.size).toBe(0); expect(r.votingOpen).toBe(false); expect(r.currentPlayer()!.votes).toEqual({ trust: 0, drop: 0 });
  });
  it('never creates duplicate entries for the same verified Twitch account', () => {
    const r = new Room('twitch'); const first = r.addPlayer('Original name', 'verified-account-id');
    expect(r.addPlayer('New display name', 'verified-account-id')).toBe(first); expect(r.players).toHaveLength(1);
  });
});

describe('fixed S maze', () => {
  it('substeps movement so neither extreme targets nor repeated frames tunnel the paddle', () => {
    let p = { x: 200, y: 200 };
    for (let i = 0; i < 50; i++) p = moveConstrained(p, { x: 900, y: 200 });
    expect(p.x).toBeLessThanOrEqual(228); expect(WALLS.some(w => overlaps(p, 72, 38, 10, w))).toBe(false);
    p = moveConstrained(p, { x: p.x, y: 400 }); p = moveConstrained(p, { x: 440, y: 400 }); p = moveConstrained(p, { x: 440, y: 240 }); p = moveConstrained(p, { x: 680, y: 240 });
    expect(p.x).toBeCloseTo(680); expect(p.y).toBeCloseTo(240);
  });
  it('carries the attached rider using constrained displacement exactly once', () => {
    const p = new HandPlatform(); p.maze = true; p.position = { x: 200, y: 200 }; const rider = new RiderAttachment(); rider.attach({ x: 210, y: 200 }, p);
    for (let i = 0; i < 600; i++) { p.move({ x: 900, y: 200 }, 'tracked', 1 / 60); const f = rider.feet(p); expect(f.x - p.position.x).toBeCloseTo(10); expect(f.y).toBe(p.position.y); }
    expect(p.position.x).toBeLessThanOrEqual(228);
  });
  it('blocks the hand at sanctuary boundaries while the character can enter', () => {
    const from = { x: 680, y: 145 }, target = { x: 850, y: 145 };
    expect(moveConstrained(from, target, 72, 38, 10, true).x).toBeLessThanOrEqual(688);
    expect(moveConstrained(from, target, 12, 35, 0).x).toBeCloseTo(850);
  });
  it('accepts SAVE and DROP landings along the entire visible ledge, including the far right', () => {
    for (const zone of ['SAVE', 'DROP'] as const) {
      for (const x of [670, 755, 800, 850, 888]) expect(canLand({ x, y: ZONES[zone].y + 35 }, zone)).toBe(true);
      expect(canLand({ x: 440, y: ZONES[zone].y }, zone)).toBe(false);
      expect(canLand({ x: 800, y: ZONES[zone].y + 41 }, zone)).toBe(false);
    }
  });
});

describe('explicit solo demo', () => {
  function step(r: Room) { vi.setSystemTime(Date.now() + 1100); r.tick(); }
  it('readies four simulated players, locks clues, answers turns and passes without player pages', () => {
    const r = new Room('local', true); r.hostConnected = true;
    step(r); expect(r.phase).toBe('ROLE_DELIVERY'); expect(r.active()).toHaveLength(4);
    expect(r.active().every(p => p.ready && p.connected)).toBe(true);
    step(r); for (let i = 0; i < 4; i++) step(r);
    expect(r.phase).toBe('INTERROGATION'); expect(r.publicState().clueCount).toBe(4);
    expect(r.active().every(p => p.locked && p.clue.length <= 32)).toBe(true);
    for (let i = 0; i < 4; i++) {
      onHand(r); step(r); expect(r.currentPlayer()!.answer).not.toBe('');
      if (i < 3) { deliver(r, 'SAVE'); step(r); } else action(r, 'host', 'next');
    }
    expect(r.phase).toBe('IMPOSTOR_GUESS'); step(r); expect(r.phase).toBe('DECISIONS');
    expect(r.guessLocked).toBe(true); expect(r.guessed).toBe(false);
    expect(r.publicState().demo).toBe(true); expect(r.hostState('http://localhost').links).toBeUndefined();
    expect(JSON.stringify(r.publicState())).not.toContain(r.word.word);
    for (const p of r.players.filter(p => p.outcome === 'SAVE')) action(r, 'host', 'undo', { player: p.id });
    const impostor = r.players.find(p => p.key === r.impostorKey)!; accuse(r, impostor); activate(r);
    vi.setSystemTime(Date.now() + 100); r.acceptFrame({ ...r.frame! }, r.frameSeq + 1); r.tick();
    expect(r.input.y).toBe(-1); expect(r.dashUsed).toBe(true);
  });
  it('does not automate normal rooms or advance a paused/disconnected demo', () => {
    const normal = new Room(); normal.hostConnected = true; step(normal); expect(normal.phase).toBe('LOBBY');
    const demo = new Room('local', true); step(demo); expect(demo.phase).toBe('LOBBY');
    demo.hostConnected = true; demo.paused = true; step(demo); expect(demo.phase).toBe('LOBBY');
    demo.paused = false; step(demo); expect(demo.phase).toBe('ROLE_DELIVERY');
  });
  it('rejects demo bots in Twitch rooms and never replaces connected local players', () => {
    expect(() => new Room('twitch', true)).toThrow();
    const r = new Room(); r.hostConnected = true; r.players[0].connected = true;
    expect(() => action(r, 'host', 'demo')).toThrow('empty local lobby');
    r.players[0].connected = false; action(r, 'host', 'demo'); step(r); expect(r.phase).toBe('ROLE_DELIVERY');
  });
});

describe('interrogate on the hand, then land directly', () => {
  it('saves during interrogation and keeps the final rider through guess and DROP', () => {
    const r = room(); clues(r);
    for (let i = 0; i < 3; i++) {
      onHand(r); action(r, r.currentPlayer()!, 'answer', { text: 'Answering on the hand.' });
      deliver(r, 'SAVE'); expect(r.publicState().saved).toBe(i + 1); expect(r.phase).toBe('INTERROGATION'); action(r, 'host', 'next');
    }
    onHand(r); action(r, r.currentPlayer()!, 'answer', { text: 'Last on-hand answer.' });
    const last = r.current; action(r, 'host', 'arm', { zone: 'DROP' }); expect(r.phase).toBe('IMPOSTOR_GUESS'); expect(r.current).toBe(last);
    action(r, r.players.find(p => p.key === r.impostorKey)!, 'guess', { text: '' });
    expect(r.current).toBe(last); expect(r.armed).toBe('DROP'); expect(r.frame?.riding).toBe(true);
    deliver(r, 'DROP'); expect(r.publicState().saved).toBe(3); expect(r.publicState().dropped).toBe(1);
  });
  it('does not burn the answer timer while the player waits to be picked up', () => {
    const r = room(); clues(r); const before = r.timer;
    vi.setSystemTime(Date.now() + 10_000); r.tick(); expect(r.timer).toBe(before); expect(r.paused).toBe(false);
    onHand(r); vi.setSystemTime(Date.now() + 100); r.tick(); expect(r.timer).toBeLessThan(before);
  });
});
