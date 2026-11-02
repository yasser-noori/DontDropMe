import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TwitchChat, ensureTwitchAuthorization } from '../server/Twitch';
import { Room } from '../server/Room';
class FakeSocket {
  static all: FakeSocket[] = [];
  closed = false;
  onmessage?: (event: { data: string }) => Promise<void>;
  onclose?: () => void; onerror?: () => void;
  constructor(public url: string) { FakeSocket.all.push(this); }
  close() { if (this.closed) return; this.closed = true; this.onclose?.(); }
  async emit(type: string, payload: unknown, id = 'message1') { await this.onmessage?.({ data: JSON.stringify({ metadata: { message_type: type, message_id: id, subscription_type: 'channel.chat.message' }, payload }) }); }
}
beforeEach(() => { vi.useFakeTimers(); FakeSocket.all = []; vi.stubGlobal('WebSocket', FakeSocket); vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/validate') ? { client_id: 'app', user_id: '123', scopes: ['user:read:chat'], expires_in: 14400 } : { data: [] }), { status: url.includes('/validate') ? 200 : 202 }))); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('subscribes to verified chat, deduplicates messages and rejects events from another channel', async () => {
  const r = new Room('twitch'), chat = vi.fn();
  const adapter = new TwitchChat(r, 'access', 'refresh', '123', 'app', 'secret', () => {}, chat);
  await adapter.start(); const socket = FakeSocket.all[0];
  await socket.emit('session_welcome', { session: { id: 'session', keepalive_timeout_seconds: 10 } });
  expect(r.twitchConnected).toBe(true);
  const payload = { event: { broadcaster_user_id: '123', chatter_user_id: '456', chatter_user_name: 'RealViewer', message: { text: '!join' } } };
  await socket.emit('notification', payload); await socket.emit('notification', payload);
  expect(r.joinQueue.get('456')).toBe('RealViewer'); expect(chat).toHaveBeenCalledTimes(1);
  await socket.emit('notification', { event: { ...payload.event, broadcaster_user_id: '999', chatter_user_id: '789' } }, 'other');
  expect(r.joinQueue.size).toBe(1);
  const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/subscriptions'))!;
  expect(JSON.parse(String(request[1]?.body)).condition).toEqual({ broadcaster_user_id: '123', user_id: '123' });
  adapter.stop();
});
it('validates authorization before connecting and stops revoked subscriptions', async () => {
  const r = new Room('twitch'), adapter = new TwitchChat(r, 'access', 'refresh', '123', 'app', 'secret', () => {});
  await adapter.start(); await FakeSocket.all[0].emit('revocation', {});
  expect(r.twitchConnected).toBe(false); expect(r.votingOpen).toBe(false);
  await vi.advanceTimersByTimeAsync(60_000); expect(FakeSocket.all).toHaveLength(1);
});
it('rejects mismatched or missing chat authorization without opening a socket', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ client_id: 'other-app', user_id: '123', scopes: [], expires_in: 3600 })));
  const adapter = new TwitchChat(new Room('twitch'), 'access', 'refresh', '123', 'app', 'secret', () => {});
  await expect(adapter.start()).rejects.toThrow(); expect(FakeSocket.all).toHaveLength(0);
});

it('keeps receiving during directed migration, deduplicates overlap and preserves subscriptions', async () => {
  const r = new Room('twitch'), chat = vi.fn();
  const adapter = new TwitchChat(r, 'access', 'refresh', '123', 'app', 'secret', () => {}, chat);
  await adapter.start(); const first = FakeSocket.all[0];
  await first.emit('session_welcome', { session: { id: 'one', keepalive_timeout_seconds: 10 } });
  await first.emit('session_reconnect', { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=abc' } });
  const second = FakeSocket.all[1]; expect(first.closed).toBe(false);
  const event = { broadcaster_user_id: '123', chatter_user_id: '456', chatter_user_name: 'Viewer', message_id: 'chat-id', message: { text: '!join' } };
  await first.emit('notification', { event }, 'old-envelope');
  expect(r.joinQueue.has('456')).toBe(true);
  await second.emit('session_welcome', { session: { id: 'two', keepalive_timeout_seconds: 10 } });
  await second.emit('notification', { event }, 'new-envelope');
  expect(first.closed).toBe(true); expect(r.twitchConnected).toBe(true); expect(chat).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/subscriptions'))).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(11_000); expect(second.closed).toBe(false);
  adapter.stop();
});

it('resubscribes after network loss, resumes an existing vote and uses Twitch keepalives', async () => {
  const r = new Room('twitch');
  const adapter = new TwitchChat(r, 'access', 'refresh', '123', 'app', 'secret', () => {});
  await adapter.start(); const first = FakeSocket.all[0];
  await first.emit('session_welcome', { session: { id: 'one', keepalive_timeout_seconds: 10 } });
  const p = r.addPlayer('Viewer', '456'); p.selected = true; p.clue = 'Subtle';
  r.phase = 'INTERROGATION'; r.current = p.id; r.hostConnected = true;
  r.acceptFrame({ id: p.id, position: { x: 400, y: 400 }, paddle: { x: 400, y: 400 }, active: true, riding: true, state: 'riding', capture: 0, dwell: 0 }, 1);
  first.close(); expect(r.twitchConnected).toBe(false); expect(r.votingOpen).toBe(false);
  await vi.advanceTimersByTimeAsync(3000); const second = FakeSocket.all[1];
  await second.emit('session_welcome', { session: { id: 'two', keepalive_timeout_seconds: 10 } });
  expect(r.twitchConnected).toBe(true); expect(r.votingOpen).toBe(true);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/subscriptions'))).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(9000); await second.emit('session_keepalive', {});
  await vi.advanceTimersByTimeAsync(9000); expect(second.closed).toBe(false);
  await vi.advanceTimersByTimeAsync(3000); expect(second.closed).toBe(true); expect(r.twitchConnected).toBe(false);
  adapter.stop();
});

it('refreshes an already expired token and checks the new identity and permission', async () => {
  const credentials = { access: 'expired', refresh: 'old-refresh' };
  vi.mocked(fetch)
    .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'fresh', refresh_token: 'rotated' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ client_id: 'app', user_id: '123', scopes: ['user:read:chat'], expires_in: 14400 })));
  await ensureTwitchAuthorization(credentials, 'app', 'secret', '123', ['user:read:chat']);
  expect(credentials).toEqual({ access: 'fresh', refresh: 'rotated' });
  expect(new URLSearchParams(String(vi.mocked(fetch).mock.calls[1][1]?.body)).get('refresh_token')).toBe('old-refresh');
  expect(vi.mocked(fetch).mock.calls[2][1]?.headers).toEqual({ Authorization: 'OAuth fresh' });
});

it('rejects a refreshed token that no longer grants chat access', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(new Response(JSON.stringify({ client_id: 'app', user_id: '123', scopes: ['user:read:chat'], expires_in: 100 })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'fresh', refresh_token: 'rotated' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ client_id: 'app', user_id: '123', scopes: [], expires_in: 14400 })));
  const adapter = new TwitchChat(new Room('twitch'), 'old', 'refresh', '123', 'app', 'secret', () => {});
  await expect(adapter.start()).rejects.toThrow(); expect(FakeSocket.all).toHaveLength(0);
});

it('stops retrying on a denied subscription and reports the configuration error', async () => {
  vi.mocked(fetch).mockImplementation(async url => new Response(JSON.stringify(String(url).includes('/validate') ? { client_id: 'app', user_id: '123', scopes: ['user:read:chat'], expires_in: 14400 } : {}), { status: String(url).includes('/validate') ? 200 : 403 }));
  const r = new Room('twitch'), adapter = new TwitchChat(r, 'access', 'refresh', '123', 'app', 'secret', () => {});
  await adapter.start(); await FakeSocket.all[0].emit('session_welcome', { session: { id: 'denied' } });
  expect(r.feedback).toContain('403'); expect(r.twitchConnected).toBe(false);
  await vi.advanceTimersByTimeAsync(60_000); expect(FakeSocket.all).toHaveLength(1);
});

it('ends the chat session when hourly validation discovers revoked authorization', async () => {
  const r = new Room('twitch'), adapter = new TwitchChat(r, 'access', 'refresh', '123', 'app', 'secret', () => {});
  await adapter.start(); await FakeSocket.all[0].emit('session_welcome', { session: { id: 'one', keepalive_timeout_seconds: 600 } });
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 401 }));
  for (let i = 0; i < 5; i++) { await vi.advanceTimersByTimeAsync(9 * 60_000); await FakeSocket.all[0].emit('session_keepalive', {}); }
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(r.feedback).toContain('revoked'); expect(r.twitchConnected).toBe(false);
  expect(FakeSocket.all).toHaveLength(1);
  const count = FakeSocket.all.length; await vi.advanceTimersByTimeAsync(60_000); expect(FakeSocket.all).toHaveLength(count);
});

it('plays a live chat round from verified joins to real advisory votes and the impostor escape', async () => {
  const r = new Room('twitch'); r.hostConnected = true;
  const adapter = new TwitchChat(r, 'access', 'refresh', '123', 'app', 'secret', () => {});
  await adapter.start(); const socket = FakeSocket.all[0];
  await socket.emit('session_welcome', { session: { id: 'live' } });
  let message = 0;
  const say = async (id: string, text: string) => socket.emit('notification', { event: { broadcaster_user_id: '123', chatter_user_id: id, chatter_user_name: `Viewer${id}`, message: { text } } }, String(++message));
  const act = (actor: 'host' | typeof r.players[number], type: string, data?: Record<string, unknown>) => r.act(actor, { id: crypto.randomUUID(), version: r.version, type, data });
  for (const id of ['501', '502', '503', '504']) { await say(id, '!join'); const p = r.addPlayer(`Viewer${id}`, id); p.connected = true; act(p, 'ready'); }
  r.tick(); expect(r.phase).toBe('ROLE_DELIVERY'); expect(r.publicState().demo).toBe(false);
  const impostor = r.active().find(p => p.key === r.impostorKey)!;
  r.order = [...r.active().filter(p => p !== impostor), impostor].map(p => p.id);
  act('host', 'clues'); for (const p of r.active()) act(p, 'lock', { text: 'A subtle hint' });
  expect(r.phase).toBe('INTERROGATION');
  const { ZONES } = await import('../src/shared/maze');
  for (let i = 0; i < 4; i++) {
    const p = r.currentPlayer()!;
    r.acceptFrame({ id: p.id, position: { x: 400, y: 400 }, paddle: { x: 400, y: 400 }, active: true, riding: true, state: 'riding', capture: 0, dwell: 0 }, r.frameSeq + 1);
    expect(r.votingOpen).toBe(true); await say('701', '!trust'); await say('701', '!drop'); await say('702', '!trust');
    expect(p.votes).toEqual({ trust: 1, drop: 1 });
    act(p, 'answer', { text: 'Here is my explanation.' });
    const zone = i < 3 ? 'SAVE' : 'DROP';
    r.acceptFrame({ ...r.frame!, position: { ...ZONES[zone] }, riding: false, state: 'delivered', dwell: .8 }, r.frameSeq + 1);
    act('host', 'delivery'); r.tick();
    if (i < 3) expect(r.current).not.toBe(p.id);
  }
  expect(r.phase).toBe('IMPOSTOR_GUESS');
  for (let i = 0; i < 120; i++) { vi.setSystemTime(Date.now() + 250); r.tick(); }
  expect(r.phase).toBe('DECISIONS'); expect(r.paused).toBe(false);
  r.acceptFrame({ ...r.frame! }, r.frameSeq + 1);
  act('host', 'delivery'); expect(r.phase).toBe('ESCAPE'); expect(r.currentPlayer()).toBe(impostor);
  adapter.stop();
});
