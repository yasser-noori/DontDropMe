import type { Room } from './Room';

/** Receive only: verified chatter_user_id comes from Twitch EventSub, never browser input. */
export class TwitchChat {
  private socket?: WebSocket;
  private closed = false;
  private watchdog?: ReturnType<typeof setTimeout>;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private retries?: ReturnType<typeof setTimeout>;
  private seen = new Set<string>();
  constructor(private room: Room, private access: string, private refreshToken: string, private userId: string, private clientId: string, private secret: string, private changed: () => void) {}
  start() { this.connect('wss://eventsub.wss.twitch.tv/ws'); this.refreshTimer = setInterval(() => void this.refresh(), 45 * 60_000); }
  private async refresh() {
    try {
      const response = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.refreshToken, client_id: this.clientId, client_secret: this.secret }) });
      if (!response.ok) throw Error('refresh');
      const token = await response.json() as { access_token: string; refresh_token: string }; this.access = token.access_token; this.refreshToken = token.refresh_token;
    } catch { this.room.twitchConnected = false; this.room.votingOpen = false; this.changed(); }
  }
  private connect(url: string, reconnect = false) {
    if (this.closed || !url.startsWith('wss://eventsub.wss.twitch.tv/')) return;
    const previous = this.socket, socket = new WebSocket(url); this.socket = socket;
    socket.onmessage = async message => {
      try {
        const data = JSON.parse(String(message.data));
        clearTimeout(this.watchdog); this.watchdog = setTimeout(() => socket.close(), 35_000);
        const type = data.metadata.message_type;
        if (type === 'session_welcome') {
          if (!reconnect) {
            const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', { method: 'POST', headers: { Authorization: `Bearer ${this.access}`, 'Client-Id': this.clientId, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: this.userId, user_id: this.userId }, transport: { method: 'websocket', session_id: data.payload.session.id } }) });
            if (!response.ok) throw Error('subscription');
          }
          previous?.close(); this.room.twitchConnected = true; this.changed();
        } else if (type === 'session_reconnect') this.connect(data.payload.session.reconnect_url, true);
        else if (type === 'revocation') { this.room.twitchConnected = false; this.room.votingOpen = false; this.changed(); }
        else if (type === 'notification' && data.metadata.subscription_type === 'channel.chat.message') {
          const event = data.payload.event, id = data.metadata.message_id;
          if (this.seen.has(id)) return; this.seen.add(id); if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
          const text = String(event.message.text).trim().toLowerCase(), userId = String(event.chatter_user_id);
          if (text === '!join' && this.room.phase === 'LOBBY' && this.room.joinQueue.size < 200) this.room.joinQueue.set(userId, String(event.chatter_user_name));
          if (text === '!trust' || text === '!drop') this.room.vote(userId, text === '!trust' ? 'trust' : 'drop');
          this.changed();
        }
      } catch { socket.close(); }
    };
    socket.onclose = () => {
      if (this.socket !== socket || this.closed) return;
      this.room.twitchConnected = false; this.room.votingOpen = false; this.changed();
      this.retries = setTimeout(() => this.connect('wss://eventsub.wss.twitch.tv/ws'), 5000);
    };
    socket.onerror = () => socket.close();
  }
  stop() { this.closed = true; clearTimeout(this.watchdog); clearTimeout(this.retries); clearInterval(this.refreshTimer); this.socket?.close(); }
}
