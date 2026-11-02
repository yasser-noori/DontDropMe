import { DEMO_VIEWERS } from './shared/demo-audience';
/** Cosmetic audience simulation; never submits real votes or reads hidden roles. */
export function mountVoting(about: HTMLElement, onFirstOpen: () => void = () => {}) {
  const viewerLabels = Array.from(document.querySelectorAll<HTMLElement>('.viewer-count'));
  for (const channel of Array.from(document.querySelectorAll<HTMLElement>('.side-item .channel'))) {
    if (channel.textContent?.toLowerCase().replace(/[^a-z]/g, '') === 'dontdropme') {
      const label = channel.closest('.side-item')?.querySelector<HTMLElement>('.viewers');
      if (label) viewerLabels.push(label);
    }
  }
  for (const label of viewerLabels) {
    for (const child of Array.from(label.childNodes)) if (child.nodeType === 3) child.textContent = '';
    label.append(document.createTextNode(DEMO_VIEWERS.toLocaleString()));
  }
  const tab = document.createElement('a'); tab.href = '#'; tab.className = 'channel-tab'; tab.textContent = 'Voting';
  document.querySelector('.channel-tabs')!.append(tab);
  const view = document.createElement('section'); view.className = 'audience-voting'; view.hidden = true;
  view.innerHTML = `<div class="voting-heading"><div><span class="voting-eyebrow">LIVE VIEWER VOTES</span><h2></h2><p>What does chat think?</p></div></div><div class="voting-body"><div class="vote-pie" role="img"></div><div class="vote-legend"><div><i class="vote-dot lying"></i><span>Yes</span><strong class="lying-percent"></strong></div><div><i class="vote-dot honest"></i><span>No</span><strong class="honest-percent"></strong></div><p class="vote-count"></p></div></div>`;
  about.after(view);
  const pie = view.querySelector<HTMLElement>('.vote-pie')!, title = view.querySelector('h2')!;
  const lying = view.querySelector('.lying-percent')!, honest = view.querySelector('.honest-percent')!, count = view.querySelector('.vote-count')!;
  const polls = new Map<string, { yes: number; no: number; bias: number }>();
  let pending = '';
  let simulation = true, connected = false, open = false;
  let current = '', turn = '', round = 0, shownYes = 0, shownNo = 0, nextUpdate = 0, previous = 0, paused = false, frame = 0;
  let explained = false;
  const select = () => {
    if (!explained) { explained = true; onFirstOpen(); }
    document.querySelectorAll('.channel-tab').forEach(t => { t.classList.toggle('active', t === tab); t.removeAttribute('aria-current'); });
    tab.setAttribute('aria-current', 'page'); about.hidden = true; view.hidden = false;
  };
  tab.onclick = e => { e.preventDefault(); select(); };
  document.querySelectorAll<HTMLElement>('.channel-tab').forEach(other => {
    if (other !== tab) other.addEventListener('click', () => { view.hidden = true; });
  });
  const animate = (now: number) => {
    const dt = Math.min((now - previous) / 1000, .05); previous = now;
    if (simulation && current && !paused && !document.hidden && now >= nextUpdate) {
      const poll = polls.get(current)!;
      const burst = Math.min(DEMO_VIEWERS - poll.yes - poll.no, 4 + Math.floor(Math.random() * 19));
      const share = Math.max(.08, Math.min(.92, poll.bias / 100 + (Math.random() - .5) * .85));
      const yes = Math.round(burst * share);
      poll.yes += yes; poll.no += burst - yes;
      nextUpdate = now + 450 + Math.random() * 850;
    }
    if (current && !view.hidden) {
      const poll = polls.get(current)!;
      if (!paused) {
        const blend = 1 - Math.exp(-dt * 5);
        shownYes += (poll.yes - shownYes) * blend; shownNo += (poll.no - shownNo) * blend;
      }
      const yes = Math.max(0, Math.round(shownYes)), no = Math.max(0, Math.round(shownNo)), total = yes + no;
      const percent = total ? yes / total * 100 : 50;
      pie.style.background = `conic-gradient(#9660ed 0% ${percent}%, #62c9ad ${percent}% 100%)`;
      pie.setAttribute('aria-label', `${current}: Yes ${yes}, No ${no}. ${simulation ? 'Demo simulation.' : 'Verified Twitch chat votes.'}`);
      lying.textContent = `${yes.toLocaleString()} · ${Math.round(percent)}%`;
      honest.textContent = `${no.toLocaleString()} · ${100 - Math.round(percent)}%`;
      count.textContent = simulation ? `${total.toLocaleString()} of ${DEMO_VIEWERS.toLocaleString()} viewers voted` : !connected ? 'Twitch chat disconnected · votes paused' : `${total.toLocaleString()} verified votes · ${open ? '!trust / !drop' : 'voting closed'}`;
    }
    frame = requestAnimationFrame(animate);
  };
  frame = requestAnimationFrame(animate);
  window.addEventListener('pagehide', () => cancelAnimationFrame(frame), { once: true });
  const showPlayer = (name: string) => {
    if (!polls.has(name)) {
      const hash = [...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, round + 17);
      polls.set(name, { yes: 0, no: 0, bias: 18 + hash % 65 });
    }
    if (current !== name) { shownYes = 0; shownNo = 0; nextUpdate = 0; }
    current = name;
    title.textContent = `Is ${name} the impostor?`; select();
  };
  return {
    update(nextRound: number, isPaused: boolean, player?: { id: string; name: string; votes?: { trust: number; drop: number } }, live?: { simulation: boolean; connected: boolean; open: boolean }) {
      paused = isPaused; simulation = live?.simulation ?? true; connected = live?.connected ?? false; open = live?.open ?? false;
      if (!simulation) for (const label of viewerLabels) label.textContent = 'Live Twitch';
      if (round !== nextRound) { round = nextRound; polls.clear(); current = ''; turn = ''; }
      const key = player ? `${round}:${player.id}` : '';
      if (key !== turn) {
        turn = key; pending = player?.name || ''; current = ''; shownYes = 0; shownNo = 0;
        title.textContent = player ? `Waiting for ${player.name}’s hint` : 'Waiting for the next player';
        lying.textContent = '0 · 50%'; honest.textContent = '0 · 50%';
        pie.style.background = 'conic-gradient(#9660ed 0% 50%, #62c9ad 50% 100%)';
        count.textContent = 'Voting opens after the hint.';
      }
      if (!simulation && player) {
        const poll = polls.get(player.name) || { yes: 0, no: 0, bias: 50 };
        poll.yes = player.votes?.drop || 0; poll.no = player.votes?.trust || 0; polls.set(player.name, poll);
        if (open && player.name !== current) showPlayer(player.name);
      }
    },
    speak(name: string) { if (name === pending && name !== current) showPlayer(name); },
  };
}
