import type { Room } from './Room';

export type TwitchIdentity = { client_id: string; user_id: string; scopes: string[]; expires_in: number };
export type TwitchCredentials = { access: string; refresh: string };
class InvalidTwitchToken extends Error {}

export async function validateTwitchToken(access: string, clientId: string, userId?: string) {
  const response = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${access}` }, signal: AbortSignal.timeout(10_000) });
  if (response.status === 401) throw new InvalidTwitchToken('Twitch authorization expired or was revoked.');
  if (!response.ok) throw Error('Twitch token validation is unavailable.');
  const identity = await response.json() as TwitchIdentity;
  if (identity.client_id !== clientId || !identity.user_id || userId && identity.user_id !== userId
    || !Array.isArray(identity.scopes) || !Number.isFinite(identity.expires_in) || identity.expires_in < 0) throw Error('Twitch token identity mismatch.');
  return identity;
}

/** Refresh expired tokens as well as tokens nearing expiry; verify the refreshed identity and scopes. */
export async function ensureTwitchAuthorization(credentials: TwitchCredentials, clientId: string, secret: string, userId: string, scopes: string[] = []) {
  let identity: TwitchIdentity | undefined;
  try { identity = await validateTwitchToken(credentials.access, clientId, userId); }
  catch (error) { if (!(error instanceof InvalidTwitchToken)) throw error; }
  if (!identity || identity.expires_in < 600) {
    const response = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credentials.refresh, client_id: clientId, client_secret: secret }), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw Error('Twitch refresh failed. Reconnect Twitch.');
    const token = await response.json() as { access_token?: string; refresh_token?: string };
    if (!token.access_token || !token.refresh_token) throw Error('Twitch refresh response is incomplete.');
    identity = await validateTwitchToken(token.access_token, clientId, userId);
    credentials.access = token.access_token; credentials.refresh = token.refresh_token;
  }
  if (scopes.some(scope => !identity.scopes.includes(scope))) throw Error('Missing Twitch chat permission.');
  return identity;
}

/** Verified receive-only chat. Tokens remain exclusively on the server. */
export class TwitchChat {
  private socket?: WebSocket;
  private closed = false;
  private sockets = new Set<WebSocket>();
  private watchdogs = new Map<WebSocket, ReturnType<typeof setTimeout>>();
  private validationTimer?: ReturnType<typeof setTimeout>;
  private retries?: ReturnType<typeof setTimeout>;
  private retryDelay = 3000;
  private seen = new Set<string>();
  private credentials: TwitchCredentials;
  constructor(private room: Room, access: string, refresh: string, readonly userId: string, private clientId: string, private secret: string, private changed: () => void, private onChat: (message: { id: string; name: string; text: string }) => void = () => {}) {
    this.credentials = { access, refresh };
  }
  async start() {
    await this.validate();
    if (!this.closed) this.connect('wss://eventsub.wss.twitch.tv/ws');
  }
  private async validate() {
    try {
      const identity = await ensureTwitchAuthorization(this.credentials, this.clientId, this.secret, this.userId, ['user:read:chat']);
      if (!this.closed) this.validationTimer = setTimeout(() => void this.validate().catch(() => {}), Math.max(30_000, Math.min(50 * 60_000, (identity.expires_in - 300) * 1000)));
    } catch {
      this.stop(); this.room.feedback = 'Twitch authorization expired or was revoked. Reconnect Twitch.'; this.changed();
      throw Error('Twitch authorization failed. Reconnect Twitch.');
    }
  }
  private connect(url: string, migration = false) {
    if (this.closed) return;
    const target = new URL(url);
    if (target.protocol !== 'wss:' || target.hostname !== 'eventsub.wss.twitch.tv' || target.username || target.password || target.port) throw Error('Unexpected Twitch reconnect URL.');
    const previous = this.socket, socket = new WebSocket(url); this.socket = socket; this.sockets.add(socket);
    let timeout = 15_000;
    const watchdog = () => {
      clearTimeout(this.watchdogs.get(socket));
      this.watchdogs.set(socket, setTimeout(() => socket.close(), timeout));
    };
    watchdog();
    socket.onmessage = async message => {
      // The old socket still receives valid notifications until the replacement welcomes us.
      if (!this.sockets.has(socket) || this.closed) return;
      try {
        const data = JSON.parse(String(message.data)), type = data.metadata.message_type;
        watchdog();
        if (type === 'session_welcome' && this.socket === socket) {
          timeout = (data.payload.session.keepalive_timeout_seconds || 10) * 1000 + 2000; watchdog();
          if (!migration) {
            const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', { method: 'POST', headers: { Authorization: `Bearer ${this.credentials.access}`, 'Client-Id': this.clientId, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: this.userId, user_id: this.userId }, transport: { method: 'websocket', session_id: data.payload.session.id } }), signal: AbortSignal.timeout(8000) });
            if (!response.ok) {
              this.room.feedback = `Twitch chat subscription failed (${response.status}). ${response.status === 401 || response.status === 403 ? 'Reconnect Twitch.' : 'Retrying connection…'}`;
              if (response.status === 401 || response.status === 403) this.stop();
              this.changed(); throw Error('Chat subscription failed.');
            }
          }
          if (this.closed || this.socket !== socket || !this.sockets.has(socket)) return;
          previous?.close(); this.retryDelay = 3000;
          this.room.twitchConnected = true; this.room.feedback = undefined;
          if (this.room.phase === 'INTERROGATION' && this.room.publicState().players.some(p => p.id === this.room.current && p.clue && !p.outcome)) this.room.votingOpen = true;
          this.room.version++; this.changed();
        } else if (type === 'session_reconnect' && this.socket === socket) this.connect(data.payload.session.reconnect_url, true);
        else if (type === 'revocation') { this.stop(); this.room.feedback = 'Chat permission was revoked. Reconnect Twitch.'; this.changed(); }
        else if (type === 'notification' && data.metadata.subscription_type === 'channel.chat.message') {
          const event = data.payload.event, id = event?.message_id || data.metadata.message_id;
          if (typeof id !== 'string' || !id || typeof event?.message?.text !== 'string' || String(event.broadcaster_user_id) !== this.userId || this.seen.has(id)) return;
          const userId = String(event.chatter_user_id);
          if (!/^\d+$/.test(userId) || typeof event.chatter_user_name !== 'string') return;
          this.seen.add(id); if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
          const text = event.message.text.slice(0, 500), name = event.chatter_user_name.slice(0, 30);
          this.room.receiveChat(userId, name, text);
          this.onChat({ id, name, text }); this.changed();
        }
      } catch { socket.close(); }
    };
    socket.onclose = () => {
      clearTimeout(this.watchdogs.get(socket)); this.watchdogs.delete(socket); this.sockets.delete(socket);
      if (this.socket !== socket || this.closed) return;
      for (const old of this.sockets) old.close();
      this.room.twitchConnected = false; this.room.votingOpen = false; this.room.version++; this.changed();
      clearTimeout(this.retries);
      this.retries = setTimeout(() => this.connect('wss://eventsub.wss.twitch.tv/ws'), this.retryDelay);
      this.retryDelay = Math.min(30_000, this.retryDelay * 2);
    };
    socket.onerror = () => socket.close();
  }
  stop() {
    this.closed = true; clearTimeout(this.retries); clearTimeout(this.validationTimer);
    for (const timer of this.watchdogs.values()) clearTimeout(timer);
    this.watchdogs.clear(); for (const socket of this.sockets) socket.close(); this.sockets.clear();
    this.room.twitchConnected = false; this.room.votingOpen = false; this.room.version++;
  }
}
