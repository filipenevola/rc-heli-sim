import { neutralFrame, type ControlFrame, type InputSource, type StickMode } from './types';

/**
 * Two on-screen gimbals drawn like a transmitter. The right/left stick functions follow the
 * selected stick mode. The throttle/collective axis has no spring so it stays where you leave it,
 * just like a real transmitter with the ratchet.
 */
export class TouchInput implements InputSource {
  readonly id = 'touch' as const;
  readonly label = 'Touch sticks';
  private frame = neutralFrame();
  private last = 0;
  private enabled = true;
  private root: HTMLElement;
  private sticks: Gimbal[];
  mode: StickMode = 2;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch-sticks';
    container.appendChild(this.root);
    this.sticks = [new Gimbal(this.root, 'left'), new Gimbal(this.root, 'right')];
    for (const g of this.sticks) g.onMove = () => (this.last = performance.now());
    this.applyMode();
  }

  available(): boolean { return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0; }
  lastActivity(): number { return this.last; }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.root.style.display = enabled ? '' : 'none';
  }
  setMode(mode: StickMode): void {
    this.mode = mode;
    this.applyMode();
  }

  private applyMode(): void {
    // Which stick holds the throttle (no spring on its vertical axis).
    const throttleOnLeft = this.mode === 2 || this.mode === 4;
    this.sticks[0].springY = !throttleOnLeft;
    this.sticks[1].springY = throttleOnLeft;
    for (const g of this.sticks) g.reset();
  }

  poll(_dt: number): ControlFrame {
    const f = this.frame;
    if (!this.enabled) return f;
    const [l, r] = this.sticks;
    switch (this.mode) {
      case 1: f.rudder = l.x; f.elevator = l.y; f.aileron = r.x; f.collective = r.y; break;
      case 2: f.rudder = l.x; f.collective = l.y; f.aileron = r.x; f.elevator = r.y; break;
      case 3: f.aileron = l.x; f.elevator = l.y; f.rudder = r.x; f.collective = r.y; break;
      case 4: f.aileron = l.x; f.collective = l.y; f.rudder = r.x; f.elevator = r.y; break;
    }
    return f;
  }

  setFlightMode(m: 0 | 1 | 2): void { this.frame.flightMode = m; }
  setThrottleHold(h: boolean): void { this.frame.throttleHold = h; }
  get flightMode(): 0 | 1 | 2 { return this.frame.flightMode; }
  get throttleHold(): boolean { return this.frame.throttleHold; }
}

class Gimbal {
  x = 0;
  y = 0;
  springY = true;
  onMove: (() => void) | null = null;
  private el: HTMLElement;
  private knob: HTMLElement;
  private pointerId: number | null = null;
  private radius = 60;

  constructor(parent: HTMLElement, side: 'left' | 'right') {
    this.el = document.createElement('div');
    this.el.className = `gimbal gimbal-${side}`;
    this.knob = document.createElement('div');
    this.knob.className = 'gimbal-knob';
    this.el.appendChild(this.knob);
    parent.appendChild(this.el);

    this.el.addEventListener('pointerdown', (e) => {
      if (this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      this.el.setPointerCapture(e.pointerId);
      this.radius = this.el.clientWidth / 2;
      this.move(e);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pointerId) this.move(e);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.x = 0;
      if (this.springY) this.y = 0;
      this.render();
    };
    this.el.addEventListener('pointerup', release);
    this.el.addEventListener('pointercancel', release);
    this.reset();
  }

  reset(): void {
    this.x = 0;
    this.y = this.springY ? 0 : -1;
    this.render();
  }

  private move(e: PointerEvent): void {
    const rect = this.el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const r = this.radius * 0.8;
    this.x = Math.max(-1, Math.min(1, (e.clientX - cx) / r));
    this.y = Math.max(-1, Math.min(1, -(e.clientY - cy) / r));
    this.onMove?.();
    this.render();
  }

  private render(): void {
    const r = this.el.clientWidth / 2 * 0.8 || 48;
    this.knob.style.transform = `translate(${this.x * r}px, ${-this.y * r}px)`;
  }
}
