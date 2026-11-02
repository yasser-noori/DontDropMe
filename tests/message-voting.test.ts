import { afterEach, expect, it, vi } from 'vitest';
import { mountVoting } from '../src/voting';
import { streamMessages } from '../src/stream-message';
import { messageDuration } from '../src/shared/message-timing';

class Element {
  textContent = ''; innerHTML = ''; hidden = false; style: Record<string, string> = {}; dataset: Record<string, string> = {};
  children: Element[] = []; attrs = new Map<string, string>(); nodes = new Map<string, Element>();
  className = ''; href = ''; onclick?: unknown;
  classList = { toggle: vi.fn(), remove: vi.fn() };
  append(...children: Element[]) { this.children.push(...children); }
  after() {} addEventListener() {}
  setAttribute(key: string, value: string) { this.attrs.set(key, value); }
  removeAttribute(key: string) { this.attrs.delete(key); }
  querySelector(key: string) { if (!this.nodes.has(key)) this.nodes.set(key, new Element()); return this.nodes.get(key)!; }
}
function dom() {
  const tabs = new Element(), about = new Element(), created: Element[] = [];
  vi.stubGlobal('document', { hidden: false, createElement: () => { const el = new Element(); created.push(el); return el; }, querySelector: () => tabs, querySelectorAll: () => tabs.children });
  vi.stubGlobal('window', { addEventListener() {} });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return { tabs, about, created };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('waits for a completed hint before opening each player poll', () => {
  const { about, created } = dom();
  const voting = mountVoting(about as unknown as HTMLElement), view = created[1];
  voting.update(1, false, { id: 'a', name: 'Alex' });
  expect(view.hidden).toBe(true); expect(view.querySelector('h2').textContent).toContain('Waiting for Alex');
  expect(view.innerHTML).not.toContain('Demo simulation');
  voting.speak('Alex'); expect(view.hidden).toBe(false); expect(view.querySelector('h2').textContent).toBe('Is Alex the impostor?');
  voting.update(1, false, { id: 'b', name: 'Sarah' });
  expect(view.querySelector('h2').textContent).toContain('Waiting for Sarah');
  voting.speak('Alex'); expect(view.querySelector('h2').textContent).toContain('Waiting for Sarah');
  voting.speak('Sarah'); expect(view.querySelector('h2').textContent).toBe('Is Sarah the impostor?');
});
it('completes a hint after its reading time and cancels interrupted cards', () => {
  dom(); vi.useFakeTimers();
  const complete = vi.fn(), player = new Element();
  const speech = streamMessages(player as unknown as HTMLElement, () => {}, complete);
  speech.say('Alex', 'A subtle hint', 'clue');
  vi.advanceTimersByTime(messageDuration('clue', 'A subtle hint') - 1); expect(complete).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(complete).toHaveBeenCalledWith({ name: 'Alex', text: 'A subtle hint', type: 'clue' });
  complete.mockClear(); speech.say('Sarah', 'Another hint', 'clue'); speech.clear();
  vi.advanceTimersByTime(20000); expect(complete).not.toHaveBeenCalled();
  expect(messageDuration('rules', 'Instructions')).toBe(messageDuration('game', 'Instructions'));
  expect(messageDuration('answer', 'Short answer')).toBeLessThan(4000);
});

it('uses the same WPM for all card types and scales longer text without a cap', () => {
  const short = 'A calm steady narration keeps every message easy to follow';
  const long = Array(5).fill(short).join(' ');
  expect(messageDuration('rules', short)).toBe(messageDuration('answer', short));
  expect(messageDuration('rules', long)).toBeGreaterThan(messageDuration('rules', short) * 4);
  expect(messageDuration('game', short + '.')).toBeGreaterThan(messageDuration('game', short));
  expect(messageDuration('rules', Array(180).fill('word').join(' '))).toBe(60800);
  expect(messageDuration('game', 'SAVE')).toBe(messageDuration('game', 'the Safe cave'));
});
it('queues early incoming narration without skipping messages and freezes reading time on pause', () => {
  dom(); vi.useFakeTimers();
  const shown = vi.fn(), complete = vi.fn();
  const speech = streamMessages(new Element() as unknown as HTMLElement, shown, complete);
  const first = { name: 'Game', text: 'First message.', type: 'game' };
  const second = { name: 'Game', text: 'Second message.', type: 'rules' };
  const third = { name: 'Game', text: 'Third message.', type: 'answer' };
  speech.present(first); speech.present(second); speech.present(third);
  expect(shown).toHaveBeenCalledTimes(1);
  const duration = messageDuration(first.type, first.text);
  vi.advanceTimersByTime(duration - 100); speech.pause(true);
  vi.advanceTimersByTime(30000); expect(complete).not.toHaveBeenCalled();
  speech.pause(false); vi.advanceTimersByTime(100);
  expect(shown.mock.calls.map(([m]) => m.text)).toEqual([first.text, second.text]);
  vi.advanceTimersByTime(messageDuration(second.type, second.text));
  expect(shown.mock.calls.map(([m]) => m.text)).toEqual([first.text, second.text, third.text]);
  vi.advanceTimersByTime(messageDuration(third.type, third.text));
  expect(complete).toHaveBeenCalledTimes(3);
});

it('unlocks a character only after its queued introduction is actually visible', async () => {
  const { introductionShown, markIntroductionShown } = await import('../src/character-introductions');
  dom(); vi.useFakeTimers();
  const playerId = 'intro-after-visible';
  const speech = streamMessages(new Element() as unknown as HTMLElement, item => {
    if (item.playerId && item.round !== undefined) markIntroductionShown(item.round, item.playerId);
  });
  speech.present({ name: 'Game', text: 'Finish this explanation first.', type: 'rules' });
  speech.present({ name: 'Game', text: 'Sarah is up next.', type: 'turn', playerId, round: 7 });
  expect(introductionShown(7, playerId)).toBe(false);
  vi.advanceTimersByTime(messageDuration('rules', 'Finish this explanation first.') - 1);
  expect(introductionShown(7, playerId)).toBe(false);
  vi.advanceTimersByTime(1);
  expect(introductionShown(7, playerId)).toBe(true);
  expect(introductionShown(8, playerId)).toBe(false);
});
