import { add, clamp, cross, dot, eulerFromQ, len, norm, qIntegrate, rotate, rotateInv, scale, sub, v3, type Q, type V3, q as mkq } from './math';
import { pitchFromCurve, type HeliModel } from './heli-model';
import { emptyRotorResult, solveRotor, RHO } from './rotor';
import type { ControlFrame } from '../input/types';
import type { Wind } from './wind';
import { World, emptyHit, type LandingTarget } from './world';

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
  /** Energy left in the pack, Wh. */
  batteryWh: number;
  crashed: boolean;
  crashReason: string;
  /** Landing-target bookkeeping: which target every skid rests on, for how long, and the last confirmed landing. */
  restingOn: string | null;
  restingTime: number;
  landed: { target: LandingTarget; offset: number } | null;
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
  /** 0..1 battery left. */
  battery: number;
  /** Vortex ring state depth 0..1 and blade stall 0..1 (warnings on the HUD). */
  vrs: number;
  stall: number;
  /** Seconds the motor has been drawing power this flight. */
  flightSeconds: number;
  /** Load factor along the rotor axis (1 = hover, 0 = free fall, negative = inverted pulling). */
  gLoad: number;
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
    batteryWh: model.batteryWh,
    crashed: false,
    crashReason: '',
    restingOn: null,
    restingTime: 0,
    landed: null,
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
  private vrsNoise = 0;
  private vrsNoise2 = 0;
  private boomTimer = 0;
  /** Last control frame fed to step(); challenges read switch states from it. */
  lastControls: ControlFrame | null = null;
  /** Max bank/pitch angle at full stick in attitude mode, rad. */
  attitudeMaxAngle = (35 * Math.PI) / 180;
  /** Outer-loop gain: rate commanded per radian of attitude error, 1/s. */
  attitudeGain = 7;
  telemetry: Telemetry = {
    thrust: 0, torque: 0, tailThrust: 0, collectiveDeg: 0, headspeedRpm: 0, motorPower: 0,
    altitude: 0, groundSpeed: 0, verticalSpeed: 0, groundEffect: 1, lambda: 0, battery: 1, vrs: 0, stall: 0, flightSeconds: 0, gLoad: 1,
  };

  constructor(public model: HeliModel, public wind: Wind, public world: World = new World()) {
    this.state = initialState(model);
  }

  reset(model = this.model): void {
    this.model = model;
    this.state = initialState(model);
    this.telemetry.flightSeconds = 0;
  }

  step(ctl: ControlFrame, dt = PHYSICS_DT): void {
    const m = this.model;
    const s = this.state;
    const c = m.controller;
    this.lastControls = ctl;
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
    // Battery: voltage sags as the pack empties, so the motor's torque ceiling (and the governor's headroom)
    // shrinks. Under 10% a hard-worked rotor bogs; at 0% the motor quits and you are in an autorotation.
    const soc = clamp(s.batteryWh / m.batteryWh, 0, 1);
    const voltageFactor = soc <= 0 ? 0 : 0.85 + 0.15 * Math.min(1, soc / 0.3) - (soc < 0.1 ? (0.1 - soc) * 3 : 0);
    const torqueCeiling = m.maxMotorTorque * Math.max(0, voltageFactor);
    if (s.governorTarget > 1 && torqueCeiling > 0) {
      const kGov = m.maxMotorTorque / 30; // N m per rad/s of error
      const err = s.governorTarget - s.rotorOmega;
      // Integral term removes droop once the rotor is near target (ESC governors do the same).
      if (Math.abs(err) < 0.1 * s.governorTarget) s.governorI = clamp(s.governorI + err * kGov * 2 * dt, 0, m.maxMotorTorque * 0.6);
      motorTorque = clamp(err * kGov + s.governorI + main.torque * 0.9, 0, torqueCeiling);
    } else {
      s.governorI = 0;
    }
    // Energy drawn (motor + ESC losses ~ 85% efficient).
    const electricalW = (motorTorque * s.rotorOmega) / 0.85;
    s.batteryWh = Math.max(0, s.batteryWh - (electricalW * dt) / 3600);

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
    // Ground effect fades with forward speed (the cushion is blown behind the rotor above ~mu 0.1).
    const geSpeed = clamp(1 - main.mu / 0.12, 0, 1);
    const ge = 1 + (clamp(1 / (1 - ratio * ratio), 1, 1.25) - 1) * geSpeed;
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
    // Vortex ring state is rough: the disc sheds asymmetric lift, felt as random pitch/roll kicks.
    if (main.vrs > 0.05) {
      const kick = main.vrs * m.hubStiffness * 0.15;
      this.vrsNoise = this.vrsNoise * 0.98 + (Math.random() - 0.5) * 0.4;
      this.vrsNoise2 = this.vrsNoise2 * 0.98 + (Math.random() - 0.5) * 0.4;
      moment = add(moment, v3(kick * this.vrsNoise, 0, kick * this.vrsNoise2));
    }

    // Flapping dynamics: first-order TPP response plus flap-back with airspeed.
    const tip = Math.max(s.rotorOmega * m.rotor.radius, 1);
    const muFwd = -vPlaneVec.z / tip; // forward airspeed is -z
    const muRight = vPlaneVec.x / tip;
    const flapGain = (4 / 3) * s.servoCollective - clamp(main.lambda, -0.5, 0.5);
    // Flap-back with airspeed only exists with a turning rotor.
    const a1Speed = rotorAlive ? 2 * muFwd * flapGain : 0; // disc flaps back when flying forward
    const b1Speed = rotorAlive ? -2 * muRight * flapGain : 0;
    const tauF = rotorAlive ? 16 / (m.lockNumber * s.rotorOmega) : 0.5;
    const kf = clamp(dt / tauF, 0, 1);
    s.a1 += (s.servoCycPitch + a1Speed - s.a1) * kf - pitchUpRate * dt;
    s.b1 += (s.servoCycRoll + b1Speed - s.b1) * kf - rollRightRate * dt;
    s.a1 = clamp(s.a1, -0.4, 0.4);
    s.b1 = clamp(s.b1, -0.4, 0.4);
    // Boom strike: the blades flap far enough to hit the tail boom. Happens when big cyclic is demanded while the
    // disc is unloaded (negative G / low head speed): the hub cannot hold the disc and it over-flaps.
    // Boom strike. A flybar head has little hub stiffness: pushed to negative G with a big cyclic demand the
    // blades flap past the boom. Rigid flybarless heads do not do this. (The flapping model itself is bounded by
    // the cyclic range, so this is a rule on the real-world trigger rather than an emergent effect.)
    if (rotorAlive && !s.crashed && c.type === 'flybar') {
      const negativeG = thrust < -0.2 * m.mass * G;
      const bigCyclic = Math.hypot(ctl.aileron, ctl.elevator) > 0.7;
      this.boomTimer = negativeG && bigCyclic ? this.boomTimer + dt : 0;
      if (this.boomTimer > 0.15) this.crash('Boom strike: big cyclic at negative G on a flybar head');
    } else this.boomTimer = 0;

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

    // ---------- Contacts: ground plane and world objects ----------
    let onGround = false;
    const kN = (m.mass * G) / 0.004;
    const cN = 2 * Math.sqrt(kN * m.mass) * 0.6;
    const hit = emptyHit();
    let skidsOnTarget: string | null | undefined; // undefined = no skid touching anything yet
    let skidsTouching = 0;
    for (const cp of m.contacts) {
      const rW = rotate(s.ori, cp.p);
      const pW = add(s.pos, rW);
      let normal: V3;
      let pen: number;
      let what = 'the ground';
      let targetId: string | null = null;
      if (pW.y < 0) {
        normal = v3(0, 1, 0);
        pen = -pW.y;
      } else if (this.world.hit(pW, hit)) {
        normal = hit.normal;
        pen = hit.depth;
        what = hit.collider.name;
        targetId = hit.collider.target?.id ?? null;
      } else continue;
      const vPointW = add(s.vel, cross(rotate(s.ori, s.omega), rW));
      const vn = dot(vPointW, normal);
      if (cp.kind === 'hard' && !s.crashed && (len(vPointW) > 2.5 || rotorAlive)) {
        this.crash(cp.p.y > 0.05 ? `Rotor head hit ${what}` : `Hard contact with ${what}`);
      }
      // Side hits on objects at speed break things too (a skid into a wall).
      if (cp.kind === 'skid' && normal.y < 0.5 && !s.crashed && len(vPointW) > 3) this.crash(`Hit ${what}`);
      onGround = true;
      if (cp.kind === 'skid' && normal.y > 0.5) {
        skidsTouching++;
        skidsOnTarget = skidsOnTarget === undefined ? targetId : skidsOnTarget === targetId ? targetId : null;
      }
      const fn = Math.max(0, kN * pen - cN * vn);
      const vt = sub(vPointW, scale(normal, vn));
      const vtl = len(vt);
      const muF = cp.kind === 'skid' ? 0.45 : 0.7;
      const ft = vtl > 1e-4 ? scale(vt, -Math.min(muF * fn, vtl * 40 * m.mass) / vtl) : v3();
      const fW = add(scale(normal, fn), ft);
      const fB = rotateInv(s.ori, fW);
      force = add(force, fB);
      moment = add(moment, cross(cp.p, fB));
    }
    s.onGround = onGround;

    // Landing-target detection: every skid on the same target, barely moving, for a moment.
    const skidCount = m.contacts.filter((c) => c.kind === 'skid').length;
    // The helipad is ground, not a collider: skids on plain ground near the H count as the 'pad' target.
    if (skidsTouching === skidCount && skidsOnTarget === null && this.world.pad && Math.hypot(s.pos.x - this.world.pad.centre.x, s.pos.z - this.world.pad.centre.z) < 2.2) {
      skidsOnTarget = this.world.pad.id;
    }
    if (skidsTouching === skidCount && skidsOnTarget && len(s.vel) < 0.25 && !s.crashed) {
      if (s.restingOn !== skidsOnTarget) { s.restingOn = skidsOnTarget; s.restingTime = 0; }
      s.restingTime += dt;
      if (s.restingTime > 1.5 && !s.landed) {
        const target = skidsOnTarget === this.world.pad?.id ? this.world.pad : this.world.targets.find((t) => t.id === skidsOnTarget)!;
        s.landed = { target, offset: Math.hypot(s.pos.x - target.centre.x, s.pos.z - target.centre.z) };
      }
    } else {
      s.restingOn = null;
      s.restingTime = 0;
      if (!onGround) s.landed = null;
    }

    // Blade strike: the rotor disc edge touching the ground or any object while the rotor is spinning.
    if (rotorAlive && !s.crashed) {
      const nW = rotate(s.ori, n);
      const tiltSin = Math.sqrt(Math.max(0, 1 - nW.y * nW.y));
      const discLow = hubW.y - m.rotor.radius * tiltSin;
      if (discLow < 0.0) this.crash('Blade strike');
      else if (this.world.colliders.length > 0) {
        // Sample the disc edge. Two in-plane axes perpendicular to the rotor normal.
        const ax = norm(cross(nW, Math.abs(nW.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0)));
        const az = cross(nW, ax);
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const pt = add(hubW, add(scale(ax, Math.cos(a) * m.rotor.radius), scale(az, Math.sin(a) * m.rotor.radius)));
          if (this.world.hit(pt, hit)) {
            this.crash(`Blades hit ${hit.collider.name}`);
            break;
          }
        }
      }
    }

    // ---------- Rotor speed dynamics ----------
    const tailShaftTorque = (tail.torque * m.tailGearRatio) / 1.0;
    // Drivetrain friction, scaled with the motor so a micro is not eaten by a 450's bearings.
    const friction = 0.0007 * (m.maxMotorTorque / 2.4) * s.rotorOmega;
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
    t.battery = soc;
    t.gLoad = thrust / (m.mass * G);
    t.vrs = rotorAlive ? main.vrs : 0;
    t.stall = rotorAlive ? main.stall : 0;
    if (motorTorque > 0.05) t.flightSeconds += dt;
  }

  private crash(reason: string): void {
    const s = this.state;
    s.crashed = true;
    s.crashReason = reason;
  }
}
