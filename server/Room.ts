import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Action, ActorFrame, EscapeState, GamePhase, HostState, Input, PrivateState, PublicState, SimState } from '../src/shared/protocol';
import { near, SANCTUARY, ZONES, type Vec, type Zone } from '../src/shared/maze';

const WORDS = [
  { category: 'PLACE', word: 'AIRPORT', aliases: ['airport', 'air port'] },
  { category: 'FOOD', word: 'POPCORN', aliases: ['popcorn', 'pop corn'] },
  { category: 'OBJECT', word: 'UMBRELLA', aliases: ['umbrella', 'parasol'] },
  { category: 'PLACE', word: 'LIBRARY', aliases: ['library'] },
  { category: 'ANIMAL', word: 'PENGUIN', aliases: ['penguin'] },
  { category: 'FOOD', word: 'PANCAKE', aliases: ['pancake', 'pancakes'] },
  { category: 'OBJECT', word: 'COMPASS', aliases: ['compass'] },
  { category: 'ANIMAL', word: 'OCTOPUS', aliases: ['octopus'] },
];
const COLORS = [0xffc66d, 0xb6a0ff, 0x89eac7, 0xff9fb7];
const ALIASES = ['Comet', 'Mochi', 'Pebble', 'Orbit', 'Sprout', 'Nimbus', 'Pip', 'Clover'];
const token = () => randomBytes(24).toString('base64url');
export const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function clean(value: unknown, max: number) {
  if (typeof value !== 'string') throw Error('Text is required.');
  const text = value.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  if (text.length > max) throw Error(`Use at most ${max} characters.`);
  return text;
}
function shuffle<T>(items: T[]) { const a = [...items]; for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export type Player = {
  key: string; id: string; token: string; twitchId?: string; name: string; alias: string; color: number;
  connected: boolean; ready: boolean; selected: boolean; clue: string; locked: boolean; answer: string;
  delivered: boolean; outcome?: 'SAVE' | 'DROP'; escapeSpent: boolean; votes: { trust: number; drop: number };
};
export class Room {
  code = randomBytes(3).toString('hex').toUpperCase();
  hostToken = token();
  version = 0;
  phase: GamePhase = 'LOBBY';
  players: Player[] = [];
  hostConnected = false;
  paused = false;
  round = 0;
  category = '';
  word = WORDS[0];
  impostorKey = '';
  order: string[] = [];
  private presentationOrder: string[] = [];
  turn = 0;
  current?: string;
  armed?: Zone;
  timer = 0;
  escape: EscapeState = 'inactive';
  escapeLeft = 12;
  escapeStarted = 0;
  escapePaused = 0;
  input: Input = { x: 0, y: 0, dash: false };
  inputAt = 0;
  ring: Vec = { x: 855, y: 125 };
  frame?: ActorFrame;
  frameAt = 0;
  frameSeq = -1;
  positions = new Map<string, Vec>();
  tracking = false;
  captureSince = 0;
  dashUsed = false;
  dashUntil = 0;
  feedback?: string;
  result?: string;
  rematch = false;
  guess = '';
  guessLocked = false;
  guessed = false;
  votingOpen = false;
  twitchConnected = false;
  voteMap = new Map<string, 'trust' | 'drop'>();
  joinQueue = new Map<string, string>();
  private seen = new Set<string>();
  private lastTick = Date.now();
  constructor(public mode: 'local' | 'twitch' = 'local') {
    if (mode === 'local') ['Frank', 'Sarah', 'Mia', 'Alex'].forEach(name => this.addPlayer(name));
  }
  addPlayer(name: string, twitchId?: string) {
    if (twitchId && this.players.some(p => p.twitchId === twitchId)) return this.players.find(p => p.twitchId === twitchId)!;
    if (this.phase !== 'LOBBY' || this.players.length >= 24) throw Error('The lobby is closed or full.');
    const player: Player = { key: randomUUID(), id: randomUUID(), token: token(), twitchId, name: clean(name, 24) || 'Viewer', alias: name, color: COLORS[this.players.length % 4], connected: false, ready: false, selected: this.mode === 'local', clue: '', locked: false, answer: '', delivered: false, escapeSpent: false, votes: { trust: 0, drop: 0 } };
    this.players.push(player); this.version++; return player;
  }
  playerByToken(value: string) { return this.players.find(p => p.token === value); }
  active() { return this.players.filter(p => p.selected).sort((a, b) => this.presentationOrder.indexOf(a.id) - this.presentationOrder.indexOf(b.id)); }
  currentPlayer() { return this.players.find(p => p.id === this.current); }
  require(condition: unknown, message = 'This action is unavailable in the current phase.'): asserts condition { if (!condition) throw Error(message); }
  publicState(): PublicState {
    const reveal = this.phase === 'REVEAL' || this.phase === 'RESULTS';
    const cluesVisible = !['LOBBY', 'ROLE_DELIVERY', 'CLUE_SUBMISSION'].includes(this.phase);
    return { code: this.code, version: this.version, mode: this.mode, phase: this.phase, round: this.round, category: this.phase === 'LOBBY' ? undefined : this.category,
      players: (this.phase === 'LOBBY' ? this.players : this.active()).map(p => ({ id: p.id, name: p.alias, color: p.color, connected: p.connected, ready: p.ready, selected: p.selected, clue: cluesVisible ? p.clue : undefined, answer: cluesVisible ? p.answer : undefined, delivered: p.delivered, outcome: p.outcome, position: this.positions.get(p.id), votes: { ...p.votes } })),
      current: this.current, clueCount: this.active().filter(p => p.locked).length, paused: this.paused, hostConnected: this.hostConnected, timer: Math.ceil(this.timer), votingOpen: this.votingOpen, twitchConnected: this.twitchConnected,
      saved: this.active().filter(p => p.outcome === 'SAVE').length, dropped: this.active().filter(p => p.outcome === 'DROP').length, armed: this.armed,
      escape: this.escape, escapeLeft: Math.ceil(this.escapeLeft * 10) / 10, feedback: this.feedback, result: this.result, rematch: this.rematch,
      reveal: reveal ? { word: this.word.word, impostor: this.players.find(p => p.key === this.impostorKey)!.alias, guessed: this.guessed, guess: this.guess || 'PASS' } : undefined };
  }
  privateState(player: Player): PrivateState {
    const assigned = player.selected && this.phase !== 'LOBBY';
    const isImpostor = player.key === this.impostorKey;
    return { id: player.id, realName: player.name, role: assigned ? isImpostor ? 'impostor' : 'informed' : undefined, word: assigned && !isImpostor ? this.word.word : undefined, category: assigned ? this.category : undefined,
      clue: player.clue, locked: player.locked, answer: player.answer, guessLocked: this.guessLocked && isImpostor, escapeSpent: player.escapeSpent,
      ring: isImpostor && this.phase === 'ESCAPE' ? { ...this.ring } : undefined };
  }
  hostState(base: string): HostState {
    return { links: this.mode === 'local' && this.phase === 'LOBBY' ? this.players.map(p => ({ name: p.name, url: `${base}/?room=${this.code}#player=${p.token}` })) : undefined,
      joinUrl: `${base}/?join=${this.code}`, broadcastUrl: `${base}/?broadcast=${this.code}`,
      candidates: (this.phase === 'LOBBY' ? this.players : this.active()).map(p => ({ id: p.id, name: p.alias, connected: p.connected, ready: p.ready, selected: p.selected })) };
  }
  simState(): SimState { return { ring: this.phase === 'ESCAPE' ? { ...this.ring } : undefined, input: this.inputAt > Date.now() - 250 && !this.paused ? { ...this.input, dash: this.dashUntil > Date.now() } : { x: 0, y: 0, dash: false } }; }
  private start(rematch = false) {
    const selected = this.active();
    this.require(selected.length === 4 && selected.every(p => p.connected && p.ready), 'Select four connected, ready players.');
    const options = WORDS.filter(w => w.word !== this.word.word && (!rematch || w.category !== this.category));
    this.word = options[randomInt(options.length)]; this.category = this.word.category;
    if (!rematch) this.impostorKey = selected[randomInt(4)].key;
    const aliases = shuffle(ALIASES), colors = shuffle(COLORS);
    selected.forEach((p, i) => {
      p.clue = ''; p.locked = false; p.answer = ''; p.delivered = false; p.outcome = undefined; p.votes = { trust: 0, drop: 0 };
      p.id = randomUUID(); p.alias = rematch ? aliases[i] : p.name; p.color = rematch ? colors[i] : COLORS[i];
      if (!rematch) p.escapeSpent = false;
    });
    this.presentationOrder = shuffle(selected.map(p => p.id));
    this.order = shuffle(selected.map(p => p.id)); this.positions.clear(); this.turn = 0; this.current = undefined; this.round++;
    this.phase = 'ROLE_DELIVERY'; this.armed = undefined; this.timer = 0; this.paused = false;
    this.escape = 'inactive'; this.escapeLeft = 12; this.escapePaused = 0; this.frame = undefined; this.frameSeq = -1;
    this.feedback = undefined; this.result = undefined; this.rematch = false; this.guess = ''; this.guessLocked = false; this.guessed = false; this.votingOpen = false; this.voteMap.clear();
  }
  private interrogation() { this.phase = 'INTERROGATION'; this.current = this.order[this.turn]; this.timer = 15; this.armed = undefined; this.voteMap.clear(); this.votingOpen = false; this.frame = undefined; }
  private finish(reason: string, rematch = false) {
    this.result = this.guessed ? 'IMPOSTOR WINS BY GUESSING' : reason;
    this.rematch = rematch && !this.guessed; this.phase = 'REVEAL'; this.armed = undefined; this.votingOpen = false; this.input = { x: 0, y: 0, dash: false }; this.paused = false;
  }
  act(actor: 'host' | Player, action: Action) {
    this.require(action && typeof action.id === 'string' && action.id.length <= 100 && typeof action.type === 'string', 'Invalid action.');
    this.require(!this.seen.has(action.id), 'Duplicate action ignored.');
    this.require(action.version === this.version, 'The room changed. Try again.');
    this.require(this.hostConnected || actor === 'host', 'The host is disconnected.');
    const d = action.data ?? {};
    const type = action.type;
    if (actor !== 'host') {
      this.require(!this.paused || type === 'ready', 'The round is paused.');
      if (type === 'ready') { this.require(this.phase === 'LOBBY'); actor.ready = !actor.ready; }
      else if (type === 'clue' || type === 'lock') {
        this.require(this.phase === 'CLUE_SUBMISSION' && actor.selected && !actor.locked, 'Clue is locked or unavailable.');
        const clue = clean(d.text, 32); this.require(clue.length && clue.split(' ').length <= 3, 'Use one to three words.');
        this.require(!/\b[a-z][a-z0-9+.-]*:\/\/|www\.|\b\S+\.[a-z]{2,}(?:[\/:?#]|$|\s)/i.test(clue), 'Links are not clues.');
        this.require(!this.word.aliases.some(alias => normalize(clue).includes(normalize(alias))), 'Do not disclose the secret word.');
        actor.clue = clue; if (type === 'lock') actor.locked = true;
        if (this.active().every(p => p.locked)) this.interrogation();
      } else if (type === 'answer') {
        this.require(this.phase === 'INTERROGATION' && this.current === actor.id && !actor.answer, 'Only the current player may answer once.');
        actor.answer = clean(d.text, 100); this.require(actor.answer.length, 'Write an answer.');
      } else if (type === 'guess') {
        this.require(this.phase === 'IMPOSTOR_GUESS' && actor.key === this.impostorKey && !this.guessLocked);
        this.guess = clean(d.text ?? '', 40); this.guessed = this.word.aliases.some(a => normalize(a) === normalize(this.guess)); this.guessLocked = true;
        this.phase = 'DECISIONS'; this.current = undefined; this.timer = 0;
      } else throw Error('Player action not permitted.');
    } else {
      if (type === 'pause') { this.paused = !this.paused; }
      else if (type === 'extend') { this.require(['CLUE_SUBMISSION', 'INTERROGATION', 'IMPOSTOR_GUESS'].includes(this.phase)); this.timer += 15; this.paused = false; }
      else if (type === 'selectLobby') {
        this.require(this.phase === 'LOBBY'); const p = this.players.find(p => p.id === d.player); this.require(p); p.selected = !p.selected;
      } else if (type === 'start') { this.require(this.phase === 'LOBBY'); this.start(); }
      else if (type === 'clues') { this.require(this.phase === 'ROLE_DELIVERY'); this.phase = 'CLUE_SUBMISSION'; this.timer = 30; }
      else if (type === 'next') {
        this.require(this.phase === 'INTERROGATION' && this.currentPlayer()?.delivered && this.currentPlayer()?.answer, 'Deliver the player and collect their answer first.');
        this.turn++; if (this.turn === 4) { this.phase = 'IMPOSTOR_GUESS'; this.current = undefined; this.timer = 30; this.votingOpen = false; } else this.interrogation();
      } else if (type === 'reopen') { this.require(this.phase === 'INTERROGATION'); this.currentPlayer()!.answer = ''; this.timer = 15; this.paused = false; }
      else if (type === 'voting') { this.require(this.phase === 'INTERROGATION' && this.mode === 'twitch' && this.twitchConnected); this.votingOpen = !this.votingOpen; }
      else if (type === 'choose') {
        this.require(this.phase === 'DECISIONS' && !this.armed && !this.current, 'Finish the current decision before selecting another player.'); const p = this.active().find(p => p.id === d.player);
        this.require(p && !p.outcome, 'Choose an undecided player.'); this.current = p.id; this.frame = undefined;
      } else if (type === 'arm') {
        this.require(!this.paused && this.currentPlayer());
        const zone = d.zone as Zone;
        if (this.phase === 'INTERROGATION') this.require(zone === 'WAIT' && !this.currentPlayer()!.delivered);
        else {
          this.require(this.phase === 'DECISIONS' && !this.currentPlayer()!.outcome);
          const saved = this.active().filter(p => p.outcome === 'SAVE').length;
          this.require((zone === 'SAVE' && saved < 3) || (zone === 'DROP' && saved === 3), 'Save exactly three players before arming DROP.');
        }
        this.armed = zone;
      } else if (type === 'disarm') { this.armed = undefined; }
      else if (type === 'delivery') {
        this.require(!this.paused && this.armed && this.frame && this.frame.id === this.current && Date.now() - this.frameAt < 1500, 'No recent physical delivery.');
        const p = this.currentPlayer()!, zone = this.armed;
        this.require(near(this.frame.position, ZONES[zone], 38) && !this.frame.riding, 'The character must walk onto the destination.');
        if (zone === 'WAIT') { this.require(this.phase === 'INTERROGATION'); p.delivered = true; this.armed = undefined; }
        else {
          this.require(this.phase === 'DECISIONS' && !p.outcome && this.frame.dwell >= .69);
          const saved = this.active().filter(p => p.outcome === 'SAVE').length;
          this.require(zone === 'SAVE' ? saved < 3 : saved === 3 && !this.active().some(p => p.outcome === 'DROP'));
          p.outcome = zone; this.armed = undefined;
          if (zone === 'SAVE') this.current = undefined;
          else if (p.key !== this.impostorKey) { this.feedback = 'WRONG CHOICE'; this.finish('IMPOSTOR WINS BY DECEPTION'); }
          else if (this.guessed) { this.feedback = 'IMPOSTOR FOUND'; this.finish('IMPOSTOR WINS BY GUESSING'); }
          else if (p.escapeSpent) { this.feedback = 'IMPOSTOR FOUND · ESCAPE ALREADY SPENT'; this.finish('STREAMER WINS · IMPOSTOR ELIMINATED'); }
          else {
            this.feedback = 'IMPOSTOR FOUND'; p.escapeSpent = true; this.phase = 'ESCAPE'; this.escape = 'starting'; this.escapeStarted = Date.now(); this.escapeLeft = 12; this.escapePaused = 0; this.captureSince = 0; this.dashUsed = false; this.dashUntil = 0;
          }
        }
      } else if (type === 'undo') {
        this.require(this.phase === 'DECISIONS'); const p = this.active().find(p => p.id === d.player && p.outcome === 'SAVE'); this.require(p); p.outcome = undefined; this.armed = undefined;
      } else if (type === 'capture' || type === 'ring') {
        this.require(this.phase === 'ESCAPE' && this.escape === 'active' && !this.paused && this.tracking && this.escapePaused === 0 && this.currentPlayer()?.key === this.impostorKey && this.frame && Date.now() - this.frameAt < 500 && d.player === this.current);
        if (type === 'capture') {
          this.require(this.captureSince > 0 && Date.now() - this.captureSince >= 400 && this.frame.active && near(this.frame.position, this.frame.paddle, 80), 'Capture contact must be held.');
          this.escape = 'captured'; this.finish('STREAMER WINS · IMPOSTOR CAUGHT');
        } else {
          this.require(near({ x: this.frame.position.x, y: this.frame.position.y - 18 }, this.ring, 26) && this.escapeLeft > 0 && Date.now() - this.escapeStarted > 700, 'The impostor must reach the ring.');
          this.escape = 'escaped'; this.finish('IMPOSTOR WINS BY ESCAPE', true);
        }
      } else if (type === 'results') { this.require(this.phase === 'REVEAL'); this.phase = 'RESULTS'; }
      else if (type === 'rematch') { this.require(['REVEAL', 'RESULTS'].includes(this.phase) && this.rematch); this.start(true); }
      else if (type === 'lobby') { this.require(['REVEAL', 'RESULTS'].includes(this.phase)); this.phase = 'LOBBY'; this.current = undefined; this.players.forEach(p => { p.alias = p.name; p.ready = false; }); }
      else if (type === 'restart') { this.phase = 'LOBBY'; this.current = undefined; this.armed = undefined; this.paused = false; this.players.forEach(p => { p.ready = false; p.alias = p.name; p.outcome = undefined; }); }
      else throw Error('Unknown host action.');
    }
    this.seen.add(action.id); if (this.seen.size > 4000) this.seen.delete(this.seen.values().next().value!);
    this.version++;
  }
  control(player: Player, input: Input) {
    this.require(this.phase === 'ESCAPE' && this.escape === 'active' && player.id === this.current && player.key === this.impostorKey && !this.paused && this.hostConnected, 'Movement is only available during your escape.');
    this.require(input && Number.isFinite(input.x) && Number.isFinite(input.y));
    this.input = { x: Math.max(-1, Math.min(1, input.x)), y: Math.max(-1, Math.min(1, input.y)), dash: false };
    if (input.dash && !this.dashUsed) { this.dashUsed = true; this.dashUntil = Date.now() + 180; }
    this.inputAt = Date.now();
  }
  acceptFrame(frame: ActorFrame, seq: number) {
    if (!Number.isSafeInteger(seq) || seq <= this.frameSeq || frame.id !== this.current || !Number.isFinite(frame.position?.x + frame.position?.y + frame.paddle?.x + frame.paddle?.y) || !Number.isFinite(frame.dwell)) return false;
    if (frame.position.x < 0 || frame.position.x > 960 || frame.position.y < 0 || frame.position.y > 600) return false;
    this.frameSeq = seq; this.frame = frame; this.frameAt = Date.now(); this.tracking = frame.active; this.positions.set(frame.id, { ...frame.position });
    const protectedArea = frame.position.x >= SANCTUARY.x && frame.position.y < SANCTUARY.y + SANCTUARY.h;
    if (this.phase === 'ESCAPE' && this.escape === 'active' && frame.active && !this.paused && !protectedArea && near(frame.position, frame.paddle, 80)) { if (!this.captureSince) this.captureSince = Date.now(); } else this.captureSince = 0;
    return true;
  }
  vote(userId: string, choice: 'trust' | 'drop') {
    if (!this.votingOpen || !this.twitchConnected || this.phase !== 'INTERROGATION' || this.paused) return;
    this.voteMap.set(userId, choice); const p = this.currentPlayer()!;
    p.votes = { trust: [...this.voteMap.values()].filter(v => v === 'trust').length, drop: [...this.voteMap.values()].filter(v => v === 'drop').length }; this.version++;
  }
  tick(now = Date.now()) {
    const dt = Math.min(.25, Math.max(0, (now - this.lastTick) / 1000)); this.lastTick = now;
    if (!this.hostConnected || this.paused) return;
    if (this.phase === 'ESCAPE') {
      if (!this.tracking || now - this.frameAt > 700) { this.escapePaused += dt; this.input = { x: 0, y: 0, dash: false }; return; }
      this.escapePaused = 0;
      if (this.escape === 'starting') { if (now - this.escapeStarted >= 650) { this.escape = 'active'; this.version++; } }
      else if (this.escape === 'active') { this.escapeLeft = Math.max(0, this.escapeLeft - dt); if (!this.escapeLeft) { this.escape = 'timed_out'; this.finish('STREAMER WINS · ESCAPE TIMED OUT'); this.version++; } }
    } else if (['CLUE_SUBMISSION', 'IMPOSTOR_GUESS', 'INTERROGATION'].includes(this.phase) && this.timer > 0) {
      if (this.phase === 'INTERROGATION' && this.currentPlayer()?.answer) return;
      this.timer = Math.max(0, this.timer - dt); if (!this.timer) { this.paused = true; this.version++; }
    }
  }
}
