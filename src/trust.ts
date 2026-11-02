import { naturalDemoText } from './shared/demo-dialogue';
import { mountWatch } from './watch';
import { io, type Socket } from 'socket.io-client';
import type { Action, ActorFrame, HostState, PrivateState, PublicState, SimState } from './shared/protocol';
import type { TrustScene } from './game/TrustScene';
import type { HandTracker } from './tracking/HandTracker';

const params = new URLSearchParams(location.search), credentials = new URLSearchParams(location.hash.slice(1));
let code = params.get('room') || params.get('broadcast') || '', token = credentials.get('host') || credentials.get('player') || '';
const kind = credentials.has('host') ? 'host' : credentials.has('player') ? 'player' : params.has('broadcast') ? 'broadcast' : 'landing';
let resetOnRefresh = kind === 'host' && (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload';
let refreshResetStarted = false;
export let scene: TrustScene | undefined;
let socket: Socket, state: PublicState, personal: PrivateState, host: HostState, tracker: HandTracker | undefined;
let seq = 0, queue: string[] = [], lastRender = '', privateKey = '', hostKey = '', connected = false;
let lastFrame: ActorFrame | undefined;
let restore: ActorFrame | undefined;
let startStreamCamera: (() => void) | undefined;
const drafts = new Map<string, string>();
const root = document.querySelector('main')!;
root.innerHTML = `<header><a class="wordmark" href="/"><span class="channel-avatar">d</span> dontdropme <i>✓</i></a><div class="privacy"><b></b><span id="connection">CONNECTING</span></div></header><section class="intro"><div><p class="eyebrow">HOLD MY CHAT · A COMMUNITY GAME</p><h1>Small friends. Big trust issues.</h1><p id="subtitle">Carry your chat past the floating towers. Try not to drop the good ones.</p></div><span id="room-badge" class="room-badge"></span></section><div id="notice" role="status" aria-live="polite"></div><section id="play-area" hidden><section id="stage"><video id="webcam" autoplay muted playsinline></video><div id="game"></div><div id="pause-overlay" hidden>PAUSED<span>Press P or use the player’s play control to resume.</span></div></section><section id="camera-bar" class="toolbar"><div class="actions"><button id="camera" class="primary">◉ Start Camera</button><button id="mouse">↖ Mouse Mode</button><button id="stop" hidden>Stop Camera</button><button id="debug" aria-pressed="false">Debug: Off</button></div><p id="message">Camera frames stay on your device. Mouse Mode is a rehearsal fallback.</p></section></section><section id="panel" class="trust-panel"></section><footer><span>HOLD MY CHAT / TRUST FALL</span><span id="mode-label">Four players. One secret. Your hands.</span></footer>`;
const updateWatch = mountWatch(root, kind);
const panel = document.querySelector<HTMLElement>('#panel')!;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') { const el = document.createElement(tag); el.textContent = text; el.className = className; return el; }
function notice(text: string) { document.querySelector('#notice')!.textContent = text; }
function button(text: string, fn: () => void, disabled = false, danger = false) { const b = node('button', text, danger ? 'danger' : ''); b.disabled = disabled; b.onclick = fn; return b; }
function group(...children: HTMLElement[]) { const el = node('div', '', 'button-row'); el.append(...children); return el; }
function heading(text: string, detail?: string) { panel.append(node('h2', text)); if (detail) panel.append(node('p', detail, 'muted')); }
function anchor(text: string, url: string) { const a = node('a', text); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; }
function textField(id: string, placeholder: string, max: number, value = '') {
  const input = node('input'); input.id = id; input.placeholder = placeholder; input.maxLength = max; input.value = drafts.get(id) ?? value;
  input.autocomplete = 'off'; input.oninput = () => drafts.set(id, input.value); return input;
}
function editable(id: string, placeholder: string, max: number, action: string, label: string, value = '') {
  const input = textField(id, placeholder, max, value), form = node('form', '', 'inline-form');
  const submit = button(label, () => {}); submit.type = 'submit'; form.append(input, submit);
  form.onsubmit = e => { e.preventDefault(); void act(action, { text: input.value }); }; return form;
}
async function act(type: string, data?: Record<string, unknown>): Promise<boolean> {
  if (!connected || !state) { notice('Connection lost. Waiting to reconnect…'); return false; }
  const action: Action = { id: crypto.randomUUID(), version: state.version, type, data };
  return await new Promise(resolve => socket.timeout(4000).emit('action', action, (err: unknown, reply: { ok: boolean; error?: string }) => {
    if (err || !reply?.ok) { notice(reply?.error || 'Action timed out. Reconnect and try again.'); resolve(false); } else { notice(''); resolve(true); }
  }));
}
async function createRoom(mode: 'local' | 'twitch', demo = false, replace = false) {
  try {
    const response = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, demo }) });
    const data = await response.json(); if (!response.ok) throw Error(data.error);
    const url = `/?room=${data.code}#host=${data.hostToken}`;
    if (replace) location.replace(url); else location.assign(url);
  } catch (error) { notice(error instanceof Error ? error.message : 'Cannot create room.'); }
}
async function landing() {
  document.querySelector('#connection')!.textContent = 'PRIVATE ROLES · REAL HANDS';
  if (params.has('join')) {
    heading('Join the live room', 'First type !join in the host’s Twitch chat. Then sign in here with that same Twitch account.');
    const a = anchor('Authenticate with Twitch →', `/auth/twitch?room=${encodeURIComponent(params.get('join')!)}`); a.target = '_self'; panel.append(a); return;
  }
  heading('Your chat. In the palm of your hand.', 'Host four players in private browser sessions. Everyone gets a clue. Someone gets a secret.');
  let twitch = false; try { twitch = (await (await fetch('/api/config')).json()).twitch; } catch { notice('Server unavailable. Run npm run dev or npm start.'); }
  panel.append(group(button('▶ Play solo demo', () => void createRoom('local', true)), button('Play with friends', () => void createRoom('local')), button(twitch ? 'Create Twitch Room' : 'Twitch · credentials required', () => void createRoom('twitch'), !twitch)));
  panel.append(node('p', 'Just you? Four little demo players will handle the clues and answers. You bring the hand, the hunches, and the questionable decisions.', 'muted'));

}
function renderHost() {
  const current = state.players.find(p => p.id === state.current), phase = state.phase;
  const connectTwitch = () => button(state.twitchConnected ? 'Reconnect Twitch channel' : 'Connect my Twitch channel', async () => {
    try {
      const response = await fetch('/api/twitch/connect', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ room: code }) });
      const data = await response.json(); if (data.url) location.assign(data.url); else notice(data.error || 'Twitch connection failed.');
    } catch { notice('Cannot reach the server. Reconnect and try again.'); }
  });
  if (state.mode === 'twitch' && phase !== 'LOBBY' && !state.twitchConnected) panel.append(connectTwitch());
  if (!['LOBBY', 'ROLE_DELIVERY', 'REVEAL', 'RESULTS'].includes(phase)) {
    heading(`Round ${state.round} · ${current ? current.name + '’s turn' : 'Waiting for players'}`);
    return;
  }
  if (phase !== 'LOBBY') heading(`${phase.charAt(0) + phase.slice(1).toLowerCase().replaceAll('_', ' ')} · Round ${state.round || '—'}`, `${state.category ? `Category: ${state.category} · ` : ''}${state.saved}/${Math.max(0, state.players.length - 1)} saved · ${state.dropped}/1 dropped`);

  if (phase === 'LOBBY') {
    if (state.demo) return;
    if (state.mode === 'local' && !state.demo) panel.append(button('▶ Start solo demo here', () => void act('demo'), state.players.some(p => p.connected)));
    if (state.mode === 'twitch') panel.append(connectTwitch());
    if (host?.links) {
      panel.append(node('p', 'Share each private link with exactly one player. Open four separate tabs for a local rehearsal. Keep this host panel off the broadcast.', 'muted'));
      const links = node('div', '', 'private-links');
      host.links.forEach(link => { const row = node('div'); row.append(anchor(`${link.name} · private player page ↗`, link.url), button('Copy link', () => { void navigator.clipboard.writeText(link.url).then(() => notice(`Copied ${link.name}’s private link.`)).catch(() => notice('Use the link’s context menu to copy it.')); })); links.append(row); }); panel.append(links);
    }
    if (state.mode === 'twitch' && host) { panel.append(anchor('Viewer join page ↗', host.joinUrl)); panel.append(node('p', `${state.players.filter(p => p.connected && p.ready).length} ready · Four verified viewers are chosen automatically.`, 'live-lobby-status')); }
    if (queue.length) panel.append(node('p', `Verified Twitch !join queue: ${queue.join(', ')}`));
    const selected = state.players.filter(p => p.selected);
    if (state.mode !== 'twitch') panel.append(button('Start round · deliver private roles', () => void act('start'), selected.length !== 4 || selected.some(p => !p.connected || !p.ready)));
  } else if (phase === 'ROLE_DELIVERY') panel.append(button('Everyone has their role · open clues', () => void act('clues')));
  else if (phase === 'CLUE_SUBMISSION') heading(`${state.clueCount}/${state.players.length} clues locked`, 'Clues are locked privately. Each player shares theirs when you pick them up.');
  else if (phase === 'INTERROGATION') {

    panel.append(group(button('Reopen answer', () => void act('reopen'), !current?.answer), button(current?.outcome ? 'Next player →' : 'Finish interview · decide later', () => void act('next'), !current?.answer)));
    if (state.mode === 'twitch') panel.append(button(state.votingOpen ? 'Close advisory voting' : 'Open advisory voting', () => void act('voting'), !state.twitchConnected || !current?.clue));
  } else if (phase === 'IMPOSTOR_GUESS') heading('Private word guess', 'The impostor must lock one guess or pass on their own page. Correctness stays hidden until the reveal.');
  else if (phase === 'DECISIONS') {
    heading(current ? `Carrying ${current.name}` : 'Choose a player to collect', 'Where you land is the decision. SAVE players you trust, or land your suspect on DROP in any order. Hold for the dwell ring to complete.');
    panel.append(node('p', 'If a player falls, bring the platform within reach so they can climb back on.', 'muted'));
  } else if (phase === 'ROUND_END') heading('IMPOSTOR IS STILL PRESENT', `Round ${state.round + 1} starts automatically with a new word. The good-cave survivors return to the queue.`);
  else if (phase === 'ESCAPE') heading(state.escape === 'starting' ? `ESCAPE IN ${state.escapeCountdown}…` : 'PINCH TO CATCH!', 'The impostor follows the curved coins to Safe automatically. Pinch thumb and index finger around them and hold briefly. Mouse mode: click and hold.');
  const playerActions = node('div', '', 'compact-player-actions');
  for (const p of state.players) {
    if (phase === 'DECISIONS' && !p.outcome) playerActions.append(button('Collect ' + p.name, () => void act('choose', { player: p.id }), current?.id === p.id));
    if (['INTERROGATION', 'DECISIONS'].includes(phase) && p.outcome === 'SAVE' && !state.dropped) playerActions.append(button('Undo SAVE · ' + p.name, () => void act('undo', { player: p.id })));
  }
  if (playerActions.childElementCount) panel.append(playerActions);
  if (['REVEAL', 'RESULTS'].includes(phase)) renderResult(true);
}
function renderResult(isHost: boolean) {
  const reveal = state.reveal; if (!reveal) return;
  heading(state.result || 'Round complete', `Secret word: ${reveal.word} · Impostor: ${reveal.impostor} · Guess: ${reveal.guess}${reveal.guessed ? ' ✓' : ''}`);
  if (state.rematch) heading('RUN IT BACK. SAME IMPOSTOR. NEW WORD.', 'Everyone returns under a new public alias. The impostor has no escape ability left.');
  if (isHost) panel.append(group(...(state.phase === 'REVEAL' ? [button('Show results', () => void act('results'))] : []), ...(state.rematch ? [button('Anonymous rematch →', () => { drafts.clear(); void act('rematch'); })] : []), button('New normal round / lobby', () => void act('lobby'))));
}
function renderPlayer() {
  if (!personal) { heading('Restoring your private session…'); return; }
  const me = state.players.find(p => p.id === personal.id);
  heading(personal.realName, me?.name !== personal.realName && me ? `Your public disguise: ${me.name}` : 'Your private companion page. Keep your role off stream.');
  if (state.phase === 'LOBBY') {
    panel.append(node('p', 'Three players receive a word. One receives only its category. Give a subtle clue, answer the host, and keep your identity secret. If caught as impostor, your character follows the curved escape coins automatically.'));
    panel.append(button(me?.ready ? '✓ Ready · tap to unready' : 'I’m ready', () => void act('ready'))); return;
  }
  if (!personal.role) { heading('You were dropped', 'You are out of this game. Watch the survivors continue with a new word.'); return; }
  const role = node('div', '', `role-card ${personal.role}`);
  role.append(node('p', personal.role === 'impostor' ? 'YOU ARE THE IMPOSTOR' : 'YOU KNOW THE WORD', 'eyebrow'), node('h2', personal.word || `Category: ${personal.category}`), node('p', personal.role === 'impostor' ? 'Blend in. Infer the word from the clues. Your role stays private.' : 'Give a clue that proves you know it without saying the word.'));
  panel.append(role);
  if (state.phase === 'ROLE_DELIVERY') heading('Hold tight', 'The host will open clue submission shortly.');
  if (state.phase === 'CLUE_SUBMISSION') {
    heading(`${state.clueCount}/${state.players.length} clues locked`, personal.locked ? 'Your clue is locked.' : 'One to three words. 32 characters. No links or secret-word disclosure.');
    if (personal.locked) panel.append(node('blockquote', personal.clue));
    else {
      const input = textField('clue', 'Your subtle clue', 32, personal.clue); panel.append(input, group(button('Save draft', () => void act('clue', { text: input.value })), button('Lock clue', () => void act('lock', { text: input.value }))));
    }
  }
  if (state.phase === 'INTERROGATION') {
    const current = state.players.find(p => p.id === state.current);
    heading(current?.id === personal.id ? 'YOUR TURN · listen to the host' : `${current?.name} is being questioned`, 'You have about 15 seconds to answer. The host can extend or reopen.');
    if (state.current === personal.id) {
      if (personal.answer) panel.append(node('blockquote', personal.answer));
      else panel.append(editable('answer', 'Answer the host’s question', 100, 'answer', 'Submit answer'));
    }
  }
  if (state.phase === 'IMPOSTOR_GUESS') {
    if (personal.role === 'impostor' && !personal.guessLocked) { heading('One guess. Or pass.', 'Correct guesses win regardless of the accusation.'); panel.append(editable('guess', 'What was the secret word?', 40, 'guess', 'Lock guess'), button('Pass · lock without a guess', () => void act('guess', { text: '' }))); }
    else heading('Private guess window', 'Waiting for the impostor to lock their guess.');
  }
  if (state.phase === 'DECISIONS') heading('The host is deciding', 'Watch the stream. Good-cave survivors return if the impostor is still present.');
  if (state.phase === 'ROUND_END') heading('IMPOSTOR IS STILL PRESENT', `Round ${state.round + 1} starts automatically. Good-cave survivors return to the queue with a new word.`);
  if (state.phase === 'ESCAPE' && personal.role === 'impostor') {
    heading(state.escape === 'starting' ? `Escape in ${state.escapeCountdown}…` : 'RUNNING TO SAFE', 'Your character automatically follows the curved coin trail. The streamer must pinch you before you reach the Safe cave.');
    const countdown = node('p', '', 'timer'); countdown.id = 'escape-countdown'; panel.append(countdown);
  } else if (state.phase === 'ESCAPE') heading('The chase is on', 'The impostor follows the coins to Safe. The streamer must pinch to catch them.');
  if (['REVEAL', 'RESULTS'].includes(state.phase)) renderResult(false);
}
function renderBroadcast() {
  heading(`${state.phase.replaceAll('_', ' ')} · ${state.category || 'WAITING FOR PLAYERS'}`, `${state.saved}/3 saved · ${state.clueCount}/${state.players.length} clues locked`);
  if (['REVEAL', 'RESULTS'].includes(state.phase)) renderResult(false);

}
function render() {
  if (!state) return;
  const focus = document.activeElement instanceof HTMLInputElement ? { id: document.activeElement.id, start: document.activeElement.selectionStart } : undefined;
  panel.replaceChildren();
  document.querySelector('#room-badge')!.textContent = `ROOM ${state.code}`;
  document.querySelector('#mode-label')!.textContent = state.demo ? 'SOLO DEMO · SIMULATED PLAYERS · NO TWITCH VOTES' : state.mode === 'local' ? 'LOCAL REHEARSAL · NO TWITCH PARTICIPANTS' : `LIVE TWITCH · ${state.twitchConnected ? 'CHAT CONNECTED' : 'VOTING OFFLINE'}`;
  document.querySelector('#subtitle')!.textContent = kind === 'player' ? 'Private companion · your role is yours alone.' : kind === 'broadcast' ? 'Public broadcast · game overlay for OBS / screen capture.' : 'A secret in the chat. A little life in your hands.';
  if (kind === 'host') renderHost(); else if (kind === 'player') renderPlayer(); else renderBroadcast();
  if (focus) { const input = document.getElementById(focus.id) as HTMLInputElement | null; input?.focus(); input?.setSelectionRange(focus.start, focus.start); }
  updateTimer();
}
function updateTimer() {
  const timer = document.querySelector('#phase-timer'); if (timer) timer.textContent = `${state.paused ? 'Ⅱ PAUSED · ' : ''}${!state.hostConnected ? 'HOST DISCONNECTED · ' : ''}${state.phase === 'ESCAPE' ? state.escape === 'starting' ? `Escape starts in ${state.escapeCountdown}…` : `${state.escapeLeft.toFixed(1)}s chase · pinch to catch` : state.timer ? `${state.timer}s` : ''}`;
  const countdown = document.querySelector('#escape-countdown'); if (countdown) countdown.textContent = `${state.escape === 'starting' ? `Escape starts in ${state.escapeCountdown}…` : 'Following the coins to Safe'}${state.paused || !state.hostConnected ? ' · PAUSED' : ''}`;
  document.querySelector<HTMLElement>('#pause-overlay')!.hidden = !state.paused && state.hostConnected;
}
async function bootGame() {
  const [{ default: Phaser }, { TrustScene }, { HandTracker }] = await Promise.all([import('phaser'), import('./game/TrustScene'), import('./tracking/HandTracker')]);
  scene = new TrustScene(); scene.debug = params.get('debug') === '1'; scene.spectator = kind === 'broadcast'; scene.onAction = act; scene.onFrame = frame => socket?.emit('frame', frame, ++seq);
  scene.onReady = () => { if (state) scene!.sync(state); if (restore) { scene!.restoreFrame(restore); restore = undefined; } startStreamCamera?.(); };
  document.querySelector<HTMLElement>('#play-area')!.hidden = false;
  new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: 960, height: 540, transparent: true, antialias: true, physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 720 }, fps: 60, fixedStep: true } }, scene: [scene], scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER }, banner: false });
  if (kind === 'broadcast') { document.querySelector<HTMLElement>('#camera-bar')!.hidden = true; return; }
  const debug = document.querySelector<HTMLButtonElement>('#debug')!;
  const syncDebug = () => { debug.textContent = scene!.debug ? 'Debug: On' : 'Debug: Off'; debug.setAttribute('aria-pressed', String(scene!.debug)); };
  document.addEventListener('game-round-finished', event => { if (state && ['REVEAL', 'RESULTS'].includes(state.phase) && state.round === (event as CustomEvent).detail) void act('restart'); });
  document.addEventListener('game-toggle-pause', () => { if (state) void act('pause'); });
  syncDebug(); debug.onclick = () => { scene!.debug = !scene!.debug; syncDebug(); };
  const camera = document.querySelector<HTMLButtonElement>('#camera')!, stop = document.querySelector<HTMLButtonElement>('#stop')!;
  const message = (s: string) => { document.querySelector('#message')!.textContent = s; };
  tracker = new HandTracker(document.querySelector<HTMLVideoElement>('#webcam')!, p => scene!.observe(p), e => { scene!.setMode('mouse'); message(e); notice('Camera unavailable · pointer control is active.'); stop.hidden = true; }, () => scene!.paused, pinch => scene!.observePinch(pinch));
  let request = 0;
  const stopCamera = () => { request++; tracker!.stop(); camera.disabled = false; camera.textContent = '◉ Start Camera'; stop.hidden = true; };
  const startCamera = async () => { const current = ++request; camera.disabled = true; stop.hidden = false; scene!.setMode('idle'); message('Starting camera…'); try { if (await tracker!.start() && current === request) { scene!.setMode('camera'); message(`Camera active · ${tracker!.delegate}. Bump the towers and collect gold on your way to the caves.`); } } catch (e) { if (current === request) { scene!.setMode('mouse'); message(e instanceof Error ? e.message : String(e)); notice('Camera unavailable · allow camera access in your browser. Pointer control is active.'); } } finally { if (current === request) { camera.disabled = false; camera.textContent = '◉ Start Camera'; } } };
  camera.onclick = () => { void startCamera(); };
  let cameraStarted = false;
  startStreamCamera = () => { if (cameraStarted) return; cameraStarted = true; void startCamera(); };
  if (scene.frank) startStreamCamera();
  stop.onclick = () => { stopCamera(); scene!.setMode('idle'); message('Camera stopped.'); };
  document.querySelector<HTMLButtonElement>('#mouse')!.onclick = () => { stopCamera(); scene!.setMode('mouse'); message('MOUSE TEST MODE · bump towers, collect coins, then carry to a cave.'); };
  document.addEventListener('visibilitychange', () => { scene!.resetTiming(); if (document.hidden && state && !state.paused && !['LOBBY', 'RESULTS', 'REVEAL'].includes(state.phase)) void act('pause'); });
  window.addEventListener('pagehide', () => tracker?.stop());
}
if (kind === 'landing') void landing();
else {
  if ((kind === 'host' && !resetOnRefresh) || kind === 'broadcast') void bootGame();
  socket = io({ auth: { room: code, token, kind }, reconnection: true });
  socket.on('connect', () => { connected = true; document.querySelector('#connection')!.textContent = 'ROOM CONNECTED'; notice(''); seq = 0; });
  socket.on('disconnect', () => { connected = false; document.querySelector('#connection')!.textContent = 'RECONNECTING'; notice('Connection lost. Progression is frozen until the host reconnects.'); if (scene) { scene.paused = true; scene.physics?.pause(); } });
  socket.on('connect_error', error => {
    if (kind === 'host' && resetOnRefresh && error.message.startsWith('Room not found')) { location.replace('/?autojoin=1'); return; }
    notice(error.message);
  });
  let advancingTurn = '';
  socket.on('state', (next: PublicState) => {
    if (resetOnRefresh && !next.demo) { resetOnRefresh = false; void bootGame(); }
    if (resetOnRefresh) {
      if (!refreshResetStarted) {
        refreshResetStarted = true; notice('Starting a fresh room…');
        if (next.demo) location.replace('/?autojoin=1');
        else void createRoom(next.mode, next.demo, true);
      }
      return;
    }
    if (next.demo) {
      next.players.forEach(p => { if (p.name === 'Frank') p.name = 'Leo'; });
      next.demoMessages?.forEach(m => { if (m.name === 'Frank') m.name = 'Leo'; m.text = naturalDemoText(m.text.replace(/\bFrank\b/g, 'Leo'), m.type, m.name, next.category || ''); });
    }
    if (state && state.round !== next.round) { drafts.clear(); }
    state = next; updateWatch(next); scene?.sync(state);
    const fingerprint = `${next.version}:${next.phase}:${next.current}`;
    if (fingerprint !== lastRender) { lastRender = fingerprint; render(); } else updateTimer();
    
    const actor = next.players.find(p => p.id === next.current);
    const turnKey = `${next.round}:${next.current}`;
    if (kind === 'host' && next.mode === 'local' && !next.demo && next.phase === 'INTERROGATION' && actor?.answer && actor.outcome === 'SAVE' && !next.paused && advancingTurn !== turnKey) {
      advancingTurn = turnKey; void act('next').then(ok => { if (!ok) advancingTurn = ''; });
    }
  });
  socket.on('twitch-chat', message => document.dispatchEvent(new CustomEvent('twitch-chat', { detail: message })));
  socket.on('private', (next: PrivateState) => { const key = JSON.stringify(next); personal = next; if (key !== privateKey) { privateKey = key; render(); } });
  socket.on('host', (next: HostState) => { const key = JSON.stringify(next); host = next; if (key !== hostKey) { hostKey = key; render(); } });
  socket.on('queue', (next: string[]) => { if (next.join() !== queue.join()) { queue = next; render(); } });
  socket.on('simulation', (next: SimState) => { if (scene) scene.sim = next; });
  socket.on('frame', (frame: ActorFrame) => { lastFrame = frame; scene?.receiveFrame(frame);  });
  socket.on('restore', (frame: ActorFrame) => { restore = frame; if (scene?.frank && state) { scene.restoreFrame(frame); restore = undefined; } });
}
