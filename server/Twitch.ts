import type { Room } from './Room';
export type TwitchIdentity = { client_id: string; user_id: string; scopes: string[]; expires_in: number };
export async function validateTwitchToken(access: string, clientId: string, userId?: string) {
  const response = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${access}` }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw Error('Twitch authorization is no longer valid. Reconnect Twitch.');
  const identity = await response.json() as TwitchIdentity;
  if (identity.client_id !== clientId || !identity.user_id || userId && identity.user_id !== userId) throw Error('Twitch token identity mismatch.');
  return identity;
}
/** Verified receive-only chat. Tokens remain exclusively on the server. */
export class TwitchChat {
  private socket?: WebSocket;
  private closed = false;
  private watchdog?: ReturnType<typeof setTimeout>;
  private validationTimer?: ReturnType<typeof setTimeout>;
  private retries?: ReturnType<typeof setTimeout>;
  private seen = new Set<string>();
  constructor(private room: Room, private access: string, private refreshToken: string, readonly userId: string, private clientId: string, private secret: string, private changed: () => void, private onChat: (message: { id: string; name: string; text: string }) => void = () => {}) {}
  async start() {
    await this.validate();
    if (!this.closed) this.connect('wss://eventsub.wss.twitch.tv/ws');
  }
  private async validate() {
    try {
      let identity = await validateTwitchToken(this.access, this.clientId, this.userId);
      if (!identity.scopes.includes('user:read:chat')) throw Error('Missing chat permission.');
      if (identity.expires_in < 600) {
        const response = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.refreshToken, client_id: this.clientId, client_secret: this.secret }), signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw Error('Twitch refresh failed.');
        const token = await response.json() as { access_token: string; refresh_token: string };
        this.access = token.access_token; this.refreshToken = token.refresh_token;
        identity = await validateTwitchToken(this.access, this.clientId, this.userId);
      }
      if (!this.closed) this.validationTimer = setTimeout(() => void this.validate().catch(() => {}), Math.max(30_000, Math.min(50 * 60_000, (identity.expires_in - 300) * 1000)));
    } catch {
      this.stop(); this.room.feedback = 'Twitch authorization expired or was revoked. Reconnect Twitch.'; this.changed();
      throw Error('Twitch authorization failed. Reconnect Twitch.');
    }
  }
  private connect(url: string, reconnect = false) {
    if (this.closed) return;
    const target = new URL(url);
    if (target.protocol !== 'wss:' || target.hostname !== 'eventsub.wss.twitch.tv') return;
    const previous = this.socket, socket = new WebSocket(url); this.socket = socket;
    let timeout = 15_000;
    const watchdog = () => { clearTimeout(this.watchdog); this.watchdog = setTimeout(() => socket.close(), timeout); };
    watchdog();
    socket.onmessage = async message => {
      if (this.socket !== socket || this.closed) return;
      try {
        const data = JSON.parse(String(message.data)), type = data.metadata.message_type;
        watchdog();
        if (type === 'session_welcome') {
          timeout = (data.payload.session.keepalive_timeout_seconds || 10) * 1000 + 2000; watchdog();
          if (!reconnect) {
            const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', { method: 'POST', headers: { Authorization: `Bearer ${this.access}`, 'Client-Id': this.clientId, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: this.userId, user_id: this.userId }, transport: { method: 'websocket', session_id: data.payload.session.id } }), signal: AbortSignal.timeout(8000) });
            if (!response.ok) { if (response.status === 401 || response.status === 403) this.stop(); throw Error('Chat subscription failed.'); }
          }
          previous?.close(); this.room.twitchConnected = true; this.room.feedback = undefined; this.changed();
        } else if (type === 'session_reconnect') this.connect(data.payload.session.reconnect_url, true);
        else if (type === 'revocation') { this.stop(); this.room.feedback = 'Chat permission was revoked. Reconnect Twitch.'; this.changed(); }
        else if (type === 'notification' && data.metadata.subscription_type === 'channel.chat.message') {
          const event = data.payload.event, id = String(data.metadata.message_id);
          if (String(event.broadcaster_user_id) !== this.userId || this.seen.has(id)) return;
          this.seen.add(id); if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
          const text = String(event.message.text).slice(0, 500), userId = String(event.chatter_user_id), name = String(event.chatter_user_name).slice(0, 30);
          if (!/^\d+$/.test(userId)) return;
          this.room.receiveChat(userId, name, text);
          this.onChat({ id, name, text }); this.changed();
        }
      } catch { socket.close(); }
    };
    socket.onclose = () => {
      if (this.socket !== socket || this.closed) return;
      clearTimeout(this.watchdog); this.room.twitchConnected = false; this.room.votingOpen = false; this.changed();
      this.retries = setTimeout(() => this.connect('wss://eventsub.wss.twitch.tv/ws'), 3000);
    };
    socket.onerror = () => socket.close();
  }
  stop() { this.closed = true; clearTimeout(this.watchdog); clearTimeout(this.retries); clearTimeout(this.validationTimer); this.socket?.close(); this.room.twitchConnected = false; this.room.votingOpen = false; }
}
