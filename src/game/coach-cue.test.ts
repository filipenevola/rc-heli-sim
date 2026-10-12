import { describe, expect, it } from 'vitest';
import { neutralFrame } from '../input/types';
import { CueTimer, coachCue } from './coach-cue';

describe('spoken coach cues', () => {
  it('names the axis furthest from the ghost stick, with the right direction', () => {
    const ctl = neutralFrame();
    const hint = neutralFrame();
    expect(coachCue(ctl, hint)).toBeNull();
    hint.collective = -0.4; // ctl is at -1: raise it
    expect(coachCue(ctl, hint)).toBe('More collective');
    hint.elevator = -0.9; // stick back wanted more than collective
    expect(coachCue(ctl, hint)).toBe('Nose up');
    hint.elevator = 0;
    hint.collective = -1;
    ctl.aileron = 0.5;
    expect(coachCue(ctl, hint)).toBe('Roll left');
    ctl.aileron = 0;
    ctl.rudder = -0.5;
    expect(coachCue(ctl, hint)).toBe('Nose right');
    ctl.rudder = -0.2; // under the threshold
    expect(coachCue(ctl, hint)).toBeNull();
  });

  it('only speaks a correction that persists, and not again before the cooldown', () => {
    const timer = new CueTimer(1500, 5000);
    expect(timer.update('More collective', 0)).toBeNull();
    expect(timer.update('More collective', 1000)).toBeNull();
    expect(timer.update('More collective', 1600)).toBe('More collective');
    expect(timer.update('More collective', 3000)).toBeNull(); // cooldown
    expect(timer.update('Nose up', 3100)).toBeNull(); // new candidate restarts the hold
    expect(timer.update('Nose up', 6700)).toBe('Nose up');
    expect(timer.update(null, 7000)).toBeNull();
  });
});
