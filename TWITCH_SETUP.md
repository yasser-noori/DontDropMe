# Live Twitch and hackathon handoff

The main Play button is a rehearsal. Choose **Create Twitch Room** for real viewers, chat, and votes. Live mode never generates demo votes or synthetic join messages.

## Connect a stream

1. Register a confidential application at https://dev.twitch.tv/console/apps. Register this exact OAuth redirect URL: `https://desktop-p7qh231.tail214b5d.ts.net/auth/twitch/callback`. For another deployment, change PUBLIC_ORIGIN and register that origin followed by `/auth/twitch/callback`.
2. Copy `.env.example` to `.env`. Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET locally. Keep the secret out of source control and browser code. The existing .gitignore excludes .env.
3. Run `npm install`, `npm run build`, then `npm start`. Node requirements are in package.json. Restart the server after changing configuration.
4. Choose **Create Twitch Room**, then **Connect my Twitch channel**. The broadcaster authorizes `user:read:chat`. This connection receives chat; it does not request permission to post chat messages.
5. Share the **Viewer join page** link. Viewers type `!join` in the connected Twitch channel, open the link, authenticate as the same Twitch user, and press Ready. Their private word or impostor role is visible only on their companion page.
6. Four connected, ready, authenticated viewers are randomly selected from the eligible pool. The role-reading interval and clue-submission transition happen automatically. Viewers submit hints and answers privately.
7. Picking up a character reveals the hint and opens voting. `!trust` means No, not the impostor; `!drop` means Yes, impostor. Each verified Twitch user has one vote per character; a new command replaces their previous choice. The live pie uses these server counts, never simulated counts. Votes are advisory: the streamer chooses the cave.
8. Return a pinched impostor to the Impostor cave to win. Twitch disconnection pauses votes and displays connection status. Host refresh preserves live authorization; demo refresh starts fresh.

## Authorization and EventSub

Tokens stay in server memory. OAuth state is cookie-bound and expires after ten minutes. Access tokens are validated on authorization/startup and at least hourly; the app checks client ID, user identity, and broadcaster scope. Tokens refresh before expiry; invalid authorization ends the associated session.

The EventSub adapter subscribes to channel.chat.message after session welcome, follows the server's keepalive timeout, migrates directed reconnects, resubscribes after disconnects, and stops on revocation. It verifies broadcaster identity and deduplicates notification IDs. Join/vote identity comes from Twitch chatter_user_id, not browser-supplied names. A broadcaster has one active chat adapter per process.

References: [chat authentication](https://dev.twitch.tv/docs/chat/authenticating/), [WebSocket lifecycle](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/), [OAuth tokens](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/), [token validation](https://dev.twitch.tv/docs/authentication/validate-tokens/).

## Verification

Run `npm test -- --run tests/twitch.test.ts tests/trust-fall.test.ts` and `npm run build`. Automated checks cover verified joins, duplicate/wrong-channel events, OAuth validation/revocation, random ready-viewer selection, vote replacement, and game decisions.

Live acceptance still requires registered app credentials and broadcaster authorization: show real !join messages on a test stream, authenticate four viewer accounts, ready them, reveal a clue with webcam pickup, cast !trust/!drop and confirm the pie, then complete a cave decision and pinch return. Test disconnect/reconnect and revoking app authorization. Mocked tests do not establish live acceptance.

Known limits: one process, in-memory rooms/tokens, private companion pages for clues and answers, and trusted-host reporting of physical positions. A server restart clears rooms and requires reconnecting Twitch. The Twitch-style shell is a game interface; it does not embed the broadcaster's video. Other example channel listings remain decorative.

## Supplied hackathon submission requirements

- Publish all source, assets, and run instructions to GitHub, GitLab, or Bitbucket. Follow the supplied brief's sharing instructions for a private repository.
- Record a public YouTube demo of at most three minutes showing the game working with real Twitch chat and how Codex was used.
- Supply a project description and the Codex session ID from the main build thread.

Suggested recording: real chat joins and the waiting lobby; private viewer roles; webcam pickup and hints; real viewer votes; the streamer's cave decision; pinch/capture/return. Finish with a brief view of the Codex build process. Publishing a repository, uploading a video, and submitting the entry are separate steps.

Description draft: “DontDropMe! turns Twitch viewers into tiny characters the streamer carries with a real hand. Viewers join through Twitch chat, receive private clues, and bluff through an impostor game. The community votes while the streamer chooses who to save. A caught impostor can escape, creating a pinch-to-catch chase on stream. Built with OpenAI Codex, TypeScript, Phaser, MediaPipe, Twitch OAuth, Helix, and EventSub.”
