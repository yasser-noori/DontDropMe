import { introductionShown, markIntroductionShown } from './character-introductions';
import { escapeCountdownText } from './shared/escape';
import { continuationText, messageDuration } from './shared/message-timing';
import { mountVoting } from './voting';
import { streamMessages } from './stream-message';
import type { PublicState } from './shared/protocol';
import template from './twitch-template';
import './twitch-template.css';
import './watch-layout.css';

export function mountWatch(root: HTMLElement, kind: string) {
  document.body.classList.add('twitch-page');
  if (kind === 'player') document.body.classList.add('companion-page');
  const playArea = root.querySelector<HTMLElement>('#play-area')!;
  const toolbar = root.querySelector<HTMLElement>('#camera-bar')!;
  toolbar.hidden = true;
  const panel = root.querySelector<HTMLElement>('#panel')!;
  const notice = root.querySelector<HTMLElement>('#notice')!;
  const status = document.createElement('div'); status.className = 'game-status';
  for (const id of ['connection', 'room-badge', 'subtitle', 'mode-label']) status.append(root.querySelector(`#${id}`)!);
  const shell = document.createElement('div'); shell.innerHTML = template;
  root.replaceWith(...Array.from(shell.childNodes));
  document.querySelector('#feed')!.append(playArea);
  const content = document.querySelector('.channel-content')!;
  const debug = root.querySelector<HTMLButtonElement>('#debug') || toolbar.querySelector<HTMLButtonElement>('#debug')!;
  debug.className = 'button-purple'; debug.hidden = kind !== 'host';
  document.querySelector('#followBtn')!.after(debug);
  const controls = document.createElement('section'); controls.className = 'host-controls'; controls.append(toolbar, notice, status, panel);
  content.querySelector('.channel-header')!.after(controls);
  const about = document.querySelector<HTMLElement>('.about')!; about.hidden = false;
  const mockTag = document.querySelector<HTMLElement>('.mock-tag')!; mockTag.textContent = 'Twitch UI demo · example viewers and local chat. Game updates are live.';
  const toast = (message: string) => { const el = document.querySelector<HTMLElement>('#toast')!; el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2600); };
  document.querySelectorAll<HTMLElement>('[data-demo-link],[data-demo-button]').forEach(el => el.onclick = e => { e.preventDefault(); toast('Twitch interface demo. No account or purchase action is connected.'); });
  document.querySelector('.brand')!.setAttribute('href', '/');
  document.querySelector('#searchForm')!.addEventListener('submit', e => { e.preventDefault(); toast('Search is a preview in this demo.'); });
  document.querySelector('#followBtn')!.addEventListener('click', e => { const b = e.currentTarget as HTMLElement; const on = b.classList.toggle('following'); b.querySelector('span')!.textContent = on ? 'Following' : 'Follow'; });
  document.querySelector('#subBtn')!.addEventListener('click', () => toast('Subscriptions are not enabled in this demo.'));
  document.querySelector('#collapseSidebar')!.addEventListener('click', () => document.body.classList.toggle('sidebar-hidden'));
  document.querySelector('#collapseChat')!.addEventListener('click', () => document.body.classList.toggle('chat-hidden'));
  document.querySelector('#theaterBtn')!.addEventListener('click', () => document.body.classList.toggle('theater'));
  document.querySelector('#fullscreenBtn')!.addEventListener('click', () => { const p = document.querySelector<HTMLElement>('#player')!; if (document.fullscreenElement) void document.exitFullscreen(); else if (p.classList.contains('stream-fullscreen')) p.classList.remove('stream-fullscreen'); else if (p.requestFullscreen) void p.requestFullscreen().catch(() => p.classList.add('stream-fullscreen')); else p.classList.add('stream-fullscreen'); });
  document.querySelector('#shareBtn')!.addEventListener('click', () => { const url = new URL(location.origin); const room = new URLSearchParams(location.search).get('room'); if (room) url.searchParams.set('broadcast', room); void navigator.clipboard.writeText(url.href).then(() => toast('Public viewing link copied.')).catch(() => toast('Could not copy the link.')); });
  document.querySelector('#muteBtn')!.addEventListener('click', () => toast('This game has no audio track.'));
  document.querySelector('#playBtn')!.addEventListener('click', () => { if (kind === 'host') document.dispatchEvent(new Event('game-toggle-pause')); });
  document.querySelectorAll<HTMLElement>('.channel-tab').forEach(tab => tab.onclick = e => { e.preventDefault(); document.querySelectorAll('.channel-tab').forEach(t => { t.classList.remove('active'); t.removeAttribute('aria-current'); }); tab.classList.add('active'); tab.setAttribute('aria-current', 'page'); about.hidden = tab.textContent !== 'About'; if (tab.textContent === 'Chat') document.body.classList.remove('chat-hidden'); else if (['Videos', 'Schedule'].includes(tab.textContent || '')) toast('This section is a template preview.'); });
  let pickupPromptShown = false;
  const voting = mountVoting(about);
  const log = document.querySelector<HTMLElement>('#chatMessages')!;
  log.replaceChildren();
  const welcome = document.createElement('div'); welcome.className = 'chat-notice'; welcome.textContent = 'Viewers: type !join in Twitch chat while the lobby is open. During a character’s turn, !trust votes safe and !drop votes impostor. Viewer votes are advice—the streamer decides.'; log.append(welcome);
  const append = (name: string, message: string) => { const row = document.createElement('div'), who = document.createElement('span'), msg = document.createElement('span'); row.className = 'chat-line'; who.className = 'who purple'; who.textContent = name; msg.className = 'msg'; msg.textContent = ': ' + message; row.append(who, msg); log.append(row); while(log.children.length > 100) log.children[1].remove(); log.scrollTop = log.scrollHeight; };
  if (kind === 'host') {
    try {
      const saved = sessionStorage.getItem('demo-join-chat');
      sessionStorage.removeItem('demo-join-chat');
      if (saved) for (const row of JSON.parse(saved)) append(row.name, row.text);
    } catch { /* Chat history is optional when storage is unavailable. */ }
  }
  document.addEventListener('twitch-chat', event => { const m = (event as CustomEvent).detail; append(m.name, m.text); });
  const speech = streamMessages(document.querySelector<HTMLElement>('#player')!, item => { append(item.name, item.text); if (item.playerId && item.round !== undefined) markIntroductionShown(item.round, item.playerId); }, item => {
    if (item.type === 'clue') voting.speak(item.name);
  });
  document.querySelector('#chatForm')!.addEventListener('submit', e => { e.preventDefault(); const input = document.querySelector<HTMLInputElement>('#chatInput')!; if(input.value.trim()) append('you', input.value.trim()); input.value=''; });
  let phase = '', round = -1, current = ''; const seen = new Set<string>(); const outcomes = new Map<string,string>();
  let escapeCue = '';
  let outcomeCue = '';
  const outcome = document.createElement('div'); outcome.className = 'round-feedback'; outcome.hidden = true;
  document.querySelector('#player')!.append(outcome);
  const introductionsQueued = new Set<string>();
  const seenDemo = new Set<number>(); let demoMessage = -1;
  if (kind === 'landing') {
    const splash = document.createElement('div'); splash.className = 'demo-splash';
    const logo = document.createElement('img'); logo.className = 'demo-splash-logo';
    logo.src = '/assets/branding/dont-drop-me-icon.jpg'; logo.alt = 'Dont Drop Me'; logo.width = 1280; logo.height = 853;
    const start = document.createElement('button'); start.className = 'stream-start'; start.setAttribute('aria-label', 'Play demo');
    start.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.8c0-.8.9-1.3 1.6-.9l10 6.2c.7.4.7 1.4 0 1.8l-10 6.2c-.7.4-1.6-.1-1.6-.9z" fill="currentColor"/></svg><span>Play</span>';
    let joining = false, cancelled = false;
    window.addEventListener('pagehide', () => { cancelled = true; }, { once: true });
    const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
    const begin = async () => {
      if (joining) return; joining = true; start.disabled = true;
      const lobby = document.createElement('div'); lobby.className = 'join-lobby';
      lobby.innerHTML = '<img class="join-brand-icon" src="/assets/branding/dont-drop-me-icon-transparent.png" alt="DontDropMe!" width="1280" height="853"><h2>Waiting for players<span class="join-dots">…</span></h2><div class="join-slots"></div><p>Type <b>!join</b> in chat to join the game.</p>';
      splash.replaceChildren(lobby); splash.classList.add('joining');
      const names = ['Leo', 'Sarah', 'Mia', 'Alex'];
      const slots = lobby.querySelector('.join-slots')!; slots.setAttribute('aria-live', 'polite');
      for (let i = 0; i < names.length; i++) { const slot = document.createElement('div'); slot.className = 'join-slot'; slot.textContent = `Player ${i + 1}`; slots.append(slot); }
      const opening = 'The lobby is open! Type !join in Twitch chat to enter. We’re waiting for four players.';
      speech.present({ name: 'Game', text: opening, type: 'game' });
      await wait(messageDuration('game', opening));
      for (let i = 0; i < names.length; i++) {
        if (cancelled) return;
        append(names[i], '!join');
        const slot = slots.children[i] as HTMLElement; slot.textContent = names[i]; slot.classList.add('joined');
        slots.setAttribute('aria-label', `${i + 1} players joined`);
        const left = names.length - i - 1;
        const joined = left ? `${names[i]} is in! ${left === 1 ? 'One spot left.' : `${left} spots left.`}` : 'Alex is in! All four players have joined. Let’s get started.';
        speech.present({ name: 'Game', text: joined, type: 'game' });
        await wait(messageDuration('game', joined));
      }
      if (cancelled) return;
      lobby.querySelector('h2')!.textContent = 'Everyone’s here!';
      try {
        const history = Array.from(log.querySelectorAll('.chat-line')).map(row => ({ name: row.querySelector('.who')!.textContent, text: row.querySelector('.msg')!.textContent!.replace(/^: /, '') }));
        sessionStorage.setItem('demo-join-chat', JSON.stringify(history));
      } catch { /* Continue playing without persisted chat. */ }
      const button = Array.from(panel.querySelectorAll('button')).find(b => b.textContent?.includes('Play solo demo'));
      button?.click();
    };
    start.onclick = () => { void begin(); };
    splash.append(logo, start); document.querySelector('#feed')!.append(splash);
    if (new URLSearchParams(location.search).has('autojoin')) void begin();
  }
  if (kind === 'player') { document.querySelector<HTMLElement>('#player')!.hidden = true; }
  let liveLobby: HTMLElement | undefined, liveCue = '';
  return (state: PublicState) => {
    if (state.mode === 'twitch') {
      mockTag.textContent = state.twitchConnected ? 'Connected to Twitch · verified chat joins and votes' : 'Twitch disconnected · reconnect from the host lobby';
      if (state.twitchChannel) document.querySelector('.channel-title')!.textContent = state.twitchChannel.name;
      if (!liveLobby) {
        liveLobby = document.createElement('div'); liveLobby.className = 'demo-splash joining';
        liveLobby.innerHTML = '<div class="join-lobby"><img class="join-brand-icon" src="/assets/branding/dont-drop-me-icon-transparent.png" alt="DontDropMe!"><h2>Waiting for viewers</h2><div class="join-slots"></div><p>Type !join in Twitch chat, then open the viewer join page.</p></div>';
        document.querySelector('#feed')!.append(liveLobby);
      }
      liveLobby.hidden = state.phase !== 'LOBBY';
      if (!liveLobby.hidden) {
        const slots = liveLobby.querySelector('.join-slots')!; slots.replaceChildren();
        const names = state.waitingViewers || [];
        for (let i = 0; i < 4; i++) { const slot = document.createElement('div'); const ready = state.players.find(p => p.name === names[i] && p.ready && p.connected); slot.className = `join-slot${ready ? ' joined' : ''}`; slot.textContent = names[i] ? names[i] + (ready ? ' ✓' : '') : `Viewer ${i + 1}`; slots.append(slot); }
        const cue = `lobby:${state.twitchConnected}`;
        if (liveCue !== cue) { liveCue = cue; speech.status({ name: 'Game', text: state.twitchConnected ? 'Chat is connected! Viewers, type !join, open the viewer join page, and mark ready. Four ready viewers will be chosen at random.' : 'Streamer, connect Twitch to open the lobby. Viewers can then join from Twitch chat.', type: 'rules' }); }
      } else if (state.phase === 'ROLE_DELIVERY' && liveCue !== `roles:${state.round}`) { liveCue = `roles:${state.round}`; speech.status({ name: 'Game', text: `Round ${state.round}. The category is ${state.category}. Selected viewers: check the private role on the viewer page.`, type: 'rules' }); }
    }

    speech.pause(state.paused || !state.hostConnected);
    if (['REVEAL', 'RESULTS'].includes(state.phase) && state.result) {
      const key = `${state.round}:${state.result}`;
      if (key !== outcomeCue) {
        outcomeCue = key;
        const win = state.result.startsWith('STREAMER WINS');
        outcome.textContent = win ? 'Streamer wins!' : 'Impostor wins!'; outcome.className = `round-feedback ${win ? 'win' : 'loss'}`; outcome.hidden = false;
        speech.status({ name: 'Game', text: win ? 'The streamer wins! The impostor is caught. Getting ready for the next players…' : 'The impostor wins! The streamer missed them. Getting ready for the next players…', type: 'round' });
        setTimeout(() => { outcome.hidden = true; document.dispatchEvent(new CustomEvent('game-round-finished', { detail: state.round })); }, 4500);
      }
      return;
    }

    voting.update(state.round, state.paused || !state.hostConnected, ['INTERROGATION', 'DECISIONS'].includes(state.phase) ? state.players.find(p => p.id === state.current) : undefined, { simulation: state.demo, connected: state.twitchConnected, open: state.votingOpen });
    if (state.phase === 'ESCAPE') {
      if (!escapeCue) speech.clear();
      const cue = state.escape === 'starting' ? `starting:${state.escapeCountdown}` : state.escape;
      if (cue !== escapeCue) {
        escapeCue = cue;
        const text = state.escape === 'starting'
          ? escapeCountdownText(state.escapeCountdown || 0)
          : state.escape === 'captured' ? 'Caught! The streamer must return the character to the Impostor cave to win.'
          : 'GO! The impostor is following the coins to Safe. Pinch around them and hold briefly to catch them. Mouse mode: click and hold.';
        const escaping = state.players.find(p => p.id === state.current);
        speech.status({ name: 'Game', text: escaping ? `${escaping.name}: ${text}` : text, type: 'game', playerId: escaping?.id, round: state.round });
      }
      for (const item of state.demoMessages || []) seenDemo.add(item.id);
      return;
    }
    if (escapeCue) speech.clear();
    escapeCue = '';
    if (state.demo) {
      const messages = state.demoMessages || [], latest = messages.at(-1);
      // Replay missed chat history on reconnect, but only show the current card.
      for (const item of messages) if (item.id !== latest?.id && !seenDemo.has(item.id)) { seenDemo.add(item.id); append(item.name, item.text); }
      if (latest && latest.id !== demoMessage) {
        demoMessage = latest.id;
        if (!seenDemo.has(latest.id)) {
          seenDemo.add(latest.id);
          const introKey = state.current ? `${state.round}:${state.current}` : '';
          const actor = state.players.find(p => p.id === state.current);
          // A late join may have missed the original intro card entirely.
          if (actor && !introductionShown(state.round, actor.id) && !introductionsQueued.has(introKey)
              && latest.playerId !== actor.id && ['INTERROGATION', 'DECISIONS', 'ESCAPE'].includes(state.phase)
              && !['word', 'players'].includes(latest.type)) {
            introductionsQueued.add(introKey);
            speech.present({ name: 'Game', text: `${actor.name} is up next.`, type: 'turn', playerId: actor.id, round: state.round });
          }
          if (latest.playerId) introductionsQueued.add(`${latest.round}:${latest.playerId}`);
          let text = latest.text;
          if (!pickupPromptShown && latest.type === 'turn' && text.endsWith(' is up next.')) {
            pickupPromptShown = true; text += ` Streamer, pick up ${text.replace(' is up next.', '')} to hear their hint.`;
          }
          speech.present({ ...latest, text });
        }
      }
      return;
    }
    if(round !== state.round) { round=state.round; seen.clear(); outcomes.clear(); speech.clear(); }
    if(phase !== state.phase) { phase=state.phase; append('Game', state.result || `${state.phase.replaceAll('_',' ')} · Round ${state.round}${state.category ? ' · '+state.category : ''}`); }
    if(current !== state.current) { speech.clear(); current=state.current || ''; const p=state.players.find(p=>p.id===current); if(p) speech.present({ name: 'Game', text: `${p.name} is up next.`, type: 'turn', playerId: p.id, round: state.round }); }
    if(state.phase === 'ROUND_END' && !seen.has('round-end')) { seen.add('round-end'); speech.clear(); speech.say('Game', continuationText(state.round + 1), 'round'); }
    if(state.reveal && !seen.has('reveal')) { seen.add('reveal'); append('Game', `Reveal: ${state.reveal.impostor} was the impostor. The word was ${state.reveal.word}. Guess: ${state.reveal.guess}.`); }
    for(const p of state.players) {
      for(const [type,value] of [['clue',p.clue],['answer',p.answer]] as const) if(value && !seen.has(`${p.id}:${type}:${value}`)) { seen.add(`${p.id}:${type}:${value}`); const text = type==='clue' ? `My clue: “${value}”` : value; if(p.id === state.current && !state.reveal) speech.say(p.name, text, type); else append(p.name, text); }
      if((p.outcome || '') !== (outcomes.get(p.id) || '')) { if(p.outcome) append('Game',`${p.name} → ${p.outcome}`); else if(outcomes.has(p.id)) append('Game',`${p.name}'s SAVE was undone.`); outcomes.set(p.id,p.outcome || ''); }
    }
  };
}
