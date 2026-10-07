import type { Rational } from "@ve/schema";

export type Scheduler = {
  now(): number;
  request(callback: () => void): number;
  cancel(handle: number): void;
};

export const browserScheduler: Scheduler = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h),
};

type Listener = () => void;

/**
 * The single playhead clock. Lives outside React state: only the playhead, the
 * timecode and the preview subscribe, so playback never re-renders the editor.
 * `position` is fractional timeline frames.
 */
export class PlayheadClock {
  private pos = 0;
  private isPlaying = false;
  private rateValue = 1;
  private fps: Rational = { num: 30, den: 1 };
  private duration = 0;
  private lastTime = 0;
  private handle: number | null = null;
  private tickListeners = new Set<Listener>();
  private stateListeners = new Set<Listener>();

  constructor(private scheduler: Scheduler = browserScheduler) {}

  get position(): number {
    return this.pos;
  }
  get frame(): number {
    return Math.floor(this.pos);
  }
  get playing(): boolean {
    return this.isPlaying;
  }
  get rate(): number {
    return this.rateValue;
  }
  get length(): number {
    return this.duration;
  }

  configure(fps: Rational, duration: number): void {
    this.fps = fps;
    this.duration = Math.max(0, duration);
    if (this.pos > this.duration) this.pos = this.duration;
    if (this.isPlaying && this.pos >= this.duration) this.pause();
    else this.emitTick();
  }

  seek(frame: number): void {
    this.pos = Math.min(Math.max(0, frame), this.duration);
    this.emitTick();
  }

  play(): void {
    if (this.isPlaying || this.duration <= 0) return;
    if (this.pos >= this.duration) this.pos = 0;
    this.isPlaying = true;
    this.lastTime = this.scheduler.now();
    this.schedule();
    this.emitState();
    this.emitTick();
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
    this.emitState();
    this.emitTick();
  }

  toggle(): void {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  setRate(rate: number): void {
    this.rateValue = rate;
    this.emitState();
    this.emitTick();
  }

  onTick(listener: Listener): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  /** Fires only when playing, paused or the rate changes. */
  onState(listener: Listener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  dispose(): void {
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
    this.isPlaying = false;
    this.tickListeners.clear();
    this.stateListeners.clear();
  }

  private schedule(): void {
    this.handle = this.scheduler.request(() => this.step());
  }

  private step(): void {
    if (!this.isPlaying) return;
    const now = this.scheduler.now();
    const seconds = Math.max(0, now - this.lastTime) / 1000;
    this.lastTime = now;
    this.pos += seconds * (this.fps.num / this.fps.den) * this.rateValue;
    if (this.pos >= this.duration) {
      this.pos = this.duration;
      this.pause();
      return;
    }
    this.emitTick();
    this.schedule();
  }

  private emitTick(): void {
    this.tickListeners.forEach((l) => l());
  }

  private emitState(): void {
    this.stateListeners.forEach((l) => l());
  }
}
