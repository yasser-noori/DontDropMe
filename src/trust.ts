import { io, type Socket } from 'socket.io-client';
import type { Action, ActorFrame, HostState, PrivateState, PublicState, SimState } from './shared/protocol';
import { WALLS, SANCTUARY } from './shared/maze';
import type { TrustScene } from './game/TrustScene';
import type { HandTracker } from './tracking/HandTracker';

const params = new URLSearchParams(location.search), credentials = new URLSearchParams(location.hash.slice(1));
let code = params.get('room') || params.get('broadcast') || '', token = credentials.get('host') || credentials.get('player') || '';
const kind = credentials.has('host') ? 'host' : credentials.has('player') ? 'player' : params.has('broadcast') ? 'broadcast' : 'landing';
export let scene: TrustScene | undefined;
let socket: Socket, state: PublicState, personal: PrivateState, host: HostState, tracker: HandTracker | undefined;
let seq = 0, queue: string[] = [], lastRender = '', privateKey = '', hostKey = '', connected = false;
let lastFrame: ActorFrame | undefined;
let restore: ActorFrame | undefined;
let demoMouseStarted = false;
function startDemoMouse() {
  if (kind === 'host' && state?.demo && scene?.frank && !demoMouseStarted) {
    demoMouseStarted = true; scene.setMode('mouse');
    document.querySelector('#message')!.textContent = 'SOLO DEMO · Players answer automatically. Carry them through the maze. Switch to Start Camera anytime.';
  }
}
const drafts = new Map<string, string>();
const root = document.querySelector('main')!;
root.innerHTML = `<header><a class="wordmark" href="/">HOLD MY <span>CHAT</span><i>TRUST FALL / V1</i></a><div class="privacy"><b></b><span id="connection">CONNECTING</span></div></header><section class="intro"><div><p class="eyebrow">FOUR VIEWERS. THREE TRUTHS. ONE IMPOSTOR.</p><h1>Trust is a hands-on game.</h1><p id="subtitle">Carry your community. Question everything.</p></div><span id="room-badge" class="room-badge"></span></section><div id="notice" role="status" aria-live="polite"></div><section id="play-area" hidden><section id="stage"><video id="webcam" autoplay muted playsinline></video><div id="game"></div><div id="pause-overlay" hidden>PAUSED<span>Resume from the host controls.</span></div></section><section id="camera-bar" class="toolbar"><div class="actions"><button id="camera" class="primary">◉ Start Camera</button><button id="mouse">↖ Mouse Mode</button><button id="stop" hidden>Stop Camera</button></div><p id="message">Camera frames stay on your device. Mouse Mode is a rehearsal fallback.</p></section></section><section id="panel" class="trust-panel"></section><footer><span>HOLD MY CHAT / TRUST FALL</span><span id="mode-label">LOCAL REHEARSAL · PRIVATE ROLES</span></footer>`;
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
async function createRoom(mode: 'local' | 'twitch', demo = false) {
  try {
    const response = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, demo }) });
    const data = await response.json(); if (!response.ok) throw Error(data.error);
    location.assign(`/?room=${data.code}#host=${data.hostToken}`);
  } catch (error) { notice(error instanceof Error ? error.message : 'Cannot create room.'); }
}
async function landing() {
  document.querySelector('#connection')!.textContent = 'PRIVATE ROLES · REAL HANDS';
  if (params.has('join')) {
    heading('Join the live room', 'First type !join in the host’s Twitch chat. Then sign in here with that same Twitch account.');
    const a = anchor('Authenticate with Twitch →', `/auth/twitch?room=${encodeURIComponent(params.get('join')!)}`); a.target = '_self'; panel.append(a); return;
  }
  heading('Who will you trust?', 'Host four players in private browser sessions. Everyone gets a clue. Someone gets a secret.');
  let twitch = false; try { twitch = (await (await fetch('/api/config')).json()).twitch; } catch { notice('Server unavailable. Run npm run dev or npm start.'); }
  panel.append(group(button('▶ Solo Demo · auto players', () => void createRoom('local', true)), button('Create Local Rehearsal', () => void createRoom('local')), button(twitch ? 'Create Twitch Room' : 'Twitch · credentials required', () => void createRoom('twitch'), !twitch)));
  panel.append(node('p', 'Testing alone? Solo Demo supplies four simulated players, auto clues and answers, and an escaping demo impostor. You control the hand and SAVE/DROP decisions.', 'muted'));
  const cards = node('div', '', 'rules-grid');
  for (const [title, text] of [['01 / BLEND IN', 'Three players know the word. One only knows the category. Lock a clue, then answer one question.'], ['02 / HOLD ON', 'The host carries each player under the first wall and over the second. Save three, drop one.'], ['03 / TRUST FALL', 'Find the impostor and the chase begins. Twelve seconds. One dash. One chance to escape.']]) { const card = node('article'); card.append(node('h3', title), node('p', text)); cards.append(card); }
  panel.append(cards, anchor('Original rescue prototype ↗', '/?prototype'));
}
function renderHost() {
  const current = state.players.find(p => p.id === state.current), phase = state.phase;
  heading(`${phase.replaceAll('_', ' ')} · Round ${state.round || '—'}`, `${state.category ? `Category: ${state.category} · ` : ''}${state.saved}/3 saved · ${state.dropped}/1 dropped`);
  if (state.demo) panel.append(node('p', 'SOLO DEMO · Four simulated players. Clues, answers, WAIT arming, Next Player, and guess/pass are automatic. You carry, choose SAVE/DROP, and catch the escaping bot.', 'muted'));
  const timer = node('p', '', 'timer'); timer.id = 'phase-timer'; panel.append(timer);
  if (host) {
    panel.append(group(anchor('Public broadcast ↗', host.broadcastUrl), ...(state.mode === 'twitch' ? [anchor('Viewer companion link ↗', host.joinUrl)] : [])));
  }
  if (phase === 'LOBBY') {
    if (state.mode === 'local' && !state.demo) panel.append(button('▶ Start solo demo here', () => void act('demo'), state.players.some(p => p.connected)));
    if (state.mode === 'twitch') panel.append(button('Connect my Twitch channel', async () => {
      const response = await fetch('/api/twitch/connect', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ room: code }) });
      const data = await response.json(); if (data.url) location.assign(data.url); else notice(data.error);
    }));
    if (host?.links) {
      panel.append(node('p', 'Share each private link with exactly one player. Open four separate tabs for a local rehearsal. Keep this host panel off the broadcast.', 'muted'));
      const links = node('div', '', 'private-links');
      host.links.forEach(link => { const row = node('div'); row.append(anchor(`${link.name} · private player page ↗`, link.url), button('Copy link', () => { void navigator.clipboard.writeText(link.url).then(() => notice(`Copied ${link.name}’s private link.`)).catch(() => notice('Use the link’s context menu to copy it.')); })); links.append(row); }); panel.append(links);
    }
    const candidates = node('div', '', 'player-grid');
    host?.candidates.forEach(p => { const card = node('article', '', 'player-card'); card.append(node('h3', p.name), node('p', `${p.connected ? '● Connected' : '○ Not connected'} · ${p.ready ? 'READY' : 'Waiting'}`), button(p.selected ? '✓ Selected' : 'Select player', () => void act('selectLobby', { player: p.id }))); candidates.append(card); }); panel.append(candidates);
    if (queue.length) panel.append(node('p', `Verified Twitch !join queue: ${queue.join(', ')}`));
    const selected = state.players.filter(p => p.selected);
    panel.append(button('Start round · deliver private roles', () => void act('start'), selected.length !== 4 || selected.some(p => !p.connected || !p.ready)));
  } else if (phase === 'ROLE_DELIVERY') panel.append(button('Everyone has their role · open clues', () => void act('clues')));
  else if (phase === 'CLUE_SUBMISSION') heading(`${state.clueCount}/4 clues locked`, 'Clues stay private until everyone locks. Extend time if someone needs help.');
  else if (phase === 'INTERROGATION') {
    heading(`On the hand: ${current?.name || 'Waiting'}`, 'Ask one question aloud. Arm WAIT, carry the player through the maze, and wait for them to walk off.');
    panel.append(group(button(state.armed === 'WAIT' ? 'WAIT armed ✓' : 'Arm WAIT delivery', () => void act('arm', { zone: 'WAIT' }), !!current?.delivered), button('Reopen answer', () => void act('reopen'), !current?.answer), button('Next player →', () => void act('next'), !current?.delivered || !current?.answer)));
    if (state.mode === 'twitch') panel.append(button(state.votingOpen ? 'Close advisory voting' : 'Open advisory voting', () => void act('voting'), !state.twitchConnected));
  } else if (phase === 'IMPOSTOR_GUESS') heading('Private word guess', 'The impostor must lock one guess or pass on their own page. Correctness stays hidden until the reveal.');
  else if (phase === 'DECISIONS') {
    heading(current ? `Carrying ${current.name}` : 'Choose a player to collect', 'Save three first. Then arm DROP for your final suspect. Each decision requires a visible walk-off and 700 ms dwell.');
    panel.append(group(button('Arm SAVE', () => void act('arm', { zone: 'SAVE' }), !current || state.saved >= 3), button('Arm DROP', () => void act('arm', { zone: 'DROP' }), !current || state.saved !== 3, true), button('Disarm', () => void act('disarm'), !state.armed), button('Return active player to pickup', () => { void act('disarm').then(ok => { if (ok) scene?.returnToPickup(); }); }, !current)));
  } else if (phase === 'ESCAPE') heading('IMPOSTOR FOUND · CATCH THEM!', 'Move the hand near the character and hold contact. The sanctuary blocks your paddle. Tracking loss freezes the chase clock.');
  if (!['LOBBY', 'ROLE_DELIVERY'].includes(phase)) {
    const cards = node('div', '', 'player-grid');
    state.players.forEach(p => {
      const card = node('article', '', `player-card ${p.id === state.current ? 'current' : ''}`);
      const total = p.votes.trust + p.votes.drop;
      card.append(node('h3', `${p.name}${p.outcome ? ` · ${p.outcome}` : ''}`), node('p', p.clue ? `“${p.clue}”` : 'Clue private'), node('p', p.answer || 'No answer yet', 'muted'), node('small', `${p.connected ? '●' : '○'} ${p.delivered ? 'Delivered' : 'Not delivered'} · Advisory ${total ? Math.round(p.votes.trust / total * 100) : 0}% trust · ${p.votes.trust} trust / ${p.votes.drop} drop · n=${total}`));
      if (phase === 'DECISIONS' && !p.outcome) card.append(button('Collect this player', () => void act('choose', { player: p.id }), !!state.armed || !!current));
      if (phase === 'DECISIONS' && p.outcome === 'SAVE') card.append(button('Undo SAVE', () => void act('undo', { player: p.id })));
      cards.append(card);
    }); panel.append(cards);
  }
  if (['REVEAL', 'RESULTS'].includes(phase)) renderResult(true);
  if (!['LOBBY', 'REVEAL', 'RESULTS'].includes(phase)) panel.append(group(button(state.paused ? '▶ Resume' : 'Ⅱ Pause round', () => void act('pause')), button('+15 seconds / resume', () => void act('extend'), !['CLUE_SUBMISSION', 'INTERROGATION', 'IMPOSTOR_GUESS'].includes(phase)), button('Restart lobby', () => { if (confirm('Restart this round? Roles and submissions will be cleared when the next round starts.')) void act('restart'); }, false, true)));
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
    panel.append(node('p', 'Three players receive a word. One receives only its category. Give a subtle clue, answer the host, and keep your identity secret. If caught as impostor, WASD or the touch pad moves you during the chase; Space dashes once.'));
    panel.append(button(me?.ready ? '✓ Ready · tap to unready' : 'I’m ready', () => void act('ready'))); return;
  }
  if (!personal.role) { heading('Waiting for selection', 'The host will choose four connected, ready players.'); return; }
  const role = node('div', '', `role-card ${personal.role}`);
  role.append(node('p', personal.role === 'impostor' ? 'YOU ARE THE IMPOSTOR' : 'YOU KNOW THE WORD', 'eyebrow'), node('h2', personal.word || `Category: ${personal.category}`), node('p', personal.role === 'impostor' ? 'Blend in. Infer the word from the clues. Your role stays private.' : 'Give a clue that proves you know it without saying the word.'));
  panel.append(role);
  if (state.phase === 'ROLE_DELIVERY') heading('Hold tight', 'The host will open clue submission shortly.');
  if (state.phase === 'CLUE_SUBMISSION') {
    heading(`${state.clueCount}/4 clues locked`, personal.locked ? 'Your clue is locked.' : 'One to three words. 32 characters. No links or secret-word disclosure.');
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
  if (state.phase === 'DECISIONS') heading('The host is deciding', 'Watch the stream. Three will be saved. One will be dropped.');
  if (state.phase === 'ESCAPE' && personal.role === 'impostor') {
    heading('ESCAPE · GO!', 'Only you see the ring. Reach its center inside the sanctuary. WASD / touch moves, Space dashes once.');
    const countdown = node('p', '', 'timer'); countdown.id = 'escape-countdown'; panel.append(countdown);
    const canvas = node('canvas'); canvas.id = 'escape-map'; canvas.width = 960; canvas.height = 540; panel.append(canvas);
    const pad = node('div', '', 'dpad');
    for (const [label, key] of [['↑', 'KeyW'], ['←', 'KeyA'], ['↓', 'KeyS'], ['→', 'KeyD'], ['DASH', 'Space']]) {
      const b = node('button', label); b.setAttribute('aria-label', key === 'Space' ? 'Dash' : `Move ${label}`);
      b.onpointerdown = e => { e.preventDefault(); b.setPointerCapture(e.pointerId); keys.add(key); sendInput(); };
      b.onpointerup = b.onpointercancel = () => { keys.delete(key); sendInput(); }; pad.append(b);
    } panel.append(pad); drawMap();
  } else if (state.phase === 'ESCAPE') heading('The chase is on', `${state.escapeLeft.toFixed(1)} seconds remain. Watch the stream.`);
  if (['REVEAL', 'RESULTS'].includes(state.phase)) renderResult(false);
}
function renderBroadcast() {
  heading(`${state.phase.replaceAll('_', ' ')} · ${state.category || 'WAITING FOR PLAYERS'}`, `${state.saved}/3 saved · ${state.clueCount}/4 clues locked`);
  if (['REVEAL', 'RESULTS'].includes(state.phase)) renderResult(false);
  else {
    const list = node('div', '', 'player-grid'); state.players.forEach(p => { const card = node('article', '', 'player-card'); const total = p.votes.trust + p.votes.drop; card.append(node('h3', p.name), node('p', p.clue || 'Clue private'), node('p', p.answer || '', 'muted'), node('small', `${p.votes.trust} trust / ${p.votes.drop} drop · ${total ? Math.round(p.votes.trust / total * 100) : 0}% trust · n=${total}`)); list.append(card); }); panel.append(list);
  }
}
function render() {
  if (!state) return;
  const focus = document.activeElement instanceof HTMLInputElement ? { id: document.activeElement.id, start: document.activeElement.selectionStart } : undefined;
  panel.replaceChildren();
  document.querySelector('#room-badge')!.textContent = `ROOM ${state.code}`;
  document.querySelector('#mode-label')!.textContent = state.demo ? 'SOLO DEMO · SIMULATED PLAYERS · NO TWITCH VOTES' : state.mode === 'local' ? 'LOCAL REHEARSAL · NO TWITCH PARTICIPANTS' : `LIVE TWITCH · ${state.twitchConnected ? 'CHAT CONNECTED' : 'VOTING OFFLINE'}`;
  document.querySelector('#subtitle')!.textContent = kind === 'player' ? 'Private companion · your role is yours alone.' : kind === 'broadcast' ? 'Public broadcast · game overlay for OBS / screen capture.' : 'Host controls · keep private links off the broadcast.';
  if (kind === 'host') renderHost(); else if (kind === 'player') renderPlayer(); else renderBroadcast();
  if (focus) { const input = document.getElementById(focus.id) as HTMLInputElement | null; input?.focus(); input?.setSelectionRange(focus.start, focus.start); }
  updateTimer();
}
function updateTimer() {
  const timer = document.querySelector('#phase-timer'); if (timer) timer.textContent = `${state.paused ? 'Ⅱ PAUSED · ' : ''}${!state.hostConnected ? 'HOST DISCONNECTED · ' : ''}${state.phase === 'ESCAPE' ? `${state.escapeLeft.toFixed(1)}s chase · ${state.escape}` : state.timer ? `${state.timer}s` : ''}`;
  const countdown = document.querySelector('#escape-countdown'); if (countdown) countdown.textContent = `${state.escapeLeft.toFixed(1)}s · ${state.escape}${state.paused || !state.hostConnected ? ' · PAUSED' : ''}`;
  document.querySelector<HTMLElement>('#pause-overlay')!.hidden = !state.paused && state.hostConnected;
}
function drawMap() {
  const canvas = document.querySelector<HTMLCanvasElement>('#escape-map'), ring = personal?.ring;
  if (!canvas || !ring) return; const c = canvas.getContext('2d')!; c.clearRect(0, 0, 960, 540); c.fillStyle = '#0b1527'; c.fillRect(0, 0, 960, 540);
  c.fillStyle = '#24445a'; WALLS.forEach(w => c.fillRect(w.x, w.y, w.w, w.h));
  c.fillStyle = '#b6a0ff22'; c.fillRect(SANCTUARY.x, SANCTUARY.y, SANCTUARY.w, SANCTUARY.h);
  c.strokeStyle = '#cda3ff'; c.lineWidth = 5; c.beginPath(); c.arc(ring.x, ring.y, 23, 0, Math.PI * 2); c.stroke();
  c.font = '17px sans-serif'; c.fillStyle = '#ded1ff'; c.fillText('YOUR ESCAPE RING', 740, 60);
  if (lastFrame) { c.fillStyle = '#74f4df'; c.fillRect(lastFrame.paddle.x - 72, lastFrame.paddle.y, 144, 8); c.fillStyle = '#ffbf77'; c.beginPath(); c.arc(lastFrame.position.x, lastFrame.position.y - 18, 13, 0, Math.PI * 2); c.fill(); }
}
const keys = new Set<string>();
function sendInput() {
  if (!connected || state?.phase !== 'ESCAPE' || personal?.role !== 'impostor' || state.current !== personal.id || state.escape !== 'active') return;
  socket.emit('input', { x: Number(keys.has('KeyD')) - Number(keys.has('KeyA')), y: Number(keys.has('KeyS')) - Number(keys.has('KeyW')), dash: keys.has('Space') });
}
window.addEventListener('keydown', e => { if (kind === 'player' && state?.phase === 'ESCAPE' && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code) && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); keys.add(e.code); sendInput(); } });
window.addEventListener('keyup', e => { keys.delete(e.code); sendInput(); });
window.addEventListener('blur', () => { keys.clear(); sendInput(); });
window.addEventListener('pointerup', () => { if (kind === 'player') { keys.clear(); sendInput(); } });
window.addEventListener('pointercancel', () => { if (kind === 'player') { keys.clear(); sendInput(); } });
if (kind === 'player') setInterval(sendInput, 50);
async function bootGame() {
  const [{ default: Phaser }, { TrustScene }, { HandTracker }] = await Promise.all([import('phaser'), import('./game/TrustScene'), import('./tracking/HandTracker')]);
  scene = new TrustScene(); scene.spectator = kind === 'broadcast'; scene.onAction = act; scene.onFrame = frame => socket?.emit('frame', frame, ++seq);
  scene.onReady = () => { if (state) scene!.sync(state); if (restore) { scene!.restoreFrame(restore); restore = undefined; } startDemoMouse(); };
  document.querySelector<HTMLElement>('#play-area')!.hidden = false;
  new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: 960, height: 540, transparent: true, antialias: true, physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 720 }, fps: 60, fixedStep: true } }, scene: [scene], scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, banner: false });
  if (kind === 'broadcast') { document.querySelector<HTMLElement>('#camera-bar')!.hidden = true; return; }
  const camera = document.querySelector<HTMLButtonElement>('#camera')!, stop = document.querySelector<HTMLButtonElement>('#stop')!;
  const message = (s: string) => { document.querySelector('#message')!.textContent = s; };
  tracker = new HandTracker(document.querySelector<HTMLVideoElement>('#webcam')!, p => scene!.observe(p), e => { scene!.setMode('idle'); message(e); stop.hidden = true; }, () => scene!.paused);
  let request = 0;
  const stopCamera = () => { request++; tracker!.stop(); camera.disabled = false; camera.textContent = '◉ Start Camera'; stop.hidden = true; };
  camera.onclick = async () => { const current = ++request; camera.disabled = true; stop.hidden = false; scene!.setMode('idle'); message('Allow camera access. Loading local hand model…'); try { if (await tracker!.start() && current === request) { scene!.setMode('camera'); message(`Camera active · ${tracker!.delegate}. Carry under wall 01 and over wall 02.`); } } catch (e) { message(e instanceof Error ? e.message : String(e)); } finally { if (current === request) { camera.disabled = false; camera.textContent = '◉ Start Camera'; } } };
  stop.onclick = () => { stopCamera(); scene!.setMode('idle'); message('Camera stopped.'); };
  document.querySelector<HTMLButtonElement>('#mouse')!.onclick = () => { stopCamera(); scene!.setMode('mouse'); message('MOUSE TEST MODE · use the same physical route. Under wall 01, over wall 02.'); };
  document.addEventListener('visibilitychange', () => { scene!.resetTiming(); if (document.hidden && state && !state.paused && !['LOBBY', 'RESULTS', 'REVEAL'].includes(state.phase)) void act('pause'); });
  window.addEventListener('pagehide', () => tracker?.stop());
}
if (kind === 'landing') void landing();
else {
  if (kind === 'host' || kind === 'broadcast') void bootGame();
  socket = io({ auth: { room: code, token, kind }, reconnection: true });
  socket.on('connect', () => { connected = true; document.querySelector('#connection')!.textContent = 'ROOM CONNECTED'; notice(''); seq = 0; });
  socket.on('disconnect', () => { connected = false; document.querySelector('#connection')!.textContent = 'RECONNECTING'; notice('Connection lost. Progression is frozen until the host reconnects.'); keys.clear(); if (scene) { scene.paused = true; scene.physics?.pause(); } });
  socket.on('connect_error', error => notice(error.message));
  socket.on('state', (next: PublicState) => {
    if (state && state.round !== next.round) { drafts.clear(); keys.clear(); }
    state = next; scene?.sync(state); startDemoMouse();
    const fingerprint = `${next.version}:${next.phase}:${next.current}`;
    if (fingerprint !== lastRender) { lastRender = fingerprint; render(); } else updateTimer();
    drawMap();
  });
  socket.on('private', (next: PrivateState) => { const key = JSON.stringify(next); personal = next; if (key !== privateKey) { privateKey = key; render(); } });
  socket.on('host', (next: HostState) => { const key = JSON.stringify(next); host = next; if (key !== hostKey) { hostKey = key; render(); } });
  socket.on('queue', (next: string[]) => { if (next.join() !== queue.join()) { queue = next; render(); } });
  socket.on('simulation', (next: SimState) => { if (scene) scene.sim = next; });
  socket.on('frame', (frame: ActorFrame) => { lastFrame = frame; scene?.receiveFrame(frame); drawMap(); });
  socket.on('restore', (frame: ActorFrame) => { restore = frame; if (scene?.frank && state) { scene.restoreFrame(frame); restore = undefined; } });
}
