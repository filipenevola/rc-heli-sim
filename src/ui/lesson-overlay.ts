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
    (this.el.querySelector('.lesson-title span') as HTMLElement).textContent = runner.mode === 'teach' ? 'Teach me' : 'Show me';
    (this.el.querySelector('#lesson-name') as HTMLElement).textContent = runner.lesson.title;
    this.intro.textContent = runner.mode === 'teach'
      ? `${runner.lesson.intro} You fly: the hollow ring shows where the stick should be right now; match it.`
      : runner.lesson.intro;
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  update(runner: LessonRunner, ctl: ControlFrame, hint: ControlFrame | null = null): void {
    const step = runner.step;
    const teach = runner.mode === 'teach';
    let caption = step?.caption ?? '';
    if (runner.finished) caption = runner.failed ?? (teach ? 'You did it. Lesson complete!' : 'Lesson complete. Your turn: press Reset and try it.');
    else if (teach && runner.crashed) caption = 'Crashed. Resetting to the pad; the lesson starts again.';
    this.caption.textContent = caption;
    this.progress.textContent = `Step ${Math.min(runner.stepIndex + 1, runner.lesson.steps.length)} of ${runner.lesson.steps.length}`;
    const modeWanted = hint ? hint.flightMode : ctl.flightMode;
    const holdWanted = hint ? hint.throttleHold : ctl.throttleHold;
    const modeMismatch = hint && hint.flightMode !== ctl.flightMode;
    const holdMismatch = hint && hint.throttleHold !== ctl.throttleHold;
    this.switches.innerHTML = `<span class="${modeWanted > 0 ? 'on' : ''} ${modeMismatch ? 'want' : ''}">Mode: ${['Normal', 'Idle-Up 1', 'Idle-Up 2'][modeWanted]}${modeMismatch ? ' ← set this' : ''}</span><span class="${holdWanted ? 'on' : ''} ${holdMismatch ? 'want' : ''}">Throttle hold: ${holdWanted ? 'ON' : 'off'}${holdMismatch ? ' ← set this' : ''}</span>`;
    this.draw(ctl, hint);
    this.coachLine(ctl, hint, teach && !runner.finished);
  }

  private coach: HTMLElement | null = null;
  private coachSince = 0;
  private coachText = '';
  /** One short instruction at a time, from the biggest gap between the player's sticks and the hint. */
  private coachLine(ctl: ControlFrame, hint: ControlFrame | null, on: boolean): void {
    if (!this.coach) {
      this.coach = document.createElement('div');
      this.coach.className = 'lesson-coach';
      this.el.querySelector('.lesson-top')!.appendChild(this.coach);
    }
    if (!on || !hint) {
      this.coach.style.display = 'none';
      return;
    }
    const gaps: [number, string][] = [
      [hint.collective - ctl.collective, 'collective'],
      [hint.elevator - ctl.elevator, 'elevator'],
      [hint.aileron - ctl.aileron, 'aileron'],
      [hint.rudder - ctl.rudder, 'rudder'],
    ];
    let text = '';
    if (hint.flightMode !== ctl.flightMode) text = `Switch to ${['Normal', 'Idle-Up 1', 'Idle-Up 2'][hint.flightMode]}`;
    else if (hint.throttleHold !== ctl.throttleHold) text = hint.throttleHold ? 'Throttle hold ON' : 'Throttle hold off';
    else {
      let best: [number, string] = [0, ''];
      for (const g of gaps) if (Math.abs(g[0]) > Math.abs(best[0])) best = g;
      const d = best[0];
      const big = Math.abs(d) > 0.45 ? 'a lot ' : Math.abs(d) > 0.2 ? 'a bit ' : '';
      if (Math.abs(d) > 0.12) {
        switch (best[1]) {
          case 'collective': text = d > 0 ? `${big}more collective` : `${big}less collective`; break;
          case 'elevator': text = d > 0 ? `nose down ${big}(forward)` : `nose up ${big}(back)`; break;
          case 'aileron': text = d > 0 ? `roll right ${big}` : `roll left ${big}`; break;
          case 'rudder': text = d > 0 ? `nose right ${big}(rudder)` : `nose left ${big}(rudder)`; break;
        }
      } else text = 'Good, hold it there';
    }
    // Hold each instruction briefly so it reads as advice, not a flicker.
    const now = performance.now();
    if (text !== this.coachText && now - this.coachSince > 700) {
      this.coachText = text;
      this.coachSince = now;
      this.coach.textContent = text.charAt(0).toUpperCase() + text.slice(1);
      this.coach.classList.toggle('ok', text.startsWith('Good'));
    }
    this.coach.style.display = '';
  }

  private draw(ctl: ControlFrame, hint: ControlFrame | null): void {
    const g = this.sticks.getContext('2d')!;
    const W = this.sticks.width;
    const H = this.sticks.height;
    g.clearRect(0, 0, W, H);
    const gimbal = (cx: number, x: number, y: number, labels: [string, string, string, string], ghost: [number, number] | null) => {
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
      // Ghost: where the stick should be (teach mode).
      if (ghost) {
        g.strokeStyle = '#ffd34d';
        g.lineWidth = 3;
        g.setLineDash([6, 4]);
        g.beginPath();
        g.arc(cx + ghost[0] * r, cy - ghost[1] * r, 18, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
      // Stick shaft and knob.
      const kx = cx + x * r;
      const ky = cy - y * r;
      g.strokeStyle = '#bbb';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(kx, ky);
      g.stroke();
      g.fillStyle = ghost ? '#ffffff' : '#ffd34d';
      g.beginPath();
      g.arc(kx, ky, 14, 0, Math.PI * 2);
      g.fill();
    };
    gimbal(W * 0.24, ctl.rudder, ctl.collective, ['more collective', 'less collective', 'nose left', 'nose right'], hint ? [hint.rudder, hint.collective] : null);
    gimbal(W * 0.76, ctl.aileron, ctl.elevator, ['nose down (forward)', 'nose up (back)', 'roll left', 'roll right'], hint ? [hint.aileron, hint.elevator] : null);
    if (hint) {
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.font = '12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('white = your sticks · dashed ring = where they should be', W / 2, H - 4);
    }
  }
}
