import type { ControlFrame } from '../input/types';
import type { LessonRunner } from '../game/lessons';

/**
 * Shown while a lesson plays: the step caption, big transmitter gimbals mirroring the demo pilot's
 * thumbs (Mode 2: left = throttle/rudder, right = cyclic), switch states, and a Stop button.
 */
export class LessonOverlay {
  private el: HTMLElement;
  private caption: HTMLElement;
  private intro: HTMLElement;
  private sticks: HTMLCanvasElement;
  private switches: HTMLElement;
  private progress: HTMLElement;
  onStop: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'lesson';
    this.el.style.display = 'none';
    this.el.innerHTML = `
      <div class="lesson-top">
        <div class="lesson-title"><span>Teach me</span> <b id="lesson-name"></b> <button id="lesson-stop">Stop lesson</button></div>
        <div class="lesson-intro"></div>
        <div class="lesson-caption"></div>
        <div class="lesson-progress"></div>
      </div>
      <div class="lesson-sticks">
        <canvas width="680" height="240"></canvas>
        <div class="lesson-switches"></div>
      </div>`;
    container.appendChild(this.el);
    this.caption = this.el.querySelector('.lesson-caption')!;
    this.intro = this.el.querySelector('.lesson-intro')!;
    this.sticks = this.el.querySelector('canvas')!;
    this.switches = this.el.querySelector('.lesson-switches')!;
    this.progress = this.el.querySelector('.lesson-progress')!;
    this.el.querySelector('#lesson-stop')!.addEventListener('click', () => this.onStop?.());
  }

  show(runner: LessonRunner): void {
    this.el.style.display = '';
    (this.el.querySelector('#lesson-name') as HTMLElement).textContent = runner.lesson.title;
    this.intro.textContent = runner.lesson.intro;
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  update(runner: LessonRunner, ctl: ControlFrame): void {
    const step = runner.step;
    this.caption.textContent = runner.finished ? (runner.failed ?? 'Lesson complete. Your turn: press Reset and try it.') : step?.caption ?? '';
    this.progress.textContent = `Step ${Math.min(runner.stepIndex + 1, runner.lesson.steps.length)} of ${runner.lesson.steps.length}`;
    this.switches.innerHTML = `<span class="${ctl.flightMode > 0 ? 'on' : ''}">Mode: ${['Normal', 'Idle-Up 1', 'Idle-Up 2'][ctl.flightMode]}</span><span class="${ctl.throttleHold ? 'on' : ''}">Throttle hold: ${ctl.throttleHold ? 'ON' : 'off'}</span>`;
    this.draw(ctl);
  }

  private draw(ctl: ControlFrame): void {
    const g = this.sticks.getContext('2d')!;
    const W = this.sticks.width;
    const H = this.sticks.height;
    g.clearRect(0, 0, W, H);
    const gimbal = (cx: number, x: number, y: number, labels: [string, string, string, string]) => {
      const r = 85;
      const cy = H / 2;
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.beginPath();
      g.arc(cx, cy, r + 18, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 1;
      g.strokeRect(cx - r, cy - r, 2 * r, 2 * r);
      g.beginPath();
      g.moveTo(cx - r, cy); g.lineTo(cx + r, cy);
      g.moveTo(cx, cy - r); g.lineTo(cx, cy + r);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.font = '12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(labels[0], cx, cy - r - 6);
      g.fillText(labels[1], cx, cy + r + 16);
      g.textAlign = 'right';
      g.fillText(labels[2], cx - r - 4, cy + 4);
      g.textAlign = 'left';
      g.fillText(labels[3], cx + r + 4, cy + 4);
      // Stick shaft and knob.
      const kx = cx + x * r;
      const ky = cy - y * r;
      g.strokeStyle = '#bbb';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(kx, ky);
      g.stroke();
      g.fillStyle = '#ffd34d';
      g.beginPath();
      g.arc(kx, ky, 14, 0, Math.PI * 2);
      g.fill();
    };
    gimbal(W * 0.24, ctl.rudder, ctl.collective, ['more collective', 'less collective', 'nose left', 'nose right']);
    gimbal(W * 0.76, ctl.aileron, ctl.elevator, ['nose down (forward)', 'nose up (back)', 'roll left', 'roll right']);
  }
}
