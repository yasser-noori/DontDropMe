import { ESCAPE_COUNTDOWN, ESCAPE_RUN_SECONDS, escapePoint } from '../src/shared/escape';
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
  r.acceptFrame({ id: r.current!, position: { ...ZONES[zone] }, paddle: { x: 700, y: ZONES[zone].y }, active: true, riding: false, state: 'delivered', capture: 0, dwell: .8 }, r.frameSeq + 1);
  action(r, 'host', 'delivery');
}
function onHand(r: Room) { r.acceptFrame({ id: r.current!, position: { x: 440, y: 400 }, paddle: { x: 440, y: 400 }, active: true, riding: true, state: 'riding', capture: 0, dwell: 0 }, r.frameSeq + 1); }
function guess(r: Room, text = '') {
  clues(r);
  for (let i = 0; i < r.active().length; i++) { action(r, r.currentPlayer()!, 'answer', { text: 'An ambiguous answer.' }); onHand(r); action(r, 'host', 'next'); }
  action(r, r.players.find(p => p.key === r.impostorKey)!, 'guess', { text });
}
function accuse(r: Room, suspect: Player) {
  for (const p of r.active().filter(p => p !== suspect)) { action(r, 'host', 'choose', { player: p.id }); deliver(r, 'SAVE'); }
  action(r, 'host', 'choose', { player: suspect.id }); deliver(r, 'DROP');
}
function activate(r: Room) { for (let i = 0; i < ESCAPE_COUNTDOWN * 4 + 1; i++) { vi.setSystemTime(Date.now() + 250); r.acceptFrame({ ...r.frame!, active: true }, r.frameSeq + 1); r.tick(); } expect(r.escape).toBe('active'); }
function runEscape(r: Room) { while (12 - r.escapeLeft < ESCAPE_RUN_SECONDS) { vi.setSystemTime(Date.now() + 250); r.acceptFrame({ ...r.frame!, active: true, position: escapePoint((12 - r.escapeLeft) / ESCAPE_RUN_SECONDS) }, r.frameSeq + 1); r.tick(); } }
function escape(r: Room) {
  activate(r); runEscape(r); r.acceptFrame({ ...r.frame!, position: { x: r.ring.x, y: r.ring.y + 18 } }, r.frameSeq + 1); action(r, 'host', 'ring', { player: r.current });
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('authoritative Trust Fall round', () => {
  it('reveals clues one at a time only when the current player rides an active hand', () => {
    const r = room(); clues(r); const first = r.currentPlayer()!;
    expect(r.publicState().players.every(p => p.clue === undefined)).toBe(true);
    expect(r.privateState(first).clue).toBe(first.clue);
    r.acceptFrame({ id: first.id, position: { x: 440, y: 400 }, paddle: { x: 440, y: 400 }, active: true, riding: false, state: 'boarding', capture: 0, dwell: 0 }, r.frameSeq + 1);
    expect(r.publicState().players.every(p => p.clue === undefined)).toBe(true);
    r.paused = true; onHand(r); expect(r.publicState().players.every(p => p.clue === undefined)).toBe(true);
    r.paused = false;
    r.acceptFrame({ ...r.frame!, active: false }, r.frameSeq + 1);
    expect(r.publicState().players.every(p => p.clue === undefined)).toBe(true);
    onHand(r);
    expect(r.publicState().players.filter(p => p.clue).map(p => p.id)).toEqual([first.id]);
    action(r, first, 'answer', { text: 'My answer.' }); action(r, 'host', 'next');
    expect(r.publicState().players.filter(p => p.clue)).toHaveLength(1);
    onHand(r);
    expect(r.publicState().players.filter(p => p.clue)).toHaveLength(2);
    action(r, 'host', 'restart'); r.players.forEach(p => p.ready = true); action(r, 'host', 'start'); clues(r);
    expect(r.publicState().players.every(p => p.clue === undefined)).toBe(true);
  });
  it('allows a first-turn DROP after answering, preserves the guess, then resolves without three SAVEs', () => {
    const r = room(); clues(r); const first = r.currentPlayer()!;
    onHand(r); action(r, first, 'answer', { text: 'My first answer.' });
    deliver(r, 'DROP');
    expect(r.phase).toBe('IMPOSTOR_GUESS'); expect(r.current).toBe(first.id);
    expect(r.publicState().saved).toBe(0);
    action(r, r.players.find(p => p.key === r.impostorKey)!, 'guess', { text: '' });
    deliver(r, 'DROP');
    expect(r.publicState().dropped).toBe(1);
    expect(r.phase).toBe(first.key === r.impostorKey ? 'ESCAPE' : 'INTERROGATION');
  });
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
  it('enforces SAVE limits, one DROP, no duplicates, and pre-drop undo', () => {
    const r = room(); guess(r); action(r, 'host', 'choose', { player: r.players[0].id });
    deliver(r, 'SAVE'); expect(r.publicState().saved).toBe(1);
    expect(() => action(r, 'host', 'choose', { player: r.players[0].id })).toThrow();
    action(r, 'host', 'undo', { player: r.players[0].id }); expect(r.publicState().saved).toBe(0);
    accuse(r, r.players[0]); expect(r.publicState().saved).toBe(3); expect(r.publicState().dropped).toBe(1);
    expect(() => action(r, 'host', 'undo', { player: r.players[1].id })).toThrow();
  });
  it('activates escape exclusively for the correct impostor with an unused opportunity', () => {
    const right = room(); guess(right); accuse(right, right.players.find(p => p.key === right.impostorKey)!); expect(right.phase).toBe('ESCAPE');
    const wrong = room(); guess(wrong); accuse(wrong, wrong.players.find(p => p.key !== wrong.impostorKey)!); expect(wrong.phase).toBe('ROUND_END'); expect(wrong.escape).toBe('inactive'); expect(wrong.result).toBe('IMPOSTOR IS STILL PRESENT'); expect(wrong.publicState().reveal).toBeUndefined();
  });

  it('announces surviving impostor without revealing identity and automatically requeues only good-cave survivors', () => {
    const r = room(); guess(r);
    const impostor = r.players.find(p => p.key === r.impostorKey)!, suspect = r.players.find(p => p !== impostor)!;
    const oldWord = r.word.word, impostorKey = r.impostorKey, tokens = r.active().filter(p => p !== suspect).map(p => p.token);
    accuse(r, suspect);
    expect(r.phase).toBe('ROUND_END'); expect(r.round).toBe(1);
    expect(r.publicState().reveal).toBeUndefined();
    expect(JSON.stringify(r.publicState())).not.toContain(oldWord);
    expect(r.publicState().saved).toBe(3);
    r.paused = true;
    for (let i = 0; i < 40; i++) { vi.setSystemTime(Date.now() + 250); r.tick(); }
    expect(r.round).toBe(1);
    r.paused = false; r.hostConnected = false;
    for (let i = 0; i < 40; i++) { vi.setSystemTime(Date.now() + 250); r.tick(); }
    expect(r.round).toBe(1);
    r.hostConnected = true;
    for (let i = 0; i < 100 && r.phase === 'ROUND_END'; i++) { vi.setSystemTime(Date.now() + 250); r.tick(); }
    expect(r.round).toBe(2); expect(r.phase).toBe('ROLE_DELIVERY');
    expect(r.active()).toHaveLength(3); expect(r.active().map(p => p.token).sort()).toEqual(tokens.sort());
    expect(r.impostorKey).toBe(impostorKey); expect(r.word.word).not.toBe(oldWord);
    expect(r.privateState(suspect).role).toBeUndefined();
    expect(r.privateState(impostor).role).toBe('impostor'); expect(r.privateState(impostor).word).toBeUndefined();
    expect(r.active().every(p => !p.outcome && !p.clue && !p.answer && !p.locked && !p.delivered)).toBe(true);
    expect(r.positions.size).toBe(0); expect(r.order).toHaveLength(3);
    guess(r); accuse(r, r.active().find(p => p.key !== impostorKey)!);
    expect(r.phase).toBe('ROUND_END'); expect(r.publicState().saved).toBe(2);
    for (let i = 0; i < 100 && r.phase === 'ROUND_END'; i++) { vi.setSystemTime(Date.now() + 250); r.tick(); }
    expect(r.round).toBe(3); expect(r.active()).toHaveLength(2);
  });
  it('keeps interviews running after an early wrong DROP until everyone else reaches the good cave', () => {
    const r = room(); clues(r);
    r.impostorKey = r.active().find(p => p.id !== r.current)!.key;
    const suspect = r.currentPlayer()!;
    onHand(r); action(r, suspect, 'answer', { text: 'A first answer' }); deliver(r, 'DROP');
    action(r, r.players.find(p => p.key === r.impostorKey)!, 'guess', { text: '' }); deliver(r, 'DROP');
    expect(r.phase).toBe('INTERROGATION'); expect(r.result).toBeUndefined(); expect(r.round).toBe(1);
    for (let i = 0; i < 3; i++) {
      action(r, r.currentPlayer()!, 'answer', { text: 'Still playing' }); deliver(r, 'SAVE');
      if (i < 2) action(r, 'host', 'next');
    }
    expect(r.phase).toBe('ROUND_END'); expect(r.publicState().saved).toBe(3);
    expect(() => action(r, 'host', 'undo', { player: r.active().find(p => p.outcome === 'SAVE')!.id })).toThrow();
  });
  it('gives the escape instructions their reading time and freezes the countdown on pause or tracking loss', () => {
    const r = room(); guess(r); accuse(r, r.players.find(p => p.key === r.impostorKey)!);
    expect(r.publicState().escapeCountdown).toBe(ESCAPE_COUNTDOWN);
    expect(r.publicState().escapeProgress).toBe(0);
    for (let i = 0; i < 12; i++) { vi.setSystemTime(Date.now() + 250); r.acceptFrame({ ...r.frame!, active: true }, r.frameSeq + 1); r.tick(); }
    expect(r.escape).toBe('starting'); expect(r.publicState().escapeCountdown).toBe(ESCAPE_COUNTDOWN - 3); expect(r.escapeLeft).toBe(12);
    r.paused = true; vi.setSystemTime(Date.now() + 3000); r.tick(); expect(r.publicState().escapeCountdown).toBe(ESCAPE_COUNTDOWN - 3);
    r.paused = false; r.tracking = false; vi.setSystemTime(Date.now() + 3000); r.tick(); expect(r.publicState().escapeCountdown).toBe(ESCAPE_COUNTDOWN - 3);
    expect(() => action(r, 'host', 'capture', { player: r.current })).toThrow();
    for (let i = 0; i < (ESCAPE_COUNTDOWN - 3) * 4; i++) { vi.setSystemTime(Date.now() + 250); r.acceptFrame({ ...r.frame!, active: true }, r.frameSeq + 1); r.tick(); }
    expect(r.escape).toBe('active'); expect(r.publicState().escapeProgress).toBe(0);
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
    runEscape(r); r.acceptFrame({ ...r.frame!, position: { x: r.ring.x, y: r.ring.y + 18 } }, r.frameSeq + 1); action(r, 'host', 'ring', { player: r.current }); expect(r.escape).toBe('escaped');
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
    const r = room(); guess(r); action(r, 'host', 'choose', { player: r.players[0].id });
    r.acceptFrame({ id: r.current!, position: ZONES.SAVE, paddle: { x: 700, y: 345 }, active: true, riding: false, state: 'delivered', capture: 0, dwell: .8 }, r.frameSeq + 1);
    const command = action(r, 'host', 'delivery'); expect(() => r.act('host', command)).toThrow('Duplicate'); expect(r.publicState().saved).toBe(1);
  });
  it('pauses escape on host/tracking loss and requires sustained capture contact', () => {
    const r = room(); guess(r); accuse(r, r.players.find(p => p.key === r.impostorKey)!); activate(r);
    r.hostConnected = false; const before = r.escapeLeft; vi.setSystemTime(Date.now() + 5000); r.tick(); expect(r.escapeLeft).toBe(before);
    r.hostConnected = true; r.tracking = false; r.tick(); expect(r.escapeLeft).toBe(before);
    r.acceptFrame({ ...r.frame!, active: true, paddle: { ...r.frame!.position } }, r.frameSeq + 1);
    expect(() => action(r, 'host', 'capture', { player: r.current })).toThrow();
    r.acceptFrame({ ...r.frame!, pinch: { thumb: { x: r.frame!.position.x - 5, y: r.frame!.position.y - 18 }, index: { x: r.frame!.position.x + 5, y: r.frame!.position.y - 18 }, ratio: .2 } }, r.frameSeq + 1);
    vi.setSystemTime(Date.now() + 450); r.acceptFrame({ ...r.frame!, active: true }, r.frameSeq + 1); r.tick(); action(r, 'host', 'capture', { player: r.current }); expect(r.escape).toBe('captured');
    expect(r.phase).toBe('ESCAPE'); expect(r.result).toBeUndefined();
    r.acceptFrame({ ...r.frame!, state: 'captured', position: { x: 500, y: 350 }, dwell: .8 }, r.frameSeq + 1);
    expect(() => action(r, 'host', 'returnCaptured', { player: r.current })).toThrow();
    r.acceptFrame({ ...r.frame!, position: { ...ZONES.DROP }, dwell: .1 }, r.frameSeq + 1);
    expect(() => action(r, 'host', 'returnCaptured', { player: r.current })).toThrow();
    r.acceptFrame({ ...r.frame!, dwell: .8 }, r.frameSeq + 1);
    action(r, 'host', 'returnCaptured', { player: r.current });
    expect(r.phase).toBe('REVEAL'); expect(r.result).toBe('STREAMER WINS · IMPOSTOR RETURNED');

  });
  it('counts verified advisory voters once, replaces votes, and resets each voting window', () => {
    const r = room(); r.mode = 'twitch'; clues(r); r.twitchConnected = true;
    r.vote('viewer1', 'trust'); expect(r.currentPlayer()!.votes.trust).toBe(0);
    expect(() => action(r, 'host', 'voting')).toThrow(); onHand(r);
    expect(r.votingOpen).toBe(true); r.vote('viewer1', 'trust'); r.vote('viewer1', 'drop'); r.vote('viewer2', 'trust');
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

describe('open playground movement', () => {
  it('clears every turn with the full hand and rider, reaching both landing zones and returning', () => {
    for (const zone of ['SAVE', 'DROP'] as const) {
      let p = { x: 220, y: 420 };
      const route = [{ x: 220, y: 400 }, { x: 440, y: 400 }, { x: 440, y: 240 }, { x: 750, y: 240 }, { x: 750, y: ZONES[zone].y }, { x: 800, y: ZONES[zone].y }];
      for (const target of [...route, ...route.slice(0, -1).reverse(), { x: 220, y: 420 }]) {
        p = moveConstrained(p, target, 72, 38, 10);
        expect(p.x).toBeCloseTo(target.x); expect(p.y).toBeCloseTo(target.y);
        expect(WALLS.some(w => overlaps(p, 72, 38, 10, w))).toBe(false);
      }
    }
  });
  it('allows direct travel through former wall positions while retaining world bounds', () => {
    let p = { x: 200, y: 200 };
    for (let i = 0; i < 50; i++) p = moveConstrained(p, { x: 900, y: 200 });
    expect(p.x).toBeGreaterThan(880); expect(p.x).toBeLessThanOrEqual(888); expect(WALLS.some(w => overlaps(p, 72, 38, 10, w))).toBe(false);
    p = moveConstrained(p, { x: p.x, y: 400 }); p = moveConstrained(p, { x: 440, y: 400 }); p = moveConstrained(p, { x: 440, y: 240 }); p = moveConstrained(p, { x: 680, y: 240 });
    expect(p.x).toBeCloseTo(680); expect(p.y).toBeCloseTo(240);
  });
  it('carries the attached rider using constrained displacement exactly once', () => {
    const p = new HandPlatform(); p.maze = true; p.position = { x: 200, y: 200 }; const rider = new RiderAttachment(); rider.attach({ x: 210, y: 200 }, p);
    p.collisionOffset = rider.offset;
    for (let i = 0; i < 600; i++) { p.move({ x: 900, y: 200 }, 'tracked', 1 / 60); const f = rider.feet(p); expect(f.x - p.position.x).toBeCloseTo(10); expect(f.y).toBe(p.position.y); }
    expect(p.position.x).toBeCloseTo(900);
    expect(rider.feet(p).x).toBeCloseTo(910);
    expect(WALLS.some(w => overlaps(rider.feet(p), 11, 36, 0, w))).toBe(false);
  });
  it('blocks the hand at sanctuary boundaries while the character can enter', () => {
    const from = { x: 680, y: 145 }, target = { x: 850, y: 145 };
    expect(moveConstrained(from, target, 72, 38, 10, true).x).toBeLessThanOrEqual(688);
    expect(moveConstrained(from, target, 12, 35, 0).x).toBeCloseTo(850);
  });
  it('accepts SAVE and DROP landings along the entire visible ledge, including the far right', () => {
    for (const zone of ['SAVE', 'DROP'] as const) {
      for (const x of [700, 785, 850, 888]) expect(canLand({ x, y: ZONES[zone].y + 35 }, zone)).toBe(true);
      expect(canLand({ x: 440, y: ZONES[zone].y }, zone)).toBe(false);
      expect(canLand({ x: 800, y: ZONES[zone].y + 41 }, zone)).toBe(false);
    }
  });
});

describe('explicit solo demo', () => {
  function step(r: Room, seconds = 1.1, riding = false) {
    for (let i = 0; i < Math.ceil(seconds * 10); i++) { vi.setSystemTime(Date.now() + 100); if (riding) onHand(r); r.tick(); }
  }
  function until(r: Room, ready: () => boolean, riding = false) {
    for (let i = 0; i < 1200 && !ready(); i++) step(r, .1, riding);
    expect(ready()).toBe(true);
  }
  it('readies four simulated players, locks clues, answers turns and passes without player pages', () => {
    const r = new Room('local', true); r.hostConnected = true;
    until(r, () => r.phase === 'ROLE_DELIVERY'); expect(r.active()).toHaveLength(4);
    expect(r.active().every(p => p.ready && p.connected)).toBe(true);
    until(r, () => r.phase === 'INTERROGATION');
    expect(r.phase).toBe('INTERROGATION'); expect(r.publicState().clueCount).toBe(4);
    expect(r.active().every(p => p.locked && p.clue.length <= 32)).toBe(true);
    for (let i = 0; i < 4; i++) {
      until(r, () => Boolean(r.currentPlayer()!.answer), true);
      if (i < 3) { const id = r.current; deliver(r, 'SAVE'); until(r, () => r.current !== id); } else action(r, 'host', 'next');
    }
    expect(r.phase).toBe('IMPOSTOR_GUESS'); until(r, () => r.phase === 'DECISIONS');
    expect(r.guessLocked).toBe(true); expect(r.guessed).toBe(false);
    expect(r.publicState().demo).toBe(true); expect(r.hostState('http://localhost').links).toBeUndefined();
    expect(r.publicState().demoMessages!.find(m => m.type === 'word')!.text).toContain(r.word.word);
    for (const p of r.players.filter(p => p.outcome === 'SAVE')) action(r, 'host', 'undo', { player: p.id });
    const impostor = r.players.find(p => p.key === r.impostorKey)!; accuse(r, impostor); activate(r);
    vi.setSystemTime(Date.now() + 100); r.acceptFrame({ ...r.frame! }, r.frameSeq + 1); r.tick();
    expect(r.publicState().escapeProgress).toBeGreaterThan(0); expect(r.input).toEqual({ x: 0, y: 0, dash: false });
  });
  it('does not automate normal rooms or advance a paused/disconnected demo', () => {
    const normal = new Room(); normal.hostConnected = true; step(normal); expect(normal.phase).toBe('LOBBY');
    const demo = new Room('local', true); step(demo); expect(demo.phase).toBe('LOBBY');
    demo.hostConnected = true; demo.paused = true; step(demo); expect(demo.phase).toBe('LOBBY');
    demo.paused = false; until(demo, () => demo.phase === 'ROLE_DELIVERY');
  });
  it('rejects demo bots in Twitch rooms and never replaces connected local players', () => {
    expect(() => new Room('twitch', true)).toThrow();
    const r = new Room(); r.hostConnected = true; r.players[0].connected = true;
    expect(() => action(r, 'host', 'demo')).toThrow('empty local lobby');
    r.players[0].connected = false; action(r, 'host', 'demo'); until(r, () => r.phase === 'ROLE_DELIVERY');
  });
  it('presents game, rules, players and word before the first entrance, then waits for a steady pickup', () => {
    const r = new Room('local', true); r.hostConnected = true;
    until(r, () => r.phase === 'INTERROGATION');
    const setup = r.publicState().demoMessages!;
    expect(setup.map(m => m.type)).toEqual(['game', 'rules', 'rules', 'players', 'word']);
    expect(setup[3].text).toContain(r.currentPlayer()!.alias);
    expect(r.publicState().players.every(p => !p.clue && !p.answer)).toBe(true);
    step(r, .1); expect(r.publicState().demoMessages!.at(-1)!.type).toBe('turn');
    step(r, 10); expect(r.publicState().players.every(p => !p.clue)).toBe(true);
    onHand(r); step(r, 2); // A single stale frame cannot speak for a player.
    expect(r.publicState().players.every(p => !p.clue)).toBe(true);
    until(r, () => Boolean(r.publicState().players.find(p => p.id === r.current)?.clue), true);
    const clue = r.publicState().demoMessages!.at(-1)!;
    expect(clue.type).toBe('clue'); expect(clue.name).toBe(r.currentPlayer()!.alias);
    expect(clue.text).toBe(`My clue: “${r.currentPlayer()!.clue}”`);
    step(r, 2, true); expect(r.currentPlayer()!.answer).toBe('');
    until(r, () => Boolean(r.currentPlayer()!.answer), true);
    expect(r.publicState().demoMessages!.at(-1)!.type).toBe('answer');
    expect(r.publicState().players.filter(p => p.clue)).toHaveLength(1);
  });
  it('freezes narration while paused or disconnected and replays the introduction on restart', () => {
    const r = new Room('local', true); r.hostConnected = true; step(r);
    const first = r.publicState().demoMessages!.at(-1)!;
    r.paused = true; step(r, 20); expect(r.publicState().demoMessages!.at(-1)).toEqual(first);
    r.paused = false; r.hostConnected = false; step(r, 20); expect(r.publicState().demoMessages!.at(-1)).toEqual(first);
    r.hostConnected = true; step(r, .1); expect(r.publicState().demoMessages!.at(-1)).toEqual(first);
    until(r, () => r.phase === 'INTERROGATION');
    action(r, 'host', 'restart'); step(r, .1);
    expect(r.publicState().demoMessages).toHaveLength(1);
    expect(r.publicState().demoMessages![0].type).toBe('game');
    expect(r.publicState().demoMessages![0].id).toBeGreaterThan(first.id);
    const normal = room(); expect(normal.publicState().demoMessages).toBeUndefined();
    expect(JSON.stringify(normal.publicState())).not.toContain(normal.word.word);
  });
});

describe('interrogate on the hand, then land directly', () => {
  it('derives the decision from physical position, without arm actions or trusting a supplied zone', () => {
    const r = room(); guess(r); action(r, 'host', 'choose', { player: r.players[0].id });
    r.acceptFrame({ id: r.current!, position: ZONES.SAVE, paddle: { x: 700, y: 345 }, active: true, riding: false, state: 'delivered', capture: 0, dwell: .4 }, r.frameSeq + 1);
    expect(() => action(r, 'host', 'delivery', { zone: 'DROP' })).toThrow();
    r.acceptFrame({ ...r.frame!, dwell: .8 }, r.frameSeq + 1);
    action(r, 'host', 'delivery', { zone: 'DROP' }); expect(r.players[0].outcome).toBe('SAVE');
    expect(() => action(r, 'host', 'arm', { zone: 'SAVE' })).toThrow('Unknown');
    expect(() => action(r, 'host', 'disarm')).toThrow('Unknown');
  });
  it('saves during interrogation and keeps the final rider through guess and DROP', () => {
    const r = room(); clues(r);
    for (let i = 0; i < 3; i++) {
      onHand(r); action(r, r.currentPlayer()!, 'answer', { text: 'Answering on the hand.' });
      deliver(r, 'SAVE'); expect(r.publicState().saved).toBe(i + 1); expect(r.phase).toBe('INTERROGATION'); action(r, 'host', 'next');
    }
    onHand(r); action(r, r.currentPlayer()!, 'answer', { text: 'Last on-hand answer.' });
    const last = r.current; deliver(r, 'DROP'); expect(r.phase).toBe('IMPOSTOR_GUESS'); expect(r.current).toBe(last);
    action(r, r.players.find(p => p.key === r.impostorKey)!, 'guess', { text: '' });
    expect(r.current).toBe(last); expect(r.frame?.state).toBe('delivered'); expect(r.publicState()).not.toHaveProperty('armed');
    deliver(r, 'DROP'); expect(r.publicState().saved).toBe(3); expect(r.publicState().dropped).toBe(1);
  });
  it('does not burn the answer timer while the player waits to be picked up', () => {
    const r = room(); clues(r); const before = r.timer;
    vi.setSystemTime(Date.now() + 10_000); r.tick(); expect(r.timer).toBe(before); expect(r.paused).toBe(false);
    onHand(r); vi.setSystemTime(Date.now() + 100); r.tick(); expect(r.timer).toBeLessThan(before);
  });
});



describe('camera-friendly cave approach', () => {
  it('engages the low Impostor cave from above the camera edge and completes the walk to its landing point', () => {
    const approach = { x: ZONES.DROP.x, y: ZONES.DROP.y - 75 };
    expect(canLand(approach, 'DROP')).toBe(true);
    expect(canLand({ ...approach, y: ZONES.DROP.y - 81 }, 'DROP')).toBe(false);
    expect(canLand({ ...approach, x: 400 }, 'DROP')).toBe(false);
    expect(canLand({ x: ZONES.SAVE.x, y: ZONES.SAVE.y - 75 }, 'SAVE')).toBe(false);
    const landed = moveConstrained(approach, ZONES.DROP, 12, 35, 0);
    expect(landed).toEqual(ZONES.DROP);
  });
});


it('starts a Twitch round from ready verified joiners, without synthetic players', () => {
  const r = new Room('twitch'); r.hostConnected = true; r.twitchConnected = true;
  expect(r.players).toHaveLength(0);
  for (let i = 0; i < 6; i++) { const id = String(100 + i); r.receiveChat(id, `Viewer${i}`, '!join'); const p = r.addPlayer(`Viewer${i}`, id); p.connected = true; p.ready = true; }
  r.tick(); expect(r.phase).toBe('ROLE_DELIVERY'); expect(r.active()).toHaveLength(4);
  expect(r.active().every(p => !!p.twitchId)).toBe(true);
  for (let i = 0; i < 40; i++) { vi.setSystemTime(Date.now() + 250); r.tick(); }
  expect(r.phase).toBe('CLUE_SUBMISSION');
});
