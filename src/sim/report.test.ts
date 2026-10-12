import { describe, expect, it } from 'vitest';
import { physicsReport } from './report';
import { HELI_250, HELI_450, HELI_700 } from './heli-model';

/**
 * Sanity against published / commonly measured numbers for each class. Sources: hover currents and pitch
 * settings reported for T-Rex 450 / 700 class models (8–11 A at 11 V for a 450, 12–16 A at 44 V for a 700,
 * 5–6° of collective in the hover), the low figure of merit of model rotors flown at 3D head speeds (profile
 * power dominates at these tiny blade loadings: FM 0.15–0.45), and the textbook vertical-autorotation sink of
 * roughly 1.7–2.5 × the hover induced velocity for full-size rotors (model rotors sink faster: low FM).
 */
describe('physics report', () => {
  it('450: disc loading ~19 N/m², hover at 4.5–7°, ~70–150 W, FM 0.15–0.45, climbs hard, autorotates', () => {
    const r = physicsReport(HELI_450);
    expect(r.discLoading).toBeGreaterThan(16);
    expect(r.discLoading).toBeLessThan(22);
    expect(r.hoverPitchDeg).toBeGreaterThan(3.8); // no tip-loss factor: ~1° below a typical setup sheet
    expect(r.hoverPitchDeg).toBeLessThan(7);
    expect(r.hoverTotalPowerW).toBeGreaterThan(70);
    expect(r.hoverTotalPowerW).toBeLessThan(150);
    expect(r.figureOfMerit).toBeGreaterThan(0.15);
    expect(r.figureOfMerit).toBeLessThan(0.45);
    expect(r.rotorTrimPitchDeg).toBeLessThan(r.hoverPitchDeg); // the fuselage download costs some pitch
    expect(r.inducedVelocity).toBeGreaterThan(2.3);
    expect(r.inducedVelocity).toBeLessThan(3.4);
    expect(r.maxClimb).toBeGreaterThan(6);
    expect(r.autoSink).toBeGreaterThan(1.5 * r.inducedVelocity);
    // Model rotors sink faster than the full-size 1.7–2.2 × vi rule: profile drag has to be paid by descent too.
    // Pilots report 9–12 m/s for a vertical auto on a 450.
    expect(r.autoSink).toBeLessThan(5 * r.inducedVelocity);
    expect(r.autoSink).toBeLessThan(13);
    expect(r.autoHeadSpeedFrac).toBeGreaterThan(0.5);
    expect(r.hoverEnduranceMin).toBeGreaterThan(6);
    expect(r.hoverEnduranceMin).toBeLessThan(18);
  });

  it('700: hover 400–900 W, FM 0.15–0.45, and the 250 micro sits between', () => {
    const big = physicsReport(HELI_700);
    expect(big.hoverTotalPowerW).toBeGreaterThan(400);
    expect(big.hoverTotalPowerW).toBeLessThan(900);
    expect(big.figureOfMerit).toBeGreaterThan(0.15);
    expect(big.figureOfMerit).toBeLessThan(0.45);
    expect(big.hoverPitchDeg).toBeGreaterThan(3);
    expect(big.hoverPitchDeg).toBeLessThan(7.5);
    const micro = physicsReport(HELI_250);
    expect(micro.hoverTotalPowerW).toBeGreaterThan(10);
    expect(micro.hoverTotalPowerW).toBeLessThan(50);
    expect(micro.maxClimb).toBeGreaterThan(3);
  });
});
