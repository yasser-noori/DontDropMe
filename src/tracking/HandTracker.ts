import type { Pinch } from '../shared/escape';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { Point } from '../game/HandPlatform';

/** object-fit:contain rectangle in logical space; mirror exactly once here. */
export function mapVideoPoint(x: number, y: number, videoWidth: number, videoHeight: number, zoom = 1): Point {
  const scale = (zoom > 1 ? Math.max(960 / videoWidth, 540 / videoHeight) : Math.min(960 / videoWidth, 540 / videoHeight)) * zoom;
  const width = videoWidth * scale, height = videoHeight * scale;
  return { x: (960 - width) / 2 + (1 - x) * width, y: (540 - height) / 2 + y * height };
}

export class HandTracker {
  // Display an inset of the full sensor frame; inference still receives every pixel.
  private readonly zoom = 1.35;
  private detector: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private timer = 0;
  private generation = 0;
  private lastVideoTime = -1;
  private interval = 40;
  delegate: 'GPU' | 'CPU' = 'GPU';
  constructor(private video: HTMLVideoElement, private observe: (point: Point | null) => void, private onError: (message: string) => void, private isPaused: () => boolean, private observePinch: (pinch: Pinch | null) => void = () => {}) {
    video.style.objectFit = 'cover';
    video.style.transform = `scale(${-this.zoom}, ${this.zoom})`;
    video.style.transformOrigin = '50% 50%';
  }
  private map(x: number, y: number) { return mapVideoPoint(x, y, this.video.videoWidth, this.video.videoHeight, this.zoom); }
  async start() {
    this.stop();
    const generation = this.generation;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Camera needs localhost or HTTPS. You can play in Mouse Mode.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: false });
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return false; }
      this.stream = stream; this.video.srcObject = stream; await this.video.play();
      const files = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`);
      const options = { baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}mediapipe/hand_landmarker.task`, delegate: 'GPU' as 'GPU' | 'CPU' }, runningMode: 'VIDEO' as const, numHands: 1, minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .5 };
      let detector: HandLandmarker;
      try { detector = await HandLandmarker.createFromOptions(files, options); this.delegate = 'GPU'; }
      catch { options.baseOptions.delegate = 'CPU'; detector = await HandLandmarker.createFromOptions(files, options); this.delegate = 'CPU'; }
      if (generation !== this.generation) { detector.close(); return false; }
      this.detector = detector;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (generation === this.generation) { this.stop(); this.onError('Camera disconnected. Restart the camera or use Mouse Mode.'); } });
      this.tick(generation);
      return this.detector !== null;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.stop();
      if (error instanceof DOMException && error.name === 'NotAllowedError') throw new Error('Camera permission was denied. Allow access in your browser or choose Mouse Mode.');
      if (error instanceof DOMException && error.name === 'NotFoundError') throw new Error('No camera found. Connect a webcam or choose Mouse Mode.');
      throw new Error(`Camera could not start: ${error instanceof Error ? error.message : String(error)}. Try Mouse Mode.`);
    }
  }
  /** Independent scheduled inference, no second rendering loop and no queued calls. */
  private tick(generation: number) {
    if (generation !== this.generation || !this.detector) return;
    const started = performance.now();
    try {
      if (!document.hidden && !this.isPaused() && this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.video.currentTime;
        const hand = this.detector.detectForVideo(this.video, started).landmarks[0];
        if (hand) {
          let x = 0, y = 0;
          for (const index of [0, 5, 9, 13, 17]) { x += hand[index].x; y += hand[index].y; }
          const point = this.map(x / 5, y / 5);
          point.y -= 18; // a visible surface just above the center of the palm
          this.observe(point);
          const thumb = this.map(hand[4].x, hand[4].y);
          const index = this.map(hand[8].x, hand[8].y);
          const palmA = this.map(hand[5].x, hand[5].y);
          const palmB = this.map(hand[17].x, hand[17].y);
          const wrist = this.map(hand[0].x, hand[0].y), middle = this.map(hand[9].x, hand[9].y);
          const palmSize = Math.max(1, Math.hypot(palmA.x - palmB.x, palmA.y - palmB.y), Math.hypot(wrist.x - middle.x, wrist.y - middle.y) * .7);
          this.observePinch({ thumb, index, ratio: Math.hypot(thumb.x - index.x, thumb.y - index.y) / palmSize });
        } else { this.observe(null); this.observePinch(null); }
      }
      const duration = performance.now() - started;
      if (duration > 24) this.interval = Math.min(100, Math.max(this.interval, duration * 2));
      this.timer = window.setTimeout(() => this.tick(generation), Math.max(0, this.interval - duration));
    } catch {
      this.stop(); this.onError('Hand tracking stopped unexpectedly. Restart the camera or choose Mouse Mode.');
    }
  }
  stop() {
    this.generation++; window.clearTimeout(this.timer);
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.video.pause(); this.video.srcObject = null;
    this.detector?.close(); this.detector = null;
    this.lastVideoTime = -1; this.interval = 40; this.observe(null); this.observePinch(null);
  }
}
