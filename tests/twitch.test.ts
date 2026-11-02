import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TwitchChat } from '../server/Twitch';
import { Room } from '../server/Room';
class FakeSocket {
  static all: FakeSocket[] = [];
  onmessage?: (event: { data: string }) => Promise<void>;
  onclose?: () => void; onerror?: () => void;
  constructor(public url: string) { FakeSocket.all.push(this); }
  close() { this.onclose?.(); }
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
