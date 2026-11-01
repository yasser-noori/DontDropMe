# HOLD MY CHAT

A playable browser feasibility prototype: Frank walks onto your palm, rides across a mirrored webcam view, and walks into a portal. All artwork is procedural Phaser graphics. Camera frames are processed on your device; they are never recorded or uploaded.

## Run

Requires Node.js 22.12+ (22.x), 24+, or 26+ and npm; Node 24 LTS is recommended. Use a recent desktop Chrome or Edge for the camera demonstration.

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. Choose **Mouse Mode** to play immediately, or click **Start Camera** and allow access. Camera permission is requested only by that button. HTTPS or localhost is required. The versioned MediaPipe model and matching 0.10.32 WASM runtime are included in `public/mediapipe`; no model CDN is needed at runtime. Optional Google Fonts are the only external presentation request.

```sh
npm run build
npm test -- --run
npm run preview
```

## Play and controls

### Tailscale access

The production build is available within your tailnet at **https://desktop-p7qh231.tail214b5d.ts.net/**. Keep this Windows PC awake and connected to Tailscale. The HTTPS endpoint proxies to the production preview server on `127.0.0.1:4173`; its host allowlist is in `vite.config.ts`.

Tailscale Serve configuration persists, but after restarting Windows, start the local server with `npm run preview`. After changing the game, run `npm run build` to update the served files. To disable access, run `tailscale serve --https=443 off` (the executable is in `C:\Program Files\Tailscale` if it is not on PATH). Access is restricted to your tailnet; no public Funnel is configured.

- Move the paddle beside the right edge of the left platform, roughly level with its top. Frank automatically boards.
- Carry him across the gap. Bring the paddle beside the left edge of the right platform and level with its top. Frank walks off and into the portal.
- In Mouse Mode, the cursor is the paddle target. In Camera Mode, show one palm to the webcam; the paddle sits 18 logical pixels above its center.
- **Space** spawns Frank; **R** resets Frank and the score; **P** pauses/resumes. Buttons provide mode selection, camera stop, pause, and reset.
- Switching tabs pauses the game. Resume explicitly when you return. Stop Camera and Mouse Mode both release camera tracks; closing the page also stops them.

## Compact architecture

- `src/main.ts`: Vite entry, camera and control lifecycle, public command boundary.
- `src/game/GameScene.ts`: 960 × 540 responsive scene, Arcade static collisions/gravity, assisted boarding/exit transitions, scoring and procedural effects.
- `src/game/Character.ts`: expressive procedural character and Arcade body.
- `src/game/HandPlatform.ts`: pure palm filter, tracking lifecycle, bounded final platform movement, transfer checks and absolute rider attachment.
- `src/tracking/HandTracker.ts`: MediaDevices and MediaPipe only; emits plain logical `{x,y}` observations. A scheduled synchronous inference call runs at a 25 Hz target, lowering frequency when inference is slow. It never queues inferences.

The video uses `object-fit: contain` behind the transparent canvas. Normalized landmarks map into that same contained rectangle before one horizontal mirror. Palm center uses landmarks 0, 5, 9, 13, and 17. The horizontal paddle has a fixed, forgiving 144 px width. Position smoothing uses `1 - exp(-dt / 0.075)`, observation jump limiting, and a final 720 px/s movement limit. Losing tracking holds the platform for 350 ms, then releases the rider to Arcade gravity. Attached feet are set from platform position plus one recorded offset, avoiding accumulated displacement and jitter detachment. Boarding and exit are short scripted walks, with 32 px horizontal-gap and 40 px vertical tolerances.

MediaPipe initialization follows the [official Hand Landmarker web documentation](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js). It requests VIDEO mode, one hand, GPU first and CPU fallback. Bundled model: Google's version 1 float16 Hand Landmarker from `storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`. Third-party MediaPipe runtime/model assets remain subject to their upstream licenses; see the included runtime license and [MediaPipe repository](https://github.com/google-ai-edge/mediapipe).

## Future Twitch boundary

```ts
window.holdMyChat.spawnCharacter({ id: 'viewer-123', name: 'Frank' });
window.holdMyChat.command({ type: 'spawn', id: 'viewer-456', name: 'Alex' });
window.holdMyChat.command({ type: 'reset' });
window.holdMyChat.command({ type: 'pause' });
window.holdMyChat.command({ type: 'resume' });
```

The API is available after the game loads. A spawn replaces the single current character. No Twitch authentication, chat connection, backend or queue is implemented. The boundary is ready for a future Twitch adapter; this is not yet a production Twitch integration.

## Verification and limitations

The focused Vitest suite covers 10-second attachment stability, grace/inactive behavior, bounded extreme reacquisition, assisted transfer tolerances, and mirrored 16:9 / 4:3 / portrait coordinate mapping. Mouse acceptance and camera results are reported separately below. Physical webcam acceptance requires a person with a real hand and has **not** been performed by the coding agent.

The camera model runs synchronously on the main thread. Slower devices lower the inference frequency and may still stutter. One hand and one rider are supported. The fixed paddle is intentionally forgiving and is not a palm pose or finger collision simulation. Very fast motion can outrun the smoothed paddle. A large reacquisition jump is approached gradually, so align the palm with the visible paddle before continuing. Once an exit walk starts, Frank completes it independently of the hand.

## Manual real-hand acceptance checklist

- [ ] Start Camera; verify camera permission, live image and tracking status. Move left/right and up/down: palm and paddle should align naturally.
- [ ] Try a 4:3 camera; verify horizontal letterboxing and palm alignment near both image edges. Resize the browser and recheck.
- [ ] Board Frank and carry him in both axes for 10 seconds without an unexplained fall.
- [ ] Reach the exit; verify walk-off, portal effect, score increment and respawn. Complete **five consecutive real-hand rescues**.
- [ ] Hide the hand for under 350 ms: the paddle holds Frank. Hide it longer: he falls and respawns.
- [ ] Reintroduce the hand far away: Frank must not teleport. Pause/resume and switch tabs without a large movement jump.
- [ ] Stop Camera: webcam activity ends. Deny permission / unplug the camera: an understandable error offers Mouse Mode.

## Browser verification record

Verified in headless Chrome through actual cursor input: five consecutive mouse rescues, a 10-second attached ride, falling/respawn after paddle deactivation, pause stability, reset, and no uncaught browser errors. Visually inspected initial and rescue screenshots. With a synthetic camera device, verified GPU model initialization, a live 1280 × 720 video stream, no-hand status, camera stop, permission-denied messaging, and Mouse Mode fallback. These camera checks do not establish real-hand acceptance.
