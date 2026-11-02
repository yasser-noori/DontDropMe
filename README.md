Live Twitch: see [TWITCH_SETUP.md](TWITCH_SETUP.md) for OAuth setup, real chat joins/votes, acceptance testing, and hackathon submission instructions.

# HOLD MY CHAT: TRUST FALL — V1

Four private player sessions. Three know the word; one knows only its category. The host carries each player past three floating shape towers using their webcam hand, asks a question, saves three and drops one. A correctly identified impostor gets an eight-second narrated countdown, then automatically follows a curved coin trail from the Impostor cave to the Safe cave. The streamer catches them by pinching thumb and index finger around their body for about half a second.

## Run

Use Node 24 LTS (supported: Node 22.12+, 24.x, 26+) and npm.

```sh
npm install
npm run dev
```

Development defaults to http://127.0.0.1:5173. For the production build:

```sh
npm run build
npm test -- --run
npm start
```

Production listens on `127.0.0.1:4173`. `npm run preview` also starts the integrated production server. Keep the Node server running; Vite preview alone cannot provide multiplayer. Optional configuration is in `.env.example`; copy it to `.env` and set `PUBLIC_ORIGIN` to the URL players actually use. Setting `PORT` overrides both development and production defaults. Rooms and OAuth sessions are in memory; restarting the server resets them.

The established Tailscale endpoint is **https://desktop-p7qh231.tail214b5d.ts.net/**, forwarding to port 4173. Keep this Windows PC awake and Tailscale connected. Access is tailnet-only; no public Funnel is configured. Start `npm start` again after a Windows restart. Disable access with `"C:\Program Files\Tailscale\tailscale.exe" serve --https=443 off` in a command shell, or invoke that executable with `&` in PowerShell.

The original rescue prototype is preserved at **/?prototype** with its camera, mouse, Space/R/P controls and `window.holdMyChat` integration boundary. TRUST FALL uses the authoritative room controls instead.

## Play a local rehearsal

**Testing alone:** click **▶ Solo Demo · auto players** on the home page (or **Start solo demo here** in an empty local lobby). One host page is enough. Four explicitly simulated players automatically ready, lock clues, answer only once they are on your hand, advance after SAVE deliveries and pass the word guess. There is no interrogation platform. Landing on SAVE or DROP chooses the outcome automatically; there are no arm/disarm buttons. Mouse Mode starts automatically; choose Start Camera to test your real hand. You still physically carry everyone, choose SAVE/DROP by landing location, and chase the demo impostor, which moves toward the ring automatically. Demo bots never fabricate Twitch votes or replace connected real participants. Pause, restart and anonymous rematch continue to work. Normal local/Twitch rooms retain real-player submission requirements.

The solo demo opens with timed cards for the game, rules, players, and word before the first player enters. Each card appears in side chat and the black livestream overlay together. After a steady pickup, only that player's clue appears; their answer follows after time to read the clue. Narration freezes with pause or host disconnection and restarts with the introduction after Restart lobby. The word is shown to spectators only in this explicit demo; normal local and Twitch games keep it private until reveal.

1. Click **Create Local Rehearsal**. Keep the host URL private. Share each of the four private player links with exactly one participant. Each is an unguessable bearer-token session. For a one-machine rehearsal, use separate browser windows/devices; switching the host's tab into the background pauses the game.
2. Each player opens their own page and clicks **I'm ready**. Host starts once four connected, selected players are ready. Private role cards appear only on the corresponding player pages. Host sees the category, never the word.
3. Host opens clues. Players submit and lock one to three words, at most 32 characters. Drafts can be edited until locked. Links and explicit word/alias disclosures are rejected. Each clue becomes public when its player rides the host's active hand. On timer expiry, host intervention is required; extend 15 seconds or resume.
4. Choose **Mouse Mode** or **Start Camera**. Align the paddle beside pickup at roughly (220,420). Interrogate the player **on your hand**. Bump the rectangle tower, triangle pyramid or ball stack for bouncing debris; collect the gold arcs and spiral along the way. Move freely to SAVE at roughly (680–888,345) or DROP at (680–888,450). The player walks off and a 700 ms dwell commits the decision. The demo advances automatically; otherwise click Next player. Each new player turn resets the towers and coins.
5. Question all four on your hand. For the final rider, the private guess/pass window runs while they remain attached; it does not reset them to pickup. If the player lands on DROP before the guess is locked, the decision waits there for the private guess window and commits automatically afterward. The demo passes automatically.
6. Land your suspect on **DROP** on any turn after their answer; three prior SAVEs are not required. An early DROP opens the impostor guess before resolving the accusation. Deliver directly to DROP at roughly (680–888,450); the entire ledge accepts a forgiving paddle alignment. To change your suspect, undo a previous SAVE, save the current rider into that freed slot, then collect the previously saved suspect. To postpone a decision, use **Finish interview · decide later** while they ride your hand; they visibly return to pickup before the next entrance. After all four interviews, choose an undecided player for final delivery. No interrogation-platform stop is required.
7. Wrong suspect: the dropped innocent is eliminated and the other players finish their cave deliveries. When every player has an outcome, the black stream message announces IMPOSTOR IS STILL PRESENT for eight seconds. A new round starts automatically with a different word, the same hidden impostor, and only the good-cave survivors back in the queue. No impostor identity or old word is revealed between these rounds. Pause or host disconnection stops the countdown. Later rounds use the smaller surviving roster. Correct suspect: an eight-second countdown explains the automatic escape and pinch capture in the black stream card. The escape coins trace one curved route to the Safe cave, which the impostor follows automatically in about ten seconds. Close your thumb and index finger around their body and hold about 0.5 seconds to capture them. An open palm cannot capture. Debug displays the actual thumb tip and index fingertip as orange and blue circles. Mouse rehearsal uses click-and-hold at the character. Tracking loss, pause and host disconnection freeze the countdown/run; lost finger observations clear the pinch. The safe-cave endpoint ends the escape.
8. An escaped impostor enables **Anonymous rematch**: same underlying four players and impostor, new word/category, new public aliases/IDs/colors for all players, and no second escape for the impostor. Correct guesses override deduction, do not start escape, and end the streak. Caught/timed-out impostors and wrong accusations end the streak; a normal new round assigns fresh roles.

Camera permission is requested only after Start Camera. HTTPS or localhost is required. Frames are processed locally by the preserved MediaPipe HandLandmarker; they are not recorded or uploaded. Stop Camera, Mouse Mode and page close release camera tracks. Optional Google Fonts are external; the versioned MediaPipe model and matching 0.10.32 WASM files are local in `public/mediapipe` with the upstream license. Initialization follows the [official MediaPipe documentation](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js).

## Twitch live mode

No credentials are included. Without configuration the application explicitly offers **LOCAL REHEARSAL**, never simulated Twitch participants or votes.

1. Register an application in the [Twitch developer console](https://dev.twitch.tv/console/apps). Add the exact OAuth redirect URL `PUBLIC_ORIGIN/auth/twitch/callback`, for example `https://desktop-p7qh231.tail214b5d.ts.net/auth/twitch/callback`.
2. Set `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and `PUBLIC_ORIGIN` in `.env`. Restart the server. Do not put secrets in any `VITE_` variable.
3. Create a Twitch room. Click **Connect my Twitch channel**, then authenticate as the broadcaster. The server uses authorization-code OAuth and verifies the identity through Helix. The host grants only `user:read:chat` for receive-only EventSub `channel.chat.message`; companion players authenticate without additional scopes. No whispers, chat-send scope, or email scope is requested.
4. Share the viewer companion link shown in host controls. Viewers type `!join` in the connected channel and authenticate on the companion page with the same account. The server matches Twitch's verified account ID to the EventSub queue, rejects unmatched joins and deduplicates accounts. Host selects four connected, ready players.
5. Host explicitly opens/closes advisory voting during each interrogation. Verified chatters use `!trust` / `!drop`; later votes replace earlier votes. Totals, percentages and sample size are shown. Votes are stored per interrogation for the decision summary. Disconnection disables voting without resetting the room; reconnect the channel from the lobby if authorization needs renewal.

OAuth uses expiring, single-use state bound to an HttpOnly SameSite cookie. Tokens stay server-side. EventSub handles welcome, reconnect, keepalive timeout and revocation; refresh tokens are renewed in memory. Twitch configuration follows [chat authentication](https://dev.twitch.tv/docs/chat/authenticating/) and [EventSub WebSocket guidance](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/). **Live OAuth, EventSub and real Twitch chat require credentials and have not been acceptance-tested here.**

## Architecture and trust boundary

- Existing `HandTracker.ts`, `PalmFilter`, `HandPlatform` and `Character` remain in use. `GameScene.ts` and `prototype.ts` retain the original game.
- `shared/maze.ts`: open play area, three small floating ledges, fixed destination zones and sanctuary. The hand passes through toy platforms freely; sanctuary and world bounds still constrain it. Falling actors land on ledges and can reboard a nearby active hand. `game/ToyPhysics.ts` runs the bundled Matter rigid-body engine with rotating rectangles, actual triangle collision shapes, and rolling balls. Contact unlocks the touched tower; momentum and gravity topple it. A finite-mass rider and brief directional hand drag provide impact resistance while preserving attachment. Piece speed and spin are capped to keep fast swipes controlled. Debris settles, then fades after about six seconds. `game/Playground.ts` renders the shapes and collects coin trails with sparkle effects. Both toys and coins reset on round/current-player changes; repeated state updates preserve them. The toy world steps only with active scene time, and broadcast clients render contacts locally without changing the host's movement.
- `TrustScene.ts`: Phaser physical simulation, boarding/walk-off/dwell, entrance animation, constrained movement, aerial escape and capture. Only the host simulates physics. Public clients interpolate public actor frames. The broadcast page is a game overlay; capture the host's game region to include the local webcam, or layer the public overlay with a webcam source in OBS. Remote broadcast pages do not receive camera frames.
- `server/Room.ts`: authoritative phases, random roles and curated words/aliases, filtering, clues, answers, decisions, deduplication, vote windows, eligibility, timers, results and rematches.
- `server/index.ts`: Express, Socket.IO authentication/routing, static production hosting, private OAuth and room lifecycle. `server/Twitch.ts` receives verified Twitch events.
- `trust.ts`: small DOM-based host/phone-friendly player/public UIs. All user text is rendered as text, never HTML.

Public, host and individual-player payloads are built separately. Pre-reveal public/host payloads contain neither word nor hidden roles. The only ring coordinates sent to the host use a separate authorized simulation channel and are never rendered. The impostor alone receives the private ring map. **The host is trusted for physical collision results**: the server checks host authorization, active phase/player, timing, dwell/capture contact, quotas and escape eligibility, but cannot independently prove webcam-derived collisions. A host inspecting internal browser memory can discover the ring. Local rehearsal link owners can access their assigned private session; do not broadcast the host link panel. Disguises change presentation, never authenticated identity.

Actions include a room version and unique action ID. Stale and duplicate actions are rejected. Only the active impostor can submit escape input, and only the authorized host can report delivery/capture/ring events. Sequence-numbered frames prevent replay. Player disconnects preserve roles/submissions; reconnect restores private state. Host disconnect pauses progression; reconnect restores the last physical snapshot. Choose camera/mouse, align with the visible paddle, then explicitly Resume. Rematches shuffle public player ordering as well as IDs, aliases and colors, preventing a stable list index from identifying the returning impostor. No real player is silently replaced.

## Verification and remaining acceptance

Focused Vitest tests cover roles and filtering, clues, invalid/stale/duplicate actions, decision quotas and undo, open movement, tower impact/reset lifecycle and rider attachment, sanctuary exclusion, escape eligibility/input/ring/capture validation, one-use escape, anonymous rematch identity, guess override, vote replacement/windows and duplicate verified accounts. Run `npm test -- --run` and `npm run build`.

Latest playground update: TypeScript check, production build and **40 passing Vitest tests**. Browser visual/real-hand verification of the new toys is pending because browser access is disabled.

Earlier prototype verification: Headless Chrome exercised four distinct player pages, all clues, four physical mouse transports/interrogations, three SAVE transports and a correct DROP, then separately completed keyboard escape and sustained-hand-platform capture rounds. The escape run entered an anonymous rematch with a new word and the same private impostor. A returning impostor's second-escape rejection is covered by the rule tests. Host reload preserved rider position, paused safely and resumed to a successful delivery; player reload preserved role/answer. The 390px player layout had no horizontal overflow, and the public broadcast loaded. Socket-level checks verified no pre-reveal word/role in host/public payloads and rejected spectator writes/forged host credentials. Tailscale HTTPS served the integrated application, private Socket.IO connections and local model; synthetic-camera GPU initialization/stop passed. The original rescue page still loads and enters Mouse Mode. No uncaught browser errors were observed in the successful runs.

**Real-hand tracking alignment and live Twitch acceptance have not been performed.** No Twitch credentials are configured. Mouse/synthetic-camera tests are not evidence of webcam acceptance. Server memory, local bearer links and trusted-host physical reports are explicit V1 limitations. Slow devices may reduce tracking frequency; camera inference remains on the main thread. There is one playground, four active characters per round and one active transported character at a time. No database, chat bot messages, combat or random level generation is included.

Manual checklist:

- [ ] Four private browser sessions connect and ready; verify three word cards and one category-only impostor card. Broadcast/host must not display the word or role before reveal.
- [ ] Lock four clues; pick up a player with a real hand, bump each tower from both sides and from above, collect coins, then land in SAVE or DROP. Check for brief impact resistance, controlled toppling, triangle rotation, and rolling balls. Pulling away should remain responsive and the rider should stay attached. Advance to the next player and confirm all shapes and coins return. Pause and resume; toys should freeze and resume with the game.
- [ ] Save three and drop an innocent: immediate wrong feedback, no escape, correct reveal. Test SAVE undo before the final DROP.
- [ ] Drop the correct impostor: start from actual DROP position, test WASD/touch and one dash; hold palm contact to capture. Verify tracking loss and host disconnect pause the chase.
- [ ] Complete escape through the private ring; verify the hand cannot enter sanctuary. Rematch with a new word/disguises, same private impostor and no second escape.
- [ ] Lock a correct normalized guess: it wins even if the streamer identifies the impostor.
- [ ] Reconnect a player and host; verify private state and physical recovery. Deny camera permission and use Mouse Mode.
- [ ] With Twitch configured, verify authenticated !join matching, advisory vote replacement, host voting windows, stream-delay tolerance and disconnect behavior.



