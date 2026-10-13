/**
 * The parts of an RC helicopter, as hobbyists name them. The Hangar view highlights each one on the 3D model and
 * shows this text: what the part does, how it usually fails, and what to know when you buy a replacement.
 * Pure data (no three.js) so it can be tested and reused by the UI.
 */
export type PartGroup = 'rotor' | 'controls' | 'drive' | 'electronics' | 'tail' | 'airframe';

export const PART_GROUPS: { id: PartGroup; name: string }[] = [
  { id: 'rotor', name: 'Main rotor head' },
  { id: 'controls', name: 'Swashplate and servos' },
  { id: 'drive', name: 'Drive train' },
  { id: 'electronics', name: 'Electronics and power' },
  { id: 'tail', name: 'Tail rotor' },
  { id: 'airframe', name: 'Airframe' },
];

/** Which helicopters have the part: a flybar head, a flybarless (FBL) head, or both. */
export type HeadType = 'flybar' | 'fbl';
export type PowerType = 'electric' | 'nitro';

export interface PartInfo {
  id: string;
  group: PartGroup;
  name: string;
  /** Other names you will see in manuals and shops. */
  aka?: string;
  only?: HeadType;
  /** Only on electric or only on nitro helicopters. */
  power?: PowerType;
  /** Only shown when the training gear is fitted. */
  gearOnly?: boolean;
  /** What it does. */
  what: string;
  /** How it usually gets damaged. */
  breaks?: string;
  /** Setup / replacement advice. */
  tip?: string;
  /** Per-head-type overrides (the flybar trainer and the FBL machines differ in a few places). */
  variants?: Partial<Record<HeadType | PowerType, Partial<Pick<PartInfo, 'name' | 'aka' | 'what' | 'breaks' | 'tip'>>>>;
}

export const PARTS: PartInfo[] = [
  // ---------------------------------------------------------------- rotor head
  {
    id: 'main-blades', group: 'rotor', name: 'Main rotor blades', aka: 'main blades (325 mm on a 450, 690 mm on a 700)',
    what: 'Make the lift. Their angle (pitch) changes with collective and cyclic: watch the grips twist in this view as you move the sticks. Carbon fibre or fibreglass, sold as weight- and balance-matched pairs.',
    breaks: 'The first thing to go in any crash with the rotor turning: cracked roots, delamination, broken tips. Never fly a cracked blade: at 2,500+ rpm a piece leaves at over 300 km/h.',
    tip: 'Always buy matched pairs. The coloured tip tape is for tracking: spin up and look at the disc edge-on, the two colours must run in one plane (here they blend into one ring).',
  },
  {
    id: 'blade-grips', group: 'rotor', name: 'Blade grips', aka: 'blade holders, main grips',
    what: 'Clamp the blades and turn on the feathering shaft (on radial and thrust bearings) so the blade pitch can change. The arm on each grip is where the pitch link pulls.',
    breaks: 'Cracked grips and bent pitch arms in crashes; worn thrust bearings feel notchy and cause vibration.',
    tip: 'Re-grease the thrust bearings when you rebuild the head and keep the stacking order (washer, race, cage, race).',
  },
  {
    id: 'blade-bolts', group: 'rotor', name: 'Blade bolts', aka: 'blade screws and lock nuts',
    what: 'Hold each blade in its grip. Tight enough that the blade does not flop, free enough that it can swing straight under centrifugal force.',
    breaks: 'Bend or shear in a blade strike.',
    tip: 'Check blade tightness before each flying day: held level, the blade should stay put but move with a light push.',
  },
  {
    id: 'spindle', group: 'rotor', name: 'Feathering shaft', aka: 'spindle, with the head dampers (O-rings)',
    what: 'The steel shaft through the head block that the two grips turn on to change pitch. It sits in rubber dampers that let the rotor disc flap a little.',
    breaks: 'The classic crash part: it bends in almost every blade strike, and a bent spindle shakes the whole helicopter.',
    tip: 'Roll it on a sheet of glass: any wobble, replace it. Replace the dampers too when the head feels sloppy.',
  },
  {
    id: 'head-block', group: 'rotor', name: 'Head block', aka: 'centre hub, main rotor housing',
    what: 'Bolted to the top of the main shaft. Carries the feathering shaft and dampers and turns the rotor with the shaft.',
    breaks: 'Rarely; the shaft bolt can shear or the block crack in a big crash.',
    tip: 'Thread-lock metal-to-metal screws only. Thread-lock on plastic parts cracks them.',
  },
  {
    id: 'head-links', group: 'rotor', name: 'Pitch links', aka: 'head linkage rods, swash-to-grip links',
    what: 'Short rods with ball links that carry the swashplate movement up to the grip pitch arms. Their length sets zero pitch and blade tracking.',
    breaks: 'Ball links pop off or crack; rods bend.',
    tip: 'Fix tracking by turning one link half a turn at a time. Ball links must snap on firmly with no play.',
    variants: { flybar: { what: 'Rods with ball links from the swashplate up through the washout and the mixing arms to the grips (and to the flybar seesaw). Their lengths set zero pitch and tracking.' } },
  },
  {
    id: 'flybar', group: 'rotor', name: 'Flybar', aka: 'flybar rod', only: 'flybar',
    what: 'The steel rod across the head at 90° to the blades. With its paddles it is a gyroscope: it resists sudden tilts (damping the helicopter) and feeds cyclic into the blades through the Hiller mixing. That is why a flybar trainer feels calmer than a flybarless machine.',
    breaks: 'Bends in crashes. Check it on glass like the spindle.',
    tip: 'Both ends must stick out exactly the same length or the head vibrates.',
  },
  {
    id: 'flybar-paddles', group: 'rotor', name: 'Flybar paddles', only: 'flybar',
    what: 'Small aerofoils on the flybar ends. Their weight and position set how strongly the flybar stabilises: heavier or further out is more stable and slower.',
    breaks: 'Crack or fly off in crashes.',
    tip: 'Set both parallel to the seesaw and at the same distance from the centre.',
  },
  {
    id: 'flybar-seesaw', group: 'rotor', name: 'Flybar control frame', aka: 'flybar seesaw', only: 'flybar',
    what: 'Holds the flybar and lets it teeter. The swashplate tilts it through control links; the flybar then works the blades through the mixing arms.',
  },
  {
    id: 'mixing-arms', group: 'rotor', name: 'Bell-Hiller mixing arms', aka: 'mixer arms, mixing levers', only: 'flybar',
    what: 'Levers that add two inputs on each blade: the direct (Bell) input from the swashplate and the delayed (Hiller) input from the flybar. Their ratio sets how direct the cyclic feels.',
    breaks: 'Break in crashes; their bushings wear and add slop.',
    tip: 'Set them level at mid stick during head setup.',
  },
  {
    id: 'washout', group: 'rotor', name: 'Washout assembly', aka: 'washout base and arms', only: 'flybar',
    what: 'Rides on the main shaft above the swashplate and turns with the head. It moves up and down with collective and passes it to the mixing arms.',
    breaks: 'Wear gives vague collective and slop in the hover.',
    tip: 'It must slide freely on the shaft with no side play.',
  },
  // ---------------------------------------------------------------- swashplate and servos
  {
    id: 'swashplate', group: 'controls', name: 'Swashplate',
    what: 'Two rings on a bearing. The lower ring does not turn and is pushed by the servos; the upper ring turns with the head. Up and down = collective (both blades change pitch together). Tilt = cyclic (pitch changes around the turn, so the disc tilts and the helicopter moves). Move your sticks in this view and watch it.',
    breaks: 'Balls and links break in crashes; a worn swash bearing gives play.',
    tip: 'Level it at mid stick with a swash leveller during setup. In 120° CCPM all three servos move it together.',
  },
  {
    id: 'anti-rotation', group: 'controls', name: 'Anti-rotation guide', aka: 'swash anti-rotation bracket',
    what: 'Stops the lower swashplate ring from turning with the shaft while still letting it slide and tilt.',
  },
  {
    id: 'servo-pushrods', group: 'controls', name: 'Servo pushrods', aka: 'servo links',
    what: 'Connect each cyclic servo arm to the lower swashplate ring.',
    tip: 'With the servos centred, set the lengths so the swashplate is level and every servo arm is at 90° to its rod.',
  },
  {
    id: 'cyclic-servos', group: 'controls', name: 'Cyclic servos (×3)', aka: 'swash servos: aileron, elevator, pitch',
    what: 'In 120° CCPM the three servos move the swashplate together: all up for collective, differently for tilt. The radio (or the flybarless unit) does the mixing.',
    breaks: 'Stripped gears after a crash (the servo buzzes or the arm wobbles), burned motors.',
    tip: 'Use metal-gear digital servos on the cyclic. After a crash, with power off, gently move each arm: grinding means stripped teeth.',
  },
  {
    id: 'tail-servo', group: 'controls', name: 'Tail servo', aka: 'rudder servo',
    what: 'Moves the tail pitch slider through the tail control rod. It is driven by the gyro, not directly by your rudder stick.',
    tip: 'Use a fast tail servo and set the gyro to the right pulse type (for example 760 µs narrow-pulse), or the servo can burn out.',
  },
  {
    id: 'tail-rod', group: 'controls', name: 'Tail control rod and guides', aka: 'tail pushrod',
    what: 'The long thin rod along the boom from the tail servo to the tail pitch lever. Rod guides stop it from bowing.',
    tip: 'It must move freely end to end: any binding makes the tail wag.',
  },
  // ---------------------------------------------------------------- drive train
  {
    id: 'main-shaft', group: 'drive', name: 'Main shaft',
    what: 'Carries the rotor head on top and the main gear below, turning in two bearing blocks.',
    breaks: 'Bends in hard crashes; the head then wobbles as it spools up.',
    tip: 'Turn the head slowly by hand and watch the top of the shaft for wobble.',
  },
  {
    id: 'bearing-blocks', group: 'drive', name: 'Main shaft bearing blocks',
    what: 'Hold the main shaft bearings in the frame and keep the shaft vertical.',
    tip: 'Notchy or gritty bearings: replace them, they are cheap.',
  },
  {
    id: 'main-gear', group: 'drive', name: 'Main gear', aka: 'main drive gear, with one-way bearing',
    what: 'The big gear driven by the motor pinion. Inside it a one-way bearing lets the rotor keep turning when the motor stops: that is what makes autorotation possible (try Throttle hold in the sim).',
    breaks: 'Stripped teeth in crashes. It is meant to be the weak link that protects the rest.',
    tip: 'Set the gear mesh with a strip of paper between pinion and gear, then pull it out. Too tight wears and heats, too loose strips.',
  },
  {
    id: 'pinion', group: 'drive', name: 'Pinion gear', power: 'electric',
    what: 'The small gear on the motor shaft. Its tooth count against the main gear sets the gear ratio and so the head speed.',
    tip: 'A different pinion is how you change the head speed range. Thread-lock its grub screw.',
  },
  {
    id: 'motor', group: 'drive', name: 'Brushless motor', power: 'electric', aka: 'outrunner (the outer bell spins)',
    what: 'Turns the pinion. Unloaded rpm is roughly its kV rating times the voltage.',
    breaks: 'Bent shaft, damaged bearings or magnets from crashes; overheating.',
    tip: 'Too hot to touch after a flight means the gearing or the pitch is too high.',
  },
  {
    id: 'engine', group: 'drive', name: 'Glow engine', aka: 'nitro engine (.30 to .90 size)', power: 'nitro',
    what: 'A two-stroke engine running on glow fuel (methanol, nitromethane and oil). The finned head is cooled by the fan; the glow plug stays hot from the burning fuel once you remove the starter battery. The carburettor is driven by the throttle servo.',
    breaks: 'Overheats when run too lean; a bent crankshaft or broken cooling fan after a crash.',
    tip: 'Break it in rich and gently. If it dies when you pull collective it is too lean; if it smokes heavily and sounds soggy it is too rich (the needle in Model setup → Engine models this).',
  },
  {
    id: 'clutch', group: 'drive', name: 'Clutch, fan and pinion', aka: 'centrifugal clutch, clutch bell, cooling fan', power: 'nitro',
    what: 'Couples the engine to the pinion only above idle: at low throttle the shoes let go and the rotor freewheels, which is how you start the engine on the bench and how autorotation works on nitro. The fan blows air over the engine head.',
    breaks: 'Worn clutch shoes slip (head speed sags under load); clutch bell bearings wear.',
    tip: 'Check the clutch bell bearing every few gallons of fuel; replace the shoes if they glaze.',
  },
  {
    id: 'muffler', group: 'drive', name: 'Muffler', aka: 'tuned pipe on 3D machines', power: 'nitro',
    what: 'Quietens the exhaust and, on a tuned pipe, uses pressure waves to help the engine breathe at a set rpm. Pressure tapped from it feeds the fuel tank.',
    tip: 'Keep the mounting bolts thread-locked: vibration loosens them.',
  },
  {
    id: 'fuel-tank', group: 'electronics', name: 'Fuel tank', aka: 'with clunk and pressure line', power: 'nitro',
    what: 'Carries the glow fuel. A weighted clunk inside keeps the pickup in fuel whatever the attitude; the muffler pressurises the tank. On nitro the HUD battery reads fuel.',
    breaks: 'A cracked tank or split fuel line leaks and the engine leans out.',
    tip: 'Replace the fuel lines when they harden; land with fuel to spare, a lean dead-stick at the end of the tank is an autorotation.',
  },
  {
    id: 'throttle-servo', group: 'controls', name: 'Throttle servo', power: 'nitro',
    what: 'Opens the carburettor. The governor (or your throttle curve) drives it to hold head speed.',
    tip: 'Set the linkage so the carburettor fully closes at the bottom (to stop the engine) and fully opens at the top without binding.',
  },
  {
    id: 'tail-drive-gear', group: 'drive', name: 'Front tail drive',
    what: 'Under the main gear, it drives the tail. The tail is geared to the main rotor, so it keeps working in an autorotation.',
    variants: {
      flybar: { name: 'Front tail pulley', aka: 'tail drive pulley', what: 'The toothed pulley under the main gear that drives the tail belt. The tail is geared to the main rotor, so it keeps working in an autorotation.' },
      fbl: { name: 'Front tail drive gear', aka: 'autorotation tail drive gear', what: 'The gear under the main gear that turns the torque tube. The tail is geared to the main rotor, so it keeps working in an autorotation.' },
    },
  },
  {
    id: 'tail-drive', group: 'drive', name: 'Tail drive',
    what: 'Carries the drive down the boom to the tail gearbox.',
    variants: {
      flybar: {
        name: 'Tail drive belt', aka: 'tail belt',
        what: 'A toothed belt inside the boom from the front pulley to the tail. It twists 90° along the boom (you can see the twist here) and its twist direction sets which way the tail turns.',
        breaks: 'Stripped teeth or a snapped belt: the tail goes limp and the helicopter pirouettes.',
        tip: 'Tension: pressed through the boom slot it should give a few millimetres. Too loose skips teeth on hard stops.',
      },
      fbl: {
        name: 'Torque tube', aka: 'tail drive shaft',
        what: 'A thin shaft inside the boom, held by bearings, driving the tail through gears at each end. More direct than a belt.',
        breaks: 'The tail gears strip and the bearings fail after a boom strike.',
        tip: 'Check both tail drive gears after any tail strike.',
      },
    },
  },
  // ---------------------------------------------------------------- electronics
  {
    id: 'battery', group: 'electronics', name: 'LiPo battery', aka: '3S 2200 mAh on a 450, 12S 5000 mAh (2 × 6S) on a 700',
    what: 'Stores the energy. Its voltage sags as it empties, and the sim models that (watch the battery on the HUD).',
    breaks: 'Swollen or punctured packs after a crash are a fire risk: put them somewhere safe outdoors.',
    tip: 'Do not go below about 3.5 V per cell under load: land at 20-30% left. Store at 3.8 V per cell.',
    variants: {
      nitro: {
        name: 'Receiver battery', aka: 'NiMH or LiFe receiver pack',
        what: 'Powers the receiver, gyro and servos (the engine has its own fuel). If it goes flat everything stops, so it is the most important thing to check before a nitro flight.',
        breaks: 'Damaged cells or a loose plug after a crash.',
        tip: 'Check its voltage before every flight with a voltmeter, not only the charger.',
      },
    },
  },
  {
    id: 'esc', group: 'electronics', name: 'ESC (speed controller)', aka: 'with governor and BEC', power: 'electric',
    what: 'Drives the brushless motor from the battery. Heli ESCs have a governor that holds head speed whatever the load (the governor in this sim), and usually a BEC that powers the receiver and servos.',
    breaks: 'Overheats if it is too small; damaged by shorts.',
    tip: 'Mount it in the airflow and keep its wires clear of the gears.',
  },
  {
    id: 'receiver', group: 'electronics', name: 'Receiver', aka: 'Rx',
    what: 'Receives your transmitter and passes the channels to the gyro or flybarless unit and servos.',
    tip: 'Antennas at 90° to each other, away from carbon and metal. Set the failsafe to throttle off.',
  },
  {
    id: 'gyro', group: 'electronics', name: 'Gyro',
    what: 'Measures rotation rates and corrects them.',
    tip: 'Mount it with its pad on a stiff, vibration-free spot. Before the first flight, move the helicopter by hand and check every correction goes the right way.',
    variants: {
      flybar: { name: 'Tail gyro (heading hold)', what: 'Holds the tail. In heading-hold mode it measures the yaw rate and moves the tail servo to cancel any turn you did not command (the main rotor torque changes every time you move the collective).' },
      fbl: { name: 'Flybarless unit', aka: 'FBL controller, 3-axis gyro', what: 'A 3-axis gyro computer that replaces the flybar. It measures the rates and moves the servos so the helicopter does exactly what the sticks ask (rate mode), and holds the tail too. All modern 3D machines fly on these.' },
    },
  },
  // ---------------------------------------------------------------- tail
  {
    id: 'tail-case', group: 'tail', name: 'Tail gearbox', aka: 'tail case, tail housing',
    what: 'On the end of the boom. Turns the drive 90° to the tail output shaft and holds its bearings.',
  },
  {
    id: 'tail-shaft', group: 'tail', name: 'Tail output shaft',
    what: 'Carries the tail hub, turning in a bearing on each side of the case.',
    breaks: 'Bends in a tail strike.',
  },
  {
    id: 'tail-hub', group: 'tail', name: 'Tail hub and grips',
    what: 'Holds the tail blades and lets them change pitch together.',
    breaks: 'Grips crack in tail strikes.',
  },
  {
    id: 'tail-blades', group: 'tail', name: 'Tail rotor blades',
    what: 'Push the tail sideways to cancel the main rotor torque. More pitch, more push; with the gyro they also turn the helicopter (rudder).',
    breaks: 'Break in nearly every tail strike.',
    tip: 'Keep spares: they are cheap and the first thing to break when the tail touches the grass.',
  },
  {
    id: 'pitch-slider', group: 'tail', name: 'Tail pitch slider',
    what: 'Slides along the tail output shaft and changes the pitch of both tail blades at once.',
    breaks: 'Wears and gets loose: tail wag.',
    tip: 'It must slide freely without play; replace it if it rocks.',
  },
  {
    id: 'pitch-lever', group: 'tail', name: 'Tail pitch lever', aka: 'tail bellcrank',
    what: 'Turns the tail rod push and pull into the slider moving in and out.',
  },
  // ---------------------------------------------------------------- airframe
  {
    id: 'canopy', group: 'airframe', name: 'Canopy',
    what: 'The fibreglass or plastic shell over the front of the frame. Protects the electronics and helps you read the orientation from far away.',
    breaks: 'Cracks in crashes; the grommets tear.',
    tip: 'Bright colours on top and a dark underside make orientation much easier at a distance.',
  },
  {
    id: 'canopy-mounts', group: 'airframe', name: 'Canopy mounts', aka: 'canopy posts and grommets',
    what: 'Posts on the frame; the rubber grommets in the canopy press onto them.',
  },
  {
    id: 'frame', group: 'airframe', name: 'Main frame', aka: 'side frames and spacers',
    what: 'Two carbon side plates with spacers hold everything: bearing blocks, servos, motor mount and boom mount.',
    breaks: 'Cracks or delaminates in a hard crash.',
    tip: 'After a crash look for cracks around the bearing blocks and the motor mount.',
  },
  {
    id: 'skids', group: 'airframe', name: 'Landing skids', aka: 'skid pipes',
    what: 'The two tubes the helicopter stands on. The simulator\'s skid contact points sit exactly on them.',
    breaks: 'Bend in hard landings.',
    tip: 'A training gear (an X of rods with balls on the ends) saves a first helicopter from many tip-overs.',
  },
  {
    id: 'skid-struts', group: 'airframe', name: 'Landing gear struts', aka: 'skid struts, landing gear bows',
    what: 'Plastic bows between the frame and the skids. They flex to soak up a hard landing.',
    breaks: 'Crack in hard landings.',
  },
  {
    id: 'tail-boom', group: 'airframe', name: 'Tail boom',
    what: 'The aluminium or carbon tube that carries the tail. The tail drive runs inside it.',
    breaks: 'Bends or gets chopped by the blades in a crash: with the spindle and the main blades, the most replaced crash part.',
    tip: 'Check it is straight and not dented where the blades can strike it.',
  },
  {
    id: 'boom-supports', group: 'airframe', name: 'Tail boom supports', aka: 'boom struts',
    what: 'Two rods from the frame to the boom that stop it vibrating and flexing.',
  },
  {
    id: 'h-stab', group: 'airframe', name: 'Horizontal stabiliser', aka: 'horizontal fin',
    what: 'A small wing on the boom. In forward flight it keeps the nose from pitching up.',
  },
  {
    id: 'training-gear', group: 'airframe', name: 'Training gear', aka: 'training landing gear, "X" with balls', gearOnly: true,
    what: 'Four rods with balls almost out to the disc edge. They stop the helicopter from tipping over on take-off and landing, the most common first crash (dynamic rollover). In the sim they are real contact points.',
    tip: 'Take it off once you can hover nose-in steadily: it adds drag and weight and hides sloppy landings.',
  },
  {
    id: 'v-fin', group: 'airframe', name: 'Vertical fin',
    what: 'Keeps the helicopter pointing into the airflow in forward flight (weathervaning, which the sim models) and protects the tail rotor on landing.',
  },
];

/** The part text for one helicopter: variants applied, parts the model does not have removed. */
export function partsFor(head: HeadType, power: PowerType = 'electric', gear = false): PartInfo[] {
  return PARTS.filter((p) => (!p.only || p.only === head) && (!p.power || p.power === power) && (!p.gearOnly || gear)).map((p) => ({
    ...p,
    ...(p.variants?.[head] ?? {}),
    ...(p.variants?.[power] ?? {}),
  }));
}
