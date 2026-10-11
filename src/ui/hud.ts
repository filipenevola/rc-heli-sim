import type { ControlFrame } from '../input/types';
import type { HelicopterSim } from '../sim/physics';

const MODE_NAMES = ['Normal', 'Idle-Up 1', 'Idle-Up 2'];

export class Hud {
  private el: HTMLElement;
  private sticks: HTMLCanvasElement;
  private crash: HTMLElement;
  private fpsSamples = 0;
  private fpsTime = 0;
  private fps = 0;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    container.appendChild(this.el);
    this.sticks = document.createElement('canvas');
    this.sticks.className = 'hud-sticks';
    this.sticks.width = 200;
    this.sticks.height = 100;
    container.appendChild(this.sticks);
    this.crash = document.createElement('div');
    this.crash.className = 'crash-banner';
    this.crash.style.display = 'none';
    container.appendChild(this.crash);
  }

  update(sim: HelicopterSim, ctl: ControlFrame, sourceLabel: string, dt: number): void {
    this.fpsSamples++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsSamples / this.fpsTime;
      this.fpsSamples = 0;
      this.fpsTime = 0;
    }
    const t = sim.telemetry;
    const s = sim.state;
    const rows: [string, string][] = [
      ['Model', sim.model.name],
      ['Input', sourceLabel],
      ['Mode', ctl.throttleHold ? 'THROTTLE HOLD' : MODE_NAMES[ctl.flightMode]],
      ['Head speed', `${t.headspeedRpm.toFixed(0)} rpm`],
      ['Collective', `${t.collectiveDeg.toFixed(1)}°`],
      ['Altitude', `${t.altitude.toFixed(1)} m`],
      ['Climb', `${t.verticalSpeed.toFixed(1)} m/s`],
      ['Speed', `${(t.groundSpeed * 3.6).toFixed(0)} km/h`],
      ['Distance', `${Math.hypot(s.pos.x, s.pos.z).toFixed(0)} m`],
      ['Power', `${t.motorPower.toFixed(0)} W`],
      ['Ground effect', `${((t.groundEffect - 1) * 100).toFixed(0)}%`],
      ['FPS', this.fps.toFixed(0)],
    ];
    this.el.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    this.drawSticks(ctl);
    if (s.crashed) {
      this.crash.style.display = '';
      this.crash.innerHTML = `<h2>Crash</h2><p>${s.crashReason}</p><p class="hint">Press R or tap Reset</p>`;
    } else this.crash.style.display = 'none';
  }

  private drawSticks(ctl: ControlFrame): void {
    const g = this.sticks.getContext('2d')!;
    const w = this.sticks.width;
    const h = this.sticks.height;
    g.clearRect(0, 0, w, h);
    const box = (cx: number, x: number, y: number) => {
      const r = 40;
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 1;
      g.strokeRect(cx - r, h / 2 - r, r * 2, r * 2);
      g.beginPath();
      g.moveTo(cx - r, h / 2); g.lineTo(cx + r, h / 2);
      g.moveTo(cx, h / 2 - r); g.lineTo(cx, h / 2 + r);
      g.stroke();
      g.fillStyle = '#ffd34d';
      g.beginPath();
      g.arc(cx + x * r, h / 2 - y * r, 5, 0, Math.PI * 2);
      g.fill();
    };
    // Always drawn as Mode 2 for the display: left = rudder/collective, right = aileron/elevator.
    box(50, ctl.rudder, ctl.collective);
    box(150, ctl.aileron, ctl.elevator);
  }
}
