import { add, clamp, cross, dot, eulerFromQ, len, norm, qIntegrate, rotate, rotateInv, scale, sub, v3, type Q, type V3, q as mkq } from './math';
import { pitchFromCurve, type HeliModel } from './heli-model';
import { emptyRotorResult, solveRotor, RHO } from './rotor';
import type { ControlFrame } from '../input/types';
import type { Wind } from './wind';

export const G = 9.81;
/** Physics step. 1 kHz keeps stiff skid contacts and the fast flapping dynamics stable with semi-implicit Euler. */
export const PHYSICS_DT = 1 / 1000;

export interface HeliState {
  pos: V3;
  vel: V3;
  /** Body -> world orientation. */
  ori: Q;
  /** Body angular velocity, rad/s. */
  omega: V3;
  /** Main rotor speed, rad/s. */
  rotorOmega: number;
  /** Tip-path-plane tilt: a1 = back (nose-up), b1 = right. rad. */
  a1: number;
  b1: number;
  /** Flybar paddle plane tilt (flybar models only). */
  fbA: number;
  fbB: number;
  /** Actuator positions after servo lag: collective (rad), cyclic pitch/roll (rad), tail pitch (rad). */
  servoCollective: number;
  servoCycPitch: number;
  servoCycRoll: number;
  servoTail: number;
  /** Controller integrators. */
  iPitch: number;
  iRoll: number;
  iYaw: number;
  governorTarget: number;
  governorI: number;
  crashed: boolean;
  crashReason: string;
  onGround: boolean;
  time: number;
}

/** Diagnostics exposed to the HUD. */
export interface Telemetry {
  thrust: number;
  torque: number;
  tailThrust: number;
  collectiveDeg: number;
  headspeedRpm: number;
  motorPower: number;
  altitude: number;
  groundSpeed: number;
  verticalSpeed: number;
  groundEffect: number;
  lambda: number;
}

export function initialState(model: HeliModel, yaw = 0): HeliState {
  const skidY = -Math.min(...model.contacts.filter((c) => c.kind === 'skid').map((c) => c.p.y));
  return {
    pos: v3(0, skidY + 0.002, -6),
    vel: v3(),
    ori: mkq(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)),
    omega: v3(),
    rotorOmega: 0,
    a1: 0,
    b1: 0,
    fbA: 0,
    fbB: 0,
    servoCollective: 0,
    servoCycPitch: 0,
    servoCycRoll: 0,
    servoTail: 0,
    iPitch: 0,
    iRoll: 0,
    iYaw: 0,
    governorTarget: 0,
    governorI: 0,
    crashed: false,
    crashReason: '',
    onGround: true,
    time: 0,
  };
}

const main = emptyRotorResult();
const tail = emptyRotorResult();

/**
 * 'rate' is how real helicopters fly: the stick commands a roll/pitch rate and the model keeps whatever
 * attitude you leave it in. 'attitude' is a training/arcade assist: the stick commands a bank angle and the
 * model self-levels when you let go, like a GPS drone. Not realistic, but a gentle way in (and the natural
 * pairing for phone-tilt control).
 */
export type AssistMode = 'rate' | 'attitude';

export class HelicopterSim {
  state: HeliState;
  assist: AssistMode = 'rate';
  /** Max bank/pitch angle at full stick in attitude mode, rad. */
  attitudeMaxAngle = (35 * Math.PI) / 180;
  /** Outer-loop gain: rate commanded per radian of attitude error, 1/s. */
  attitudeGain = 7;
  telemetry: Telemetry = {
    thrust: 0, torque: 0, tailThrust: 0, collectiveDeg: 0, headspeedRpm: 0, motorPower: 0,
    altitude: 0, groundSpeed: 0, verticalSpeed: 0, groundEffect: 1, lambda: 0,
  };

  constructor(public model: HeliModel, public wind: Wind) {
    this.state = initialState(model);
  }

  reset(model = this.model): void {
    this.model = model;
    this.state = initialState(model);
  }

  step(ctl: ControlFrame, dt = PHYSICS_DT): void {
    const m = this.model;
    const s = this.state;
    const c = m.controller;
    s.time += dt;

    // ---------- Pilot commands -> controller -> servos ----------
    const mode = ctl.flightMode;
    const collectiveCmd = pitchFromCurve(m.pitchCurves[mode], ctl.collective);

    // Body rates expressed as pilot-intuitive rates.
    const pitchUpRate = s.omega.x;
    const rollRightRate = -s.omega.z;
    const yawRightRate = -s.omega.y;

    const rotorAlive = s.rotorOmega > 0.3 * m.headspeeds[1];
    let cycPitchCmd: number;
    let cycRollCmd: number;
    if (c.type === 'fbl' || this.assist === 'attitude') {
      // Electronic 3-axis stabiliser, rate mode: stick commands a rate, PI + feed-forward tracks it.
      let pitchDes = -ctl.elevator * c.cyclicRate; // stick forward = nose down
      let rollDes = ctl.aileron * c.cyclicRate;
      if (this.assist === 'attitude') {
        // Outer loop: stick -> target attitude, attitude error -> rate command for the inner loop.
        const e = eulerFromQ(s.ori);
        const pitchTarget = -ctl.elevator * this.attitudeMaxAngle;
        const rollTarget = ctl.aileron * this.attitudeMaxAngle;
        pitchDes = clamp((pitchTarget - e.pitch) * this.attitudeGain, -c.cyclicRate, c.cyclicRate);
        rollDes = clamp((rollTarget - e.roll) * this.attitudeGain, -c.cyclicRate, c.cyclicRate);
      }
      // Steady-state cyclic needed for a given rate on a teetering/flapping rotor: rate * 16/(gamma*Omega).
      const ff = rotorAlive ? 16 / (m.lockNumber * Math.max(s.rotorOmega, 50)) : 0;
      const ePitch = pitchDes - pitchUpRate;
      const eRoll = rollDes - rollRightRate;
      if (rotorAlive && !s.onGround) {
        s.iPitch = clamp(s.iPitch + ePitch * c.cyclicI * dt, -0.06, 0.06);
        s.iRoll = clamp(s.iRoll + eRoll * c.cyclicI * dt, -0.06, 0.06);
      } else {
        s.iPitch *= 1 - dt * 5;
        s.iRoll *= 1 - dt * 5;
      }
      cycPitchCmd = pitchDes * ff + ePitch * c.cyclicP + s.iPitch;
      cycRollCmd = rollDes * ff + eRoll * c.cyclicP + s.iRoll;
    } else {
      // Mechanical flybar (Bell-Hiller). Paddles are a gyroscope that follows the swashplate with a lag
      // and lags behind body rotation, which is where the flybar's damping comes from.
      const stickPitch = -ctl.elevator * m.maxCyclic;
      const stickRoll = ctl.aileron * m.maxCyclic;
      s.fbA += ((stickPitch - s.fbA) / c.flybarTau - pitchUpRate) * dt;
      s.fbB += ((stickRoll - s.fbB) / c.flybarTau - rollRightRate) * dt;
      s.fbA = clamp(s.fbA, -0.35, 0.35);
      s.fbB = clamp(s.fbB, -0.35, 0.35);
      cycPitchCmd = c.flybarBellRatio * stickPitch + (1 - c.flybarBellRatio) * s.fbA;
      cycRollCmd = c.flybarBellRatio * stickRoll + (1 - c.flybarBellRatio) * s.fbB;
    }
    cycPitchCmd = clamp(cycPitchCmd, -m.maxCyclic, m.maxCyclic);
    cycRollCmd = clamp(cycRollCmd, -m.maxCyclic, m.maxCyclic);

    // Heading-hold tail gyro: rudder commands a yaw rate; PI holds it against rotor torque changes.
    const yawDes = ctl.rudder * c.yawRate;
    const eYaw = yawDes - yawRightRate;
    // Heading-hold gyros integrate on the ground too; that is what keeps a spooled-up heli from pirouetting on its skids.
    if (rotorAlive) s.iYaw = clamp(s.iYaw + eYaw * c.yawI * dt, -0.5, 0.5);
    else s.iYaw *= 1 - dt * 3;
    let tailCmd = eYaw * c.yawP + s.iYaw + ctl.rudder * 0.25;
    tailCmd = clamp(tailCmd, -m.maxTailPitch, m.maxTailPitch);

    // Servo lag.
    const sv = clamp(dt / c.servoTau, 0, 1);
    s.servoCollective += (collectiveCmd - s.servoCollective) * sv;
    s.servoCycPitch += (cycPitchCmd - s.servoCycPitch) * sv;
    s.servoCycRoll += (cycRollCmd - s.servoCycRoll) * sv;
    s.servoTail += (tailCmd - s.servoTail) * sv;

    // ---------- Governor / motor ----------
    let targetOmega = 0;
    if (!ctl.throttleHold && !s.crashed) {
      const full = m.headspeeds[mode];
      // Normal mode throttle curve: spools down at the bottom of the stick so you can land and shut down.
      targetOmega = mode === 0 ? full * clamp((ctl.collective + 1) / 0.5, 0, 1) : full;
    }
    const ramp = m.spoolRate * dt;
    s.governorTarget += clamp(targetOmega - s.governorTarget, -ramp * 3, ramp);
    let motorTorque = 0;
    if (s.governorTarget > 1) {
      const kGov = m.maxMotorTorque / 30; // N m per rad/s of error
      const err = s.governorTarget - s.rotorOmega;
      // Integral term removes droop once the rotor is near target (ESC governors do the same).
      if (Math.abs(err) < 0.1 * s.governorTarget) s.governorI = clamp(s.governorI + err * kGov * 2 * dt, 0, m.maxMotorTorque * 0.6);
      motorTorque = clamp(err * kGov + s.governorI + main.torque * 0.9, 0, m.maxMotorTorque);
    } else {
      s.governorI = 0;
    }

    // ---------- Airflow ----------
    const windW = this.wind.at(s.pos, s.time);
    const vAirW = sub(s.vel, windW);
    const vAirB = rotateInv(s.ori, vAirW); // air velocity of the heli relative to air mass, body frame

    // ---------- Main rotor ----------
    const a1 = s.a1;
    const b1 = s.b1;
    const n = norm(v3(b1, 1, a1)); // thrust axis in body frame
    const hubVelB = add(vAirB, cross(s.omega, m.hubOffset));
    const vAlong = dot(hubVelB, n);
    const vPlaneVec = sub(hubVelB, scale(n, vAlong));
    const vPlane = len(vPlaneVec);
    solveRotor(m.rotor, s.servoCollective, vAlong, vPlane, s.rotorOmega, main);

    // Ground effect (Cheeseman-Bennett) on thrust.
    const hubW = add(s.pos, rotate(s.ori, m.hubOffset));
    const zh = Math.max(hubW.y, 0.25 * m.rotor.radius);
    const ratio = m.rotor.radius / (4 * zh);
    const ge = clamp(1 / (1 - ratio * ratio), 1, 1.25);
    const thrust = main.thrust * ge;

    const spin = m.clockwise ? 1 : -1;
    let force = scale(n, thrust);
    // In-plane rotor drag (H-force).
    if (vPlane > 1e-3) force = add(force, scale(vPlaneVec, -main.hForce / vPlane));
    let moment = cross(m.hubOffset, force);
    // Hub spring moment from TPP tilt.
    moment = add(moment, v3(m.hubStiffness * a1, 0, -m.hubStiffness * b1));
    // Torque reaction on the fuselage (clockwise rotor pushes the nose left = +y).
    moment = add(moment, v3(0, spin * main.torque, 0));

    // Flapping dynamics: first-order TPP response plus flap-back with airspeed.
    const tip = Math.max(s.rotorOmega * m.rotor.radius, 1);
    const muFwd = -vPlaneVec.z / tip; // forward airspeed is -z
    const muRight = vPlaneVec.x / tip;
    const flapGain = (4 / 3) * s.servoCollective - main.lambda;
    const a1Speed = 2 * muFwd * flapGain; // disc flaps back when flying forward
    const b1Speed = -2 * muRight * flapGain;
    const tauF = rotorAlive ? 16 / (m.lockNumber * s.rotorOmega) : 0.5;
    const kf = clamp(dt / tauF, 0, 1);
    s.a1 += (s.servoCycPitch + a1Speed - s.a1) * kf - pitchUpRate * dt;
    s.b1 += (s.servoCycRoll + b1Speed - s.b1) * kf - rollRightRate * dt;
    s.a1 = clamp(s.a1, -0.4, 0.4);
    s.b1 = clamp(s.b1, -0.4, 0.4);

    // ---------- Tail rotor ----------
    const tailVelB = add(vAirB, cross(s.omega, m.tailOffset));
    // Tail thrust positive = pushes tail to the left (-x) = nose right.
    const tailAlong = -tailVelB.x; // velocity along thrust direction
    const tailPlane = Math.hypot(tailVelB.y, tailVelB.z);
    solveRotor(m.tail, s.servoTail, tailAlong, tailPlane, s.rotorOmega * m.tailGearRatio, tail);
    const tailForce = v3(-tail.thrust, 0, 0);
    force = add(force, tailForce);
    moment = add(moment, cross(m.tailOffset, tailForce));

    // ---------- Fuselage aerodynamics ----------
    const dynP = 0.5 * RHO;
    const drag = v3(
      -dynP * m.dragArea.x * Math.abs(vAirB.x) * vAirB.x,
      -dynP * m.dragArea.y * Math.abs(vAirB.y) * vAirB.y,
      -dynP * m.dragArea.z * Math.abs(vAirB.z) * vAirB.z,
    );
    force = add(force, drag);
    // Rotor downwash loads the fuselage/stab (vertical drag) — part of why hover needs extra power.
    force = add(force, scale(n, -dynP * m.dragArea.y * 0.5 * main.vi * Math.abs(main.vi)));
    // Vertical fin and horizontal stabiliser: weathervane moments proportional to sideslip/angle of attack at the tail.
    const vTailW2 = tailVelB.x * tailVelB.x + tailVelB.y * tailVelB.y + tailVelB.z * tailVelB.z;
    if (vTailW2 > 0.5) {
      const vt = Math.sqrt(vTailW2);
      const finForce = v3(-dynP * m.finArea * 2.5 * tailVelB.x * vt, -dynP * m.stabArea * 2.5 * tailVelB.y * vt, 0);
      force = add(force, finForce);
      moment = add(moment, cross(m.tailOffset, finForce));
    }

    // ---------- Gravity ----------
    const gravB = rotateInv(s.ori, v3(0, -m.mass * G, 0));
    force = add(force, gravB);

    // ---------- Ground contacts ----------
    let onGround = false;
    const kN = (m.mass * G) / 0.004;
    const cN = 2 * Math.sqrt(kN * m.mass) * 0.6;
    for (const cp of m.contacts) {
      const rW = rotate(s.ori, cp.p);
      const pW = add(s.pos, rW);
      if (pW.y >= 0) continue;
      const vPointW = add(s.vel, cross(rotate(s.ori, s.omega), rW));
      if (cp.kind === 'hard' && !s.crashed && (len(vPointW) > 2.5 || rotorAlive)) {
        this.crash(cp.p.y > 0.05 ? 'Rotor head hit the ground' : 'Hard contact with the ground');
      }
      onGround = true;
      const pen = -pW.y;
      const fn = Math.max(0, kN * pen - cN * vPointW.y);
      const vt = v3(vPointW.x, 0, vPointW.z);
      const vtl = len(vt);
      const muF = cp.kind === 'skid' ? 0.45 : 0.7;
      const ft = vtl > 1e-4 ? scale(vt, -Math.min(muF * fn, vtl * 40 * m.mass) / vtl) : v3();
      const fW = add(v3(0, fn, 0), ft);
      const fB = rotateInv(s.ori, fW);
      force = add(force, fB);
      moment = add(moment, cross(cp.p, fB));
    }
    s.onGround = onGround;

    // Blade strike: lowest point of the rotor disc edge below ground while the rotor is spinning.
    if (rotorAlive && !s.crashed) {
      const nW = rotate(s.ori, n);
      const tiltSin = Math.sqrt(Math.max(0, 1 - nW.y * nW.y));
      const discLow = hubW.y - m.rotor.radius * tiltSin;
      if (discLow < 0.0) this.crash('Blade strike');
    }

    // ---------- Rotor speed dynamics ----------
    const tailShaftTorque = (tail.torque * m.tailGearRatio) / 1.0;
    const friction = 0.002 * s.rotorOmega;
    let domega = (motorTorque - main.torque - tailShaftTorque - friction) / m.rotorInertia;
    if (s.crashed) domega = -s.rotorOmega * 4;
    s.rotorOmega = Math.max(0, s.rotorOmega + domega * dt);

    // ---------- Integrate rigid body (semi-implicit Euler) ----------
    const I = m.inertia;
    const Iw = v3(I.x * s.omega.x, I.y * s.omega.y, I.z * s.omega.z);
    const gyro = cross(s.omega, Iw);
    const alpha = v3((moment.x - gyro.x) / I.x, (moment.y - gyro.y) / I.y, (moment.z - gyro.z) / I.z);
    s.omega = add(s.omega, scale(alpha, dt));
    // Mild rotational damping on the ground so a resting heli settles instead of jittering.
    if (onGround) s.omega = scale(s.omega, 1 - dt * 2.5);
    s.ori = qIntegrate(s.ori, s.omega, dt);

    const accW = scale(rotate(s.ori, force), 1 / m.mass);
    s.vel = add(s.vel, scale(accW, dt));
    s.pos = add(s.pos, scale(s.vel, dt));

    // ---------- Telemetry ----------
    const t = this.telemetry;
    t.thrust = thrust;
    t.torque = main.torque;
    t.tailThrust = tail.thrust;
    t.collectiveDeg = (s.servoCollective * 180) / Math.PI;
    t.headspeedRpm = (s.rotorOmega * 60) / (2 * Math.PI);
    t.motorPower = motorTorque * s.rotorOmega;
    t.altitude = s.pos.y;
    t.groundSpeed = Math.hypot(s.vel.x, s.vel.z);
    t.verticalSpeed = s.vel.y;
    t.groundEffect = ge;
    t.lambda = main.lambda;
  }

  private crash(reason: string): void {
    const s = this.state;
    s.crashed = true;
    s.crashReason = reason;
  }
}
