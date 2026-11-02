import { messageDuration, narrationText } from './shared/message-timing';
type Message = { name: string; text: string; type: string; playerId?: string; round?: number };
/** FIFO narration: every message receives its full reading time. */
export function streamMessages(player: HTMLElement, onShow: (message: Message) => void = () => {}, onComplete: (message: Message) => void = () => {}) {
  const box = document.createElement('div'); box.className = 'stream-message'; box.hidden = true;
  box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
  const avatar = document.createElement('span'); avatar.className = 'stream-message-avatar';
  const content = document.createElement('div'); content.className = 'stream-message-content';
  const name = document.createElement('strong'), message = document.createElement('p');
  content.append(name, message); box.append(avatar, content); player.append(box);
  const queue: Message[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined, active: Message | undefined;
  let paused = false, remaining = 0, deadline = 0;
  const show = (item: Message) => {
    active = { ...item, text: narrationText(item.text) };
    name.textContent = active.name; avatar.textContent = active.name.slice(0, 1).toUpperCase();
    message.textContent = active.text; box.dataset.type = active.type; box.hidden = false; onShow(active);
  };
  const arm = () => {
    if (paused || !active) return;
    deadline = Date.now() + remaining;
    timer = setTimeout(() => {
      timer = undefined; const finished = active; active = undefined;
      if (finished) onComplete(finished);
      next();
    }, remaining);
  };
  const next = () => {
    if (active || paused) return;
    const item = queue.shift();
    if (!item) { box.hidden = true; return; }
    show(item); remaining = messageDuration(item.type, item.text); arm();
  };
  const enqueue = (item: Message) => { queue.push(item); next(); };
  const clear = () => { if (timer) clearTimeout(timer); timer = undefined; queue.length = 0; active = undefined; remaining = 0; box.hidden = true; };
  return {
    say(name: string, text: string, type: string) { enqueue({ name, text, type }); },
    present: enqueue,
    explain(text: string, type = 'rules') { queue.unshift({ name: 'Game', text, type }); next(); },
    // Countdown/status updates reflect the live game clock, rather than queuing.
    status(item: Message) { clear(); show(item); },
    pause(value: boolean) {
      if (value === paused) return;
      paused = value;
      if (paused && timer) { remaining = Math.max(0, deadline - Date.now()); clearTimeout(timer); timer = undefined; }
      else if (!paused) { if (active && remaining > 0) arm(); else next(); }
    },
    clear,
  };
}
