import Phaser from 'phaser';
import { GameScene, type GameCommand } from './game/GameScene';
import './styles.css';
import { HandTracker } from './tracking/HandTracker';

declare global {
  interface Window {
    holdMyChat: {
      spawnCharacter(character: { id: string; name: string }): void;
      command(command: GameCommand): void;
    };
  }
}

export const scene = new GameScene();
const game = new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: 960, height: 540, transparent: true, antialias: true, physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 720 }, fps: 60, fixedStep: true } }, scene: [scene], scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, banner: false });
const message = (value: string) => { document.querySelector('#message')!.textContent = value; };
const camera = document.querySelector<HTMLButtonElement>('#camera')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const tracker = new HandTracker(document.querySelector<HTMLVideoElement>('#webcam')!, p => scene.observe(p), error => { scene.setMode('idle'); stop.hidden = true; message(error); }, () => scene.paused);
let request = 0;
function stopCamera() { request++; tracker.stop(); stop.hidden = true; camera.disabled = false; camera.textContent = '◉ Start Camera'; }
camera.addEventListener('click', async () => {
  const current = ++request;
  document.querySelector('#mouse')!.setAttribute('aria-pressed', 'false');
  scene.setMode('idle'); camera.disabled = true; camera.textContent = 'Loading…';
  stop.hidden = false; message('Allow camera access. Loading the local hand model…');
  try {
    if (await tracker.start() && current === request) {
      scene.setMode('camera'); message(`Camera active · ${tracker.delegate}. Show one palm. Video stays on your device.`);
    }
  } catch (error) { if (current === request) { message(error instanceof Error ? error.message : String(error)); stop.hidden = true; } }
  finally { if (current === request) { camera.disabled = false; camera.textContent = '◉ Start Camera'; } }
});
stop.addEventListener('click', () => { stopCamera(); scene.setMode('idle'); message('Camera stopped. Choose a mode to continue.'); });
document.querySelector('#mouse')!.addEventListener('click', () => {
  stopCamera();
  scene.setMode('mouse');
  message('Mouse Test Mode. Move your cursor beside Frank, then carry him right.');
  document.querySelector('#mouse')!.setAttribute('aria-pressed', 'true');
});
document.querySelector('#reset')!.addEventListener('click', () => scene.command({ type: 'reset' }));
document.querySelector('#pause')!.addEventListener('click', () => scene.command({ type: scene.paused ? 'resume' : 'pause' }));
const api = { spawnCharacter: (character: { id: string; name: string }) => scene.spawnCharacter(character), command: (command: GameCommand) => scene.command(command) };
Object.assign(window, { holdMyChat: api });
document.addEventListener('visibilitychange', () => {
  scene.resetTiming();
  if (document.hidden && !scene.paused) scene.command({ type: 'pause' });
});
window.addEventListener('pagehide', () => { tracker.stop(); game.destroy(true); });
