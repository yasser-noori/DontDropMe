import express from 'express';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { Server } from 'socket.io';
import { Room, type Player } from './Room';
import { TwitchChat } from './Twitch';
import type { Action, ActorFrame, Input } from '../src/shared/protocol';

if (existsSync('.env')) loadEnvFile('.env');
const production = process.argv.includes('--production');
const port = Number(process.env.PORT || (production ? 4173 : 5173));
const origin = (process.env.PUBLIC_ORIGIN || 'https://desktop-p7qh231.tail214b5d.ts.net').replace(/\/$/, '');
const clientId = process.env.TWITCH_CLIENT_ID || '', clientSecret = process.env.TWITCH_CLIENT_SECRET || '';
const callback = `${origin}/auth/twitch/callback`;
const app = express(); app.disable('x-powered-by'); app.use(express.json({ limit: '8kb' }));
app.use((_req, res, next) => { res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
const server = createServer(app);
const allowed = new Set([origin, `http://127.0.0.1:${port}`, `http://localhost:${port}`]);
const io = new Server(server, { maxHttpBufferSize: 12000, allowRequest: (req, done) => done(null, !req.headers.origin || allowed.has(req.headers.origin)) });
const rooms = new Map<string, Room>(), hosts = new Map<string, string>();
const adapters = new Map<string, TwitchChat>();
const oauth = new Map<string, { room: Room; host: boolean; expires: number }>();
const ipLimits = new Map<string, { at: number; count: number }>();
function base(req: express.Request) { return allowed.has(`${req.protocol}://${req.get('host')}`) ? `${req.protocol}://${req.get('host')}` : origin; }
function emitRoom(room: Room) {
  io.to(room.code).emit('state', room.publicState());
  const hostId = hosts.get(room.code);
  if (hostId) {
    io.to(hostId).emit('host', room.hostState(io.sockets.sockets.get(hostId)?.data.base || origin));
    io.to(hostId).emit('simulation', room.simState());
    io.to(hostId).emit('queue', [...room.joinQueue.values()]);
  }
  for (const socket of io.sockets.sockets.values()) if (socket.data.room === room && socket.data.player) socket.emit('private', room.privateState(socket.data.player));
}
app.get('/api/config', (_req, res) => res.json({ twitch: Boolean(clientId && clientSecret), origin }));
app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.post('/api/rooms', (req, res) => {
  const key = req.ip || 'unknown', limit = ipLimits.get(key);
  if (rooms.size >= 100 || (limit && limit.at > Date.now() - 60_000 && limit.count >= 5)) { res.status(429).json({ error: 'Room creation limit. Try again shortly.' }); return; }
  ipLimits.set(key, { at: Date.now(), count: limit && limit.at > Date.now() - 60_000 ? limit.count + 1 : 1 });
  const mode = req.body?.mode === 'twitch' ? 'twitch' : 'local';
  if (mode === 'twitch' && (!clientId || !clientSecret)) { res.status(400).json({ error: 'Twitch credentials are not configured. Use Local Rehearsal.' }); return; }
  const room = new Room(mode); while (rooms.has(room.code)) room.code = randomBytes(3).toString('hex').toUpperCase(); rooms.set(room.code, room);
  res.json({ code: room.code, hostToken: room.hostToken });
});
function authUrl(room: Room, host: boolean, res: express.Response) {
  const state = randomBytes(24).toString('base64url'); oauth.set(state, { room, host, expires: Date.now() + 10 * 60_000 });
  res.cookie('trustfall_oauth', state, { httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', maxAge: 10 * 60_000, path: '/auth/twitch/callback' });
  const url = new URL('https://id.twitch.tv/oauth2/authorize'); url.search = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', scope: host ? 'user:read:chat' : '', state }).toString(); return url.href;
}
app.post('/api/twitch/connect', (req, res) => {
  const room = rooms.get(String(req.body?.room));
  if (!clientId || !clientSecret || !room || req.headers.authorization !== `Bearer ${room.hostToken}` || room.mode !== 'twitch') { res.status(403).json({ error: 'Host authorization or Twitch configuration missing.' }); return; }
  res.json({ url: authUrl(room, true, res) });
});
app.get('/auth/twitch', (req, res) => {
  const room = rooms.get(String(req.query.room));
  if (!clientId || !room || room.mode !== 'twitch') { res.status(400).send('This live room is unavailable.'); return; }
  res.redirect(authUrl(room, false, res));
});
app.get('/auth/twitch/callback', async (req, res) => {
  const state = String(req.query.state || ''), entry = oauth.get(state); oauth.delete(state);
  const cookie = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('trustfall_oauth='))?.slice('trustfall_oauth='.length);
  if (!entry || cookie !== state || entry.expires < Date.now() || !req.query.code) { res.status(400).send('Authorization expired or declined. Return to the room and try again.'); return; }
  res.clearCookie('trustfall_oauth', { path: '/auth/twitch/callback' });
  try {
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: String(req.query.code), grant_type: 'authorization_code', redirect_uri: callback }) });
    if (!tokenResponse.ok) throw Error('token');
    const credentials = await tokenResponse.json() as { access_token: string; refresh_token: string };
    const identityResponse = await fetch('https://api.twitch.tv/helix/users', { headers: { Authorization: `Bearer ${credentials.access_token}`, 'Client-Id': clientId } });
    if (!identityResponse.ok) throw Error('identity');
    const identity = (await identityResponse.json() as { data: { id: string; display_name: string }[] }).data[0]; if (!identity) throw Error('identity');
    const room = entry.room;
    if (entry.host) {
      adapters.get(room.code)?.stop(); const adapter = new TwitchChat(room, credentials.access_token, credentials.refresh_token, identity.id, clientId, clientSecret, () => emitRoom(room)); adapters.set(room.code, adapter); adapter.start();
      res.redirect(`${origin}/?room=${room.code}#host=${room.hostToken}`);
    } else {
      const existing = room.players.find(p => p.twitchId === identity.id);
      if (!existing && !room.joinQueue.has(identity.id)) { res.status(403).send('Type !join in the connected Twitch channel first, then return to the companion link.'); return; }
      const player = existing || room.addPlayer(identity.display_name, identity.id); emitRoom(room);
      res.redirect(`${origin}/?room=${room.code}#player=${player.token}`);
    }
  } catch { res.status(502).send('Twitch authorization failed. Return to the room and reconnect.'); }
});
io.use((socket, next) => {
  const { room: code, token, kind } = socket.handshake.auth || {}, room = rooms.get(String(code));
  if (!room) { next(Error('Room not found. The server may have restarted.')); return; }
  const player = typeof token === 'string' ? room.playerByToken(token) : undefined;
  if (kind === 'host' && token !== room.hostToken || kind === 'player' && !player || !['host', 'player', 'broadcast'].includes(kind)) { next(Error('Invalid private link.')); return; }
  const requestedOrigin = socket.handshake.headers.origin || `http://${socket.handshake.headers.host}`;
  socket.data = { room, kind, player, base: allowed.has(requestedOrigin) ? requestedOrigin : origin }; next();
});
io.on('connection', socket => {
  const room = socket.data.room as Room, player = socket.data.player as Player | undefined;
  socket.join(room.code);
  if (socket.data.kind === 'host') {
    const previous = hosts.get(room.code); hosts.set(room.code, socket.id); if (previous) io.sockets.sockets.get(previous)?.disconnect(true);
    room.hostConnected = true; room.frameSeq = -1;
    if (room.frame) socket.emit('restore', room.frame);
  }
  if (room.frame && socket.data.kind !== 'host') socket.emit('frame', room.frame);
  if (player) player.connected = true;
  room.version++; emitRoom(room);
  let lastAction = 0, actionCount = 0, frameTime = 0, inputTime = 0;
  socket.on('action', (action: Action, ack: (reply: unknown) => void) => {
    const reply = (value: unknown) => { if (typeof ack === 'function') ack(value); };
    if (Date.now() - lastAction > 1000) { actionCount = 0; lastAction = Date.now(); }
    if (++actionCount > 20) { reply({ ok: false, error: 'Slow down.' }); return; }
    try {
      if (socket.data.kind === 'broadcast') throw Error('Read-only broadcast.');
      room.act(socket.data.kind === 'host' ? 'host' : player!, action); emitRoom(room); reply({ ok: true });
    } catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : 'Action rejected.' }); socket.emit('state', room.publicState()); }
  });
  socket.on('input', (input: Input) => {
    if (!player || Date.now() - inputTime < 20) return; inputTime = Date.now();
    try { room.control(player, input); const host = hosts.get(room.code); if (host) io.to(host).emit('simulation', room.simState()); } catch { /* Outside escape is deliberately ignored. */ }
  });
  socket.on('frame', (frame: ActorFrame, seq: number) => {
    if (socket.data.kind !== 'host' || hosts.get(room.code) !== socket.id || Date.now() - frameTime < 25) return; frameTime = Date.now();
    if (frame && room.acceptFrame(frame, seq)) socket.to(room.code).emit('frame', frame);
  });
  socket.on('disconnect', () => {
    if (hosts.get(room.code) === socket.id) { hosts.delete(room.code); room.hostConnected = false; room.tracking = false; if (!['LOBBY', 'REVEAL', 'RESULTS'].includes(room.phase)) room.paused = true; }
    if (player) player.connected = [...io.sockets.sockets.values()].some(s => s.id !== socket.id && s.data.player === player);
    room.version++; emitRoom(room);
  });
});
setInterval(() => { for (const room of rooms.values()) { room.tick(); emitRoom(room); } for (const [key, entry] of oauth) if (entry.expires < Date.now()) oauth.delete(key); }, 100);
if (production) app.use(express.static(resolve('dist')));
else { const { createServer: vite } = await import('vite'); const dev = await vite({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' }); app.use(dev.middlewares); }
server.listen(port, '127.0.0.1', () => console.log(`TRUST FALL ${production ? 'production' : 'development'}: http://127.0.0.1:${port}`));
