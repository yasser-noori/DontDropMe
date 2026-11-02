import { demoBluff, demoAnswer } from '../src/shared/demo-dialogue';
import { ESCAPE_COUNTDOWN, ESCAPE_RUN_SECONDS, pinchTouches } from '../src/shared/escape';
import { continuationText, messageDuration } from '../src/shared/message-timing';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Action, ActorFrame, DemoMessage, EscapeState, GamePhase, HostState, Input, PrivateState, PublicState, SimState } from '../src/shared/protocol';
import { landedZone, near, ZONES, type Vec } from '../src/shared/maze';

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
const DEMO_CLUES: Record<string, string[]> = {
  AIRPORT: ['departure board', 'rolling luggage', 'security line'],
  POPCORN: ['movie night', 'buttery fingers', 'crunchy handful'],
  UMBRELLA: ['rainy sidewalk', 'folding handle', 'staying dry'],
  LIBRARY: ['quiet shelves', 'borrowed stories', 'reading corner'],
  PENGUIN: ['icy shoreline', 'formal feathers', 'awkward waddle'],
  PANCAKE: ['breakfast stack', 'maple drizzle', 'flipped batter'],
  COMPASS: ['magnetic needle', 'finding north', 'lost hiker'],
  OCTOPUS: ['suction cups', 'inky water', 'clever tentacles'],
};
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
  timer = 0;
  escape: EscapeState = 'inactive';
  escapeLeft = 12;
  escapeCountdown = ESCAPE_COUNTDOWN;
  escapeStarted = 0;
  escapePaused = 0;
  input: Input = { x: 0, y: 0, dash: false };
  inputAt = 0;
  ring: Vec = { x: 855, y: 125 };
  frame?: ActorFrame;
  frameAt = 0;
  frameSeq = -1;
  positions = new Map<string, Vec>();
  private spokenClues = new Set<string>();
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
  twitchChannel?: { name: string; login: string };
  voteMap = new Map<string, 'trust' | 'drop'>();
  joinQueue = new Map<string, string>();
  private seen = new Set<string>();
  private lastTick = Date.now();
  private demoClock = 0;
  private demoUntil = 0;
  private demoIntro = 0;
  private demoSetup = 0;
  private demoPhase?: GamePhase;
  private demoTurn = '';
  private demoOnHand = 0;
  private demoSaved = new Set<string>();
  private demoMessages: DemoMessage[] = [];
  private demoMessageId = 0;
  constructor(public mode: 'local' | 'twitch' = 'local', public demo = false) {
    this.require(!demo || mode === 'local', 'Demo players are only available in local rehearsal.');
    if (mode === 'local') ['Leo', 'Sarah', 'Mia', 'Alex'].forEach(name => this.addPlayer(name));
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
    return { code: this.code, version: this.version, waitingViewers: this.mode === 'twitch' && this.phase === 'LOBBY' ? [...this.joinQueue.values()] : undefined, mode: this.mode, demo: this.demo, phase: this.phase, round: this.round, category: this.phase === 'LOBBY' ? undefined : this.category,
      players: (this.phase === 'LOBBY' ? this.players : this.active()).map(p => ({ id: p.id, name: p.alias, color: p.color, connected: p.connected, ready: p.ready, selected: p.selected, clue: cluesVisible && (reveal || this.spokenClues.has(p.id)) ? p.clue : undefined, answer: cluesVisible && (reveal || this.spokenClues.has(p.id)) ? p.answer : undefined, delivered: p.delivered, outcome: p.outcome, position: this.positions.get(p.id), votes: { ...p.votes } })),
      current: this.current, twitchChannel: this.twitchChannel, clueCount: this.active().filter(p => p.locked).length, paused: this.paused, hostConnected: this.hostConnected, timer: Math.ceil(this.timer), votingOpen: this.votingOpen, twitchConnected: this.twitchConnected,
      saved: this.active().filter(p => p.outcome === 'SAVE').length, dropped: this.active().filter(p => p.outcome === 'DROP').length,
      escape: this.escape, escapeCountdown: Math.ceil(this.escapeCountdown), escapeProgress: Math.min(1, (12 - this.escapeLeft) / ESCAPE_RUN_SECONDS), escapeLeft: Math.ceil(this.escapeLeft * 10) / 10, feedback: this.feedback, result: this.result, rematch: this.rematch,
      reveal: reveal ? { word: this.word.word, impostor: this.players.find(p => p.key === this.impostorKey)!.alias, guessed: this.guessed, guess: this.guess || 'PASS' } : undefined,
      demoMessages: this.demo ? this.demoMessages.map(message => ({ ...message })) : undefined,
      demoSpeaking: this.demo && this.demoClock < this.demoUntil && ['clue', 'answer'].includes(this.demoMessages.at(-1)?.type || '') };
  }
  privateState(player: Player): PrivateState {
    const assigned = player.selected && this.phase !== 'LOBBY';
    const isImpostor = player.key === this.impostorKey;
    return { id: player.id, realName: player.name, role: assigned ? isImpostor ? 'impostor' : 'informed' : undefined, word: assigned && !isImpostor ? this.word.word : undefined, category: assigned ? this.category : undefined,
      clue: player.clue, locked: player.locked, answer: player.answer, guessLocked: this.guessLocked && isImpostor, escapeSpent: player.escapeSpent,
      ring: isImpostor && this.phase === 'ESCAPE' ? { ...this.ring } : undefined };
  }
  hostState(base: string): HostState {
    return { links: this.mode === 'local' && !this.demo && this.phase === 'LOBBY' ? this.players.map(p => ({ name: p.name, url: `${base}/?room=${this.code}#player=${p.token}` })) : undefined,
      joinUrl: `${base}/?join=${this.code}`, broadcastUrl: `${base}/?broadcast=${this.code}`,
      candidates: (this.phase === 'LOBBY' ? this.players : this.active()).map(p => ({ id: p.id, name: p.alias, connected: p.connected, ready: p.ready, selected: p.selected })) };
  }
  simState(): SimState { return { ring: this.phase === 'ESCAPE' ? { ...this.ring } : undefined, input: this.inputAt > Date.now() - 250 && !this.paused ? { ...this.input, dash: this.dashUntil > Date.now() } : { x: 0, y: 0, dash: false } }; }
  private start(rematch = false, continuation = false) {
    const selected = this.active();
    this.require(continuation ? selected.length > 0 && selected.some(p => p.key === this.impostorKey) : selected.length === 4 && selected.every(p => p.connected && p.ready), 'Select four connected, ready players.');
    const options = WORDS.filter(w => w.word !== this.word.word && (!rematch || w.category !== this.category));
    this.word = this.demo ? WORDS.find(w => w.word === 'POPCORN')! : options[randomInt(options.length)]; this.category = this.word.category;
    if (this.demo) this.impostorKey = selected.find(p => p.name === 'Mia')!.key;
    else if (!rematch && !continuation) this.impostorKey = selected[randomInt(4)].key;
    const aliases = shuffle(ALIASES), colors = shuffle(COLORS);
    selected.forEach((p, i) => {
      p.clue = ''; p.locked = false; p.answer = ''; p.delivered = false; p.outcome = undefined; p.votes = { trust: 0, drop: 0 };
      p.id = randomUUID(); if (!continuation) { p.alias = rematch && !this.demo ? aliases[i] : p.name; p.color = rematch && !this.demo ? colors[i] : COLORS[i]; }
      if (!rematch && !continuation) p.escapeSpent = false;
    });
    const demoOrder = [...selected].sort((a, b) => ['Leo', 'Frank', 'Sarah', 'Mia', 'Alex'].indexOf(a.name) - ['Leo', 'Frank', 'Sarah', 'Mia', 'Alex'].indexOf(b.name)).map(p => p.id);
    this.presentationOrder = this.demo ? demoOrder : shuffle(selected.map(p => p.id));
    this.order = this.demo ? demoOrder : shuffle(selected.map(p => p.id)); this.positions.clear(); this.spokenClues.clear(); this.turn = 0; this.current = undefined; this.round++;
    this.phase = 'ROLE_DELIVERY'; this.timer = 0; this.paused = false;
    this.escape = 'inactive'; this.escapeLeft = 12; this.escapePaused = 0; this.frame = undefined; this.frameSeq = -1;
    this.feedback = undefined; this.result = undefined; this.rematch = false; this.guess = ''; this.guessLocked = false; this.guessed = false; this.votingOpen = false; this.voteMap.clear();
  }
  private interrogation() { this.phase = 'INTERROGATION'; this.current = this.order[this.turn]; this.timer = 15; this.voteMap.clear(); this.votingOpen = false; this.frame = undefined; }
  private finishSurvivorRound() {
    if (!this.active().every(p => p.outcome)) return;
    this.phase = 'ROUND_END'; this.timer = messageDuration('round', continuationText(this.round + 1)) / 1000; this.current = undefined;
    this.result = 'IMPOSTOR IS STILL PRESENT'; this.feedback = undefined;
    this.votingOpen = false; this.input = { x: 0, y: 0, dash: false };
    this.frame = undefined; this.tracking = false;
  }
  private finish(reason: string, rematch = false) {
    this.result = this.guessed ? 'IMPOSTOR WINS BY GUESSING' : reason;
    this.rematch = rematch && !this.guessed; this.phase = 'REVEAL'; this.votingOpen = false; this.input = { x: 0, y: 0, dash: false }; this.paused = false;
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
        this.phase = 'DECISIONS'; if (this.currentPlayer()?.outcome) this.current = undefined; this.timer = 0;
      } else throw Error('Player action not permitted.');
    } else {
      if (type === 'demo') { this.require(this.mode === 'local' && this.phase === 'LOBBY' && !this.players.some(p => p.connected), 'Start demo in an empty local lobby.'); this.demo = true; this.demoPhase = undefined; }
      else if (type === 'pause') { this.paused = !this.paused; }
      else if (type === 'extend') { this.require(['CLUE_SUBMISSION', 'INTERROGATION', 'IMPOSTOR_GUESS'].includes(this.phase)); this.timer += 15; this.paused = false; }
      else if (type === 'selectLobby') {
        this.require(this.phase === 'LOBBY'); const p = this.players.find(p => p.id === d.player); this.require(p); p.selected = !p.selected;
      } else if (type === 'start') { this.require(this.phase === 'LOBBY'); this.start(); }
      else if (type === 'clues') { this.require(this.phase === 'ROLE_DELIVERY'); this.phase = 'CLUE_SUBMISSION'; this.timer = 30; }
      else if (type === 'next') {
        this.require(this.phase === 'INTERROGATION' && this.currentPlayer()?.answer && (this.currentPlayer()?.outcome === 'SAVE' || this.frame?.id === this.current && this.frame?.riding && Date.now() - this.frameAt < 1500), 'Ask the player on your hand and collect their answer first.');
        this.currentPlayer()!.delivered = true;
        this.turn++; if (this.turn === this.order.length) { this.phase = this.guessLocked ? 'DECISIONS' : 'IMPOSTOR_GUESS'; if (this.currentPlayer()?.outcome) this.current = undefined; this.timer = this.guessLocked ? 0 : 30; this.votingOpen = false; } else this.interrogation();
      } else if (type === 'reopen') { this.require(this.phase === 'INTERROGATION'); this.currentPlayer()!.answer = ''; this.timer = 15; this.paused = false; }
      else if (type === 'voting') { this.require(this.phase === 'INTERROGATION' && this.mode === 'twitch' && this.twitchConnected && this.current && this.spokenClues.has(this.current)); this.votingOpen = !this.votingOpen; }
      else if (type === 'choose') {
        this.require(this.phase === 'DECISIONS' && (!this.current || this.frame?.riding), 'Finish the current landing before selecting another player.'); const p = this.active().find(p => p.id === d.player);
        this.require(p && !p.outcome, 'Choose an undecided player.'); this.current = p.id; this.frame = undefined;
      } else if (type === 'delivery') {
        this.require(!this.paused && this.frame && this.frame.id === this.current && Date.now() - this.frameAt < 1500, 'No recent physical delivery.');
        const p = this.currentPlayer()!, zone = landedZone(this.frame.position);
        this.require(zone && !this.frame.riding && this.frame.state === 'delivered', 'The character must walk onto SAVE or DROP.');
        this.require(!p.outcome && this.frame.dwell >= .69);
        if (zone === 'DROP' && this.phase === 'INTERROGATION') {
          this.require(p.answer && !this.active().some(p => p.outcome === 'DROP'), 'Collect this player’s answer before dropping them.');
          p.delivered = true; this.phase = 'IMPOSTOR_GUESS'; this.timer = 30; this.votingOpen = false;
        } else {
          this.require((this.phase === 'DECISIONS' || this.phase === 'INTERROGATION' && zone === 'SAVE' && p.answer) && !p.outcome && this.frame.dwell >= .69);
          const saved = this.active().filter(p => p.outcome === 'SAVE').length;
          this.require(zone === 'SAVE' ? saved < this.active().length - 1 : !this.active().some(p => p.outcome === 'DROP'));
          p.outcome = zone; p.delivered = true;
          if (zone === 'SAVE') { if (this.phase === 'DECISIONS') this.current = undefined; this.finishSurvivorRound(); }
          else if (p.key !== this.impostorKey) {
            if (this.guessed) this.finish('IMPOSTOR WINS BY GUESSING');
            else {
              this.current = undefined; this.feedback = undefined;
              const nextTurn = this.order.findIndex(id => !this.players.find(p => p.id === id)!.delivered);
              if (nextTurn >= 0) { this.turn = nextTurn; this.interrogation(); }
              this.finishSurvivorRound();
            }
          }
          else if (this.guessed) { this.feedback = 'IMPOSTOR FOUND'; this.finish('IMPOSTOR WINS BY GUESSING'); }
          else if (p.escapeSpent) { this.feedback = 'IMPOSTOR FOUND · ESCAPE ALREADY SPENT'; this.finish('STREAMER WINS · IMPOSTOR ELIMINATED'); }
          else {
            this.feedback = 'IMPOSTOR FOUND'; p.escapeSpent = true; this.phase = 'ESCAPE'; this.escape = 'starting'; this.escapeCountdown = ESCAPE_COUNTDOWN; this.ring = { x: ZONES.SAVE.x, y: ZONES.SAVE.y - 18 }; this.escapeStarted = Date.now(); this.escapeLeft = 12; this.escapePaused = 0; this.captureSince = 0; this.dashUsed = false; this.dashUntil = 0;
          }
        }
      } else if (type === 'undo') {
        this.require(['INTERROGATION', 'DECISIONS'].includes(this.phase) && !this.active().some(p => p.outcome === 'DROP')); const p = this.active().find(p => p.id === d.player && p.outcome === 'SAVE'); this.require(p); p.outcome = undefined;
      } else if (type === 'returnCaptured') {
        this.require(this.phase === 'ESCAPE' && this.escape === 'captured' && !this.paused && this.currentPlayer()?.key === this.impostorKey);
        this.require(this.frame && Date.now() - this.frameAt < 500 && d.player === this.current && this.frame.id === this.current && this.frame.state === 'captured' && this.frame.dwell >= .69 && landedZone(this.frame.position) === 'DROP', 'Return the captured impostor to the Impostor cave.');
        this.finish('STREAMER WINS · IMPOSTOR RETURNED');
      } else if (type === 'capture' || type === 'ring') {
        this.require(this.phase === 'ESCAPE' && this.escape === 'active' && !this.paused && this.tracking && this.escapePaused === 0 && this.currentPlayer()?.key === this.impostorKey && this.frame && Date.now() - this.frameAt < 500 && d.player === this.current);
        if (type === 'capture') {
          this.require(this.captureSince > 0 && Date.now() - this.captureSince >= 200 && this.frame.active && pinchTouches(this.frame.pinch, this.frame.position), 'Pinch thumb and index finger around the impostor and hold briefly.');
          this.escape = 'captured'; this.captureSince = 0; this.feedback = 'Bring the captured impostor back to the Impostor cave.';
        } else {
          this.require(near({ x: this.frame.position.x, y: this.frame.position.y - 18 }, this.ring, 26) && this.escapeLeft > 0 && 12 - this.escapeLeft >= ESCAPE_RUN_SECONDS, 'The impostor must reach the ring.');
          this.escape = 'escaped'; this.finish('IMPOSTOR WINS BY ESCAPE', true);
        }
      } else if (type === 'results') { this.require(this.phase === 'REVEAL'); this.phase = 'RESULTS'; }
      else if (type === 'rematch') { this.require(['REVEAL', 'RESULTS'].includes(this.phase) && this.rematch); this.start(true); }
      else if (type === 'lobby') { this.require(['REVEAL', 'RESULTS'].includes(this.phase)); this.phase = 'LOBBY'; this.demoPhase = undefined; this.current = undefined; this.players.forEach(p => { p.alias = p.name; p.ready = false; }); }
      else if (type === 'restart') { this.phase = 'LOBBY'; this.demoPhase = undefined; this.current = undefined; this.paused = false; this.players.forEach(p => { p.ready = false; p.alias = p.name; p.outcome = undefined; }); }
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
    if (!this.demo && this.phase === 'INTERROGATION' && this.hostConnected && !this.paused && frame.active && frame.riding && frame.state === 'riding' && near(frame.position, frame.paddle, 80) && !this.spokenClues.has(frame.id)) {
      this.spokenClues.add(frame.id); if (this.mode === 'twitch' && this.twitchConnected) this.votingOpen = true; this.version++;
    }
    if (this.phase === 'ESCAPE' && this.escape === 'active' && frame.active && !this.paused && pinchTouches(frame.pinch, frame.position)) { if (!this.captureSince) this.captureSince = Date.now(); } else this.captureSince = 0;
    return true;
  }
  receiveChat(userId: string, name: string, message: string) {
    if (this.mode !== 'twitch' || !this.twitchConnected) return;
    const command = message.trim().toLowerCase();
    if (command === '!join' && this.phase === 'LOBBY' && this.joinQueue.size < 200) this.joinQueue.set(userId, clean(name, 30));
    if (command === '!trust' || command === '!drop') this.vote(userId, command === '!trust' ? 'trust' : 'drop');
    this.version++;
  }
  vote(userId: string, choice: 'trust' | 'drop') {
    if (!this.votingOpen || !this.twitchConnected || this.phase !== 'INTERROGATION' || this.paused) return;
    this.voteMap.set(userId, choice); const p = this.currentPlayer()!;
    p.votes = { trust: [...this.voteMap.values()].filter(v => v === 'trust').length, drop: [...this.voteMap.values()].filter(v => v === 'drop').length }; this.version++;
  }
  private demoSay(text: string, type: DemoMessage['type'] = 'game', name = 'Game', playerId?: string) {
    this.demoMessages.push({ id: ++this.demoMessageId, name, text, type, playerId, round: this.round });
    if (this.demoMessages.length > 80) this.demoMessages.shift();
    // One server clock controls both chat and the overlay, including pause/resume.
    this.demoUntil = this.demoClock + messageDuration(type, text) / 1000;
    this.version++;
  }
  /** Explicit synthetic rehearsal participants use the same validated actions as real players. */
  private demoStep(now: number, dt: number) {
    this.demoClock += dt;
    if (this.demoPhase !== this.phase && this.phase === 'LOBBY') {
      this.demoMessages = []; this.demoIntro = 0; this.demoUntil = 0; this.demoTurn = ''; this.demoSaved.clear();
      this.demoPhase = this.phase;
    }
    const player = this.currentPlayer();
    const onHand = this.phase === 'INTERROGATION' && player && this.frame?.id === player.id && now - this.frameAt < 700 && this.frame.active && this.frame.riding && this.frame.state === 'riding' && near(this.frame.position, this.frame.paddle, 80);
    if (onHand) { if (!this.demoOnHand) this.demoOnHand = this.demoClock; } else this.demoOnHand = 0;
    if (this.demoClock < this.demoUntil) return;
    const act = (actor: 'host' | Player, type: string, data?: Record<string, unknown>) => this.act(actor, { id: randomUUID(), version: this.version, type, data });
    if (this.phase === 'LOBBY') {
      const intro = [
        ['Welcome to Don’t Drop Me! Viewers are randomly chosen from the streamer’s Twitch chat. Each viewer controls a character. One is secretly the impostor. The streamer must work out who’s bluffing.', 'game'],
        ['Three players know the secret word. The impostor knows only its category. Listen to each clue and spot who is bluffing.', 'rules'],
        ['Streamer, pick up each player and hear their clue. Friends go to Safe; your suspect goes to Impostor.', 'rules'],
      ] as const;
      if (this.demoIntro < intro.length) { const [text, type] = intro[this.demoIntro++]; this.demoSay(text, type); }
      else { this.players.forEach(p => { p.selected = true; p.connected = true; p.ready = true; }); act('host', 'start'); }
    } else if (this.phase === 'ROLE_DELIVERY') {
      if (this.demoPhase !== this.phase) { this.demoPhase = this.phase; this.demoSetup = 0; this.demoSaved.clear(); }
      if (this.demoSetup++ === 0) this.demoSay(`Meet the players: ${this.order.map(id => this.players.find(p => p.id === id)!.alias).join(', ')}. They’ll step up one at a time.`, 'players');
      else if (this.demoSetup === 2) this.demoSay(`Round ${this.round}. The category is ${this.category}. The word is ${this.word.word}. Three players know it; the impostor doesn’t. Watch how their clues compare!`, 'word');
      else act('host', 'clues');
    }
    else if (this.phase === 'CLUE_SUBMISSION') {
      const informed = this.active().filter(p => p.key !== this.impostorKey);
      for (const p of this.active().filter(p => !p.locked)) {
        const clue = p.key === this.impostorKey ? demoBluff(this.category, p.alias)[0] : DEMO_CLUES[this.word.word][informed.indexOf(p)];
        act(p, 'lock', { text: clue });
      }
    } else if (this.phase === 'INTERROGATION' && player) {
      if (this.demoTurn !== player.id) {
        this.demoTurn = player.id; this.demoOnHand = 0;
        this.demoSay(`${player.alias} is up next.`, 'turn', 'Game', player.id);
      } else if (onHand && this.demoClock - this.demoOnHand >= .9 && !this.spokenClues.has(player.id)) {
        this.spokenClues.add(player.id);
        this.demoSay(`My clue: “${player.clue}”`, 'clue', player.alias);
      } else if (!player.answer && onHand && this.spokenClues.has(player.id)) {
        const text = player.key === this.impostorKey ? demoBluff(this.category, player.alias)[1] : demoAnswer(player.clue);
        act(player, 'answer', { text }); this.demoSay(text, 'answer', player.alias);
      } else if (player.outcome === 'SAVE') {
        if (!this.demoSaved.has(player.id)) { this.demoSaved.add(player.id); this.demoSay(`${player.alias} is safe! Let’s hear from the next player.`, 'turn'); }
        else act('host', 'next');
      } else if (this.turn === this.order.length - 1 && player.answer && onHand && this.active().filter(p => p.outcome === 'SAVE').length === this.active().length - 1) act('host', 'next');
    } else if (this.phase === 'IMPOSTOR_GUESS') {
      if (this.demoPhase !== this.phase) { this.demoPhase = this.phase; this.demoSay('The impostor gets one private guess at the word. Then the final decision is yours.', 'game'); }
      else act(this.players.find(p => p.key === this.impostorKey)!, 'guess', { text: '' });
    } else if (this.demoPhase !== this.phase) {
      this.demoPhase = this.phase;
      if (this.phase === 'DECISIONS') this.demoSay('Time to decide. Carry the remaining players to the Safe cave or the Impostor cave. Who do you trust?', 'game');
      else if (this.phase === 'ROUND_END') this.demoSay(continuationText(this.round + 1), 'round');
      else if (this.phase === 'ESCAPE') this.demoSay('Impostor found! They will follow the curved coins to Safe. Pinch thumb and index finger around them to catch them.', 'game');
      else if (this.phase === 'REVEAL') this.demoSay(`${this.result}. ${this.players.find(p => p.key === this.impostorKey)!.alias} was the impostor. The word was ${this.word.word}.`, 'round');
    }
  }
  tick(now = Date.now()) {
    const dt = Math.min(.25, Math.max(0, (now - this.lastTick) / 1000)); this.lastTick = now;
    if (!this.hostConnected || this.paused) { this.captureSince = 0; return; }
    if (this.demo) this.demoStep(now, dt);
    if (this.mode === 'twitch' && this.twitchConnected && this.phase === 'LOBBY') {
      const eligible = this.players.filter(p => p.twitchId && this.joinQueue.has(p.twitchId) && p.connected && p.ready);
      if (eligible.length >= 4) { this.players.forEach(p => { p.selected = false; }); shuffle(eligible).slice(0, 4).forEach(p => { p.selected = true; }); this.start(); this.timer = 8; this.version++; }
    }
    if (this.mode === 'twitch' && this.phase === 'DECISIONS' && !this.current) { this.current = this.active().find(p => !p.outcome)?.id; if (this.current) { this.frame = undefined; this.version++; } }
    if (this.mode === 'twitch' && this.phase === 'ROLE_DELIVERY') {
      this.timer = Math.max(0, this.timer - dt);
      if (!this.timer) { this.phase = 'CLUE_SUBMISSION'; this.timer = 60; this.version++; }
    }

    if (this.phase === 'ROUND_END') {
      this.timer = Math.max(0, this.timer - dt);
      if (!this.timer) {
        this.players.forEach(p => { p.selected = p.selected && p.outcome === 'SAVE'; });
        this.start(false, true); this.version++;
      }
    } else if (this.phase === 'ESCAPE') {
      if (!this.tracking || now - this.frameAt > 700) { this.captureSince = 0; this.escapePaused += dt; this.input = { x: 0, y: 0, dash: false }; return; }
      this.escapePaused = 0;
      if (this.escape === 'starting') { const before = Math.ceil(this.escapeCountdown); this.escapeCountdown = Math.max(0, this.escapeCountdown - dt); if (Math.ceil(this.escapeCountdown) !== before) this.version++; if (!this.escapeCountdown) { this.escape = 'active'; this.captureSince = 0; this.version++; } }
      else if (this.escape === 'active') { this.escapeLeft = Math.max(0, this.escapeLeft - dt); if (!this.escapeLeft) { this.escape = 'timed_out'; this.finish('STREAMER WINS · ESCAPE TIMED OUT'); this.version++; } }
    } else if (['CLUE_SUBMISSION', 'IMPOSTOR_GUESS', 'INTERROGATION'].includes(this.phase) && this.timer > 0) {
      if (this.phase === 'INTERROGATION' && (!this.current || !this.spokenClues.has(this.current) || this.currentPlayer()?.answer || this.frame?.id !== this.current || !this.frame?.riding || !this.frame.active)) return;
      this.timer = Math.max(0, this.timer - dt); if (!this.timer) { this.paused = true; this.version++; }
    }
  }
}
