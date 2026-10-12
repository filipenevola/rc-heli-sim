import { BILLBOARDS } from '../sim/ads';
import { HELP_HTML_PT } from './help-pt';
import { getLang } from '../i18n';

/** In-game manual. Plain HTML so it works on every device and can be read while paused. */
export class HelpPanel {
  private el: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'help';
    this.el.style.display = 'none';
    this.build();
    container.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.key === '?' || e.code === 'F1') {
        e.preventDefault();
        this.toggle();
      }
      if (e.code === 'Escape' && this.el.style.display !== 'none') this.toggle();
    });
  }

  /** Re-render in the current language (English or Portuguese manual). */
  setLanguage(): void {
    this.build();
  }

  private build(): void {
    this.el.innerHTML = getLang() === 'pt-BR' ? HELP_HTML_PT : HELP_HTML;
    // Table of contents from the section headings, so the long manual is navigable on a phone.
    const heads = [...this.el.querySelectorAll('h4')];
    heads.forEach((h, i) => (h.id = `help-${i}`));
    const toc = document.createElement('nav');
    toc.className = 'help-toc';
    toc.innerHTML = heads.map((h) => `<a href="#${h.id}">${h.textContent}</a>`).join('');
    toc.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('a');
      if (!a) return;
      e.preventDefault();
      this.el.querySelector(a.getAttribute('href')!)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    this.el.querySelector('.version-line')?.after(toc);
    this.el.querySelector('#help-close')!.addEventListener('click', () => this.toggle());
  }

  toggle(): void {
    this.el.style.display = this.el.style.display === 'none' ? '' : 'none';
  }
}

const HELP_HTML = `
<h3>How to fly <button id="help-close">×</button></h3>
<p class="version-line">RC Heli Sim <b>v${__VERSION__}</b> · build <code>${__COMMIT__}</code> · <a href="https://github.com/filipenevola/rc-heli-sim/blob/main/CHANGELOG.md" target="_blank" rel="noopener">Release log</a> · <a href="https://github.com/filipenevola/rc-heli-sim" target="_blank" rel="noopener">Source</a></p>

<section>
  <h4>The idea</h4>
  <p>This is an <b>RC model helicopter</b> simulator: the physics, sizes, head speeds and pitch curves are those of
  450 and 700 class models, and you watch from where the pilot stands on the field. Learn here, then fly the real
  one. Realism is the priority, so the helicopter does not help you unless you turn on an assist.</p>
</section>

<section>
  <h4>Controls (Mode 2)</h4>
  <ul>
    <li><b>Right stick</b> — cyclic. Left/right = aileron (roll), forward/back = elevator (pitch).</li>
    <li><b>Left stick</b> — collective/throttle (up/down, no spring) and rudder (left/right, yaw).</li>
    <li><b>Keyboard:</b> arrows = cyclic, W/S = collective, A/D = rudder, 1/2/3 = flight mode, H = throttle hold,
      R = reset, P = pause, M = mute, U = hide/show UI, F = fullscreen, C = camera, ? = this help.</li>
    <li><b>Top bar icons:</b> hover for a tooltip on desktop; on a touch screen, <b>long-press</b> any icon for a mini help.
      The eye at the top-left hides or shows everything else; pause with ⏸.</li>
    <li><b>Touch:</b> two on-screen gimbals. Choose Mode 1–4 in Settings. The throttle stick stays where you leave it.</li>
    <li><b>Real transmitter:</b> plug the USB simulator dongle/cable in, move a stick, then open Settings → Transmitter mapping.
      Press <i>Assign</i> for each function and move that stick fully in the direction asked; <i>Calibrate travel</i> if the
      sticks don't reach full deflection; <i>Save</i>. The mapping is remembered for that dongle.</li>
    <li><b>Phone tilt:</b> Settings → Input → <i>Phone tilt</i>. Tilting the phone forward/sideways is the cyclic; the left
      gimbal is still collective and rudder. The pose you hold when enabling it is neutral; use <i>Recentre</i> in the top bar
      any time. This mode turns on the <i>Attitude</i> assist (see below) so the helicopter copies the phone's tilt.</li>
  </ul>
</section>

<section>
  <p><b>R</b> resets to the pad. <b>Shift+R</b> resets straight into a hover at 6 m in Idle-Up 1 with the rotor at
  speed, for drilling 3D figures without spooling up each time. It stays frozen until your collective is near the
  middle, then flies.</p>
  <h4>Flight modes and switches</h4>
  <ul>
    <li><b>Normal</b> — training mode. Bottom stick = motor off and a little negative pitch; the governor spools up as you raise
      the stick and the pitch curve goes −2° to +11°. Start here: raise the stick slowly, let the head speed come up, then lift.</li>
    <li><b>Idle-Up 1 / 2</b> — the governor holds a fixed head speed and the pitch curve is symmetric (−11° … +11°), so centre
      stick is zero pitch. Needed for inverted flight and 3D. Switch to it only after take-off.</li>
    <li><b>Throttle hold</b> — motor off, rotor freewheels. Use it for autorotation practice or as a safety when you lose it.
      From altitude: hold on, lower collective to keep the head speed up, then flare and pull pitch just before touching down.</li>
  </ul>
</section>

<section>
  <h4>Inverted flight and 3D — the "flip switch"</h4>
  <p>Collective-pitch helicopters do not reverse the blades to fly upside down. The <b>Idle-Up</b> switch on the
  transmitter (sometimes labelled flight mode, ID1/ID2 or stunt) changes two things: the throttle curve becomes flat so the
  governor holds a constant head speed, and the <b>pitch curve becomes symmetric</b>: bottom of the stick = −11°, centre = 0°,
  top = +11°. Inverted, you push the collective stick <i>down</i> and the negative pitch pushes the helicopter toward the sky.
  Everything else keeps its meaning relative to the helicopter; from where you stand, aileron and elevator look reversed.</p>
  <ol>
    <li>Take off in <b>Normal</b> and climb well above 20 m. Mistakes cost altitude.</li>
    <li>Flip to <b>Idle-Up 1</b> (Mode button, key 2, or your transmitter's switch once mapped). Keep the stick just above centre:
      the hover is now at about +5° with centre = 0°.</li>
    <li><b>Flip:</b> full aileron (or elevator) until inverted, then centre the cyclic and <i>push the collective stick below centre</i>
      to hold the inverted hover. Finish the roll with aileron the same way and bring the stick back above centre.</li>
    <li><b>Loop:</b> fly forward, pull elevator, reduce collective over the top (around 0° to slightly negative), add it back when
      level. A small "pitch pump" on the way down keeps the head speed up.</li>
    <li>Switch back to Normal only when upright and clear of the ground; Normal mode removes negative pitch.</li>
  </ol>
  <p><b>Idle-Up 2</b> is the same with more pitch (±12°/13°) and a higher head speed for aggressive 3D.</p>
</section>

<section>
  <h4>Transmitter switches</h4>
  <p>In Settings → Transmitter mapping you can assign your radio's switches as well as its sticks: <i>Assign Idle-Up switch</i>
  and <i>Assign Throttle-hold switch</i>. Start with the switch in its off/Normal position, click the button, flip the switch.
  USB dongles present switches as a joystick button or as an extra axis; both are detected. Until a switch is mapped, the Mode
  and Hold buttons (keys 1/2/3 and H) do the job. <i>Clear switches</i> gives them back.</p>
</section>

<section>
  <h4>After every flight: the debrief</h4>
  <p>When you land (or crash) after more than a few seconds in the air, a card shows the flight: how firm the touchdown
  was (a greaser is under 0.25 m/s; a real heli's skids complain above 1 m/s), the peak altitude, speed and G, time spent
  in vortex ring state or blade stall, battery used, and any challenges you completed on the way. Chase softer landings
  and fewer warnings; that is what an instructor would watch. <b>Replay flight</b> on the card plays the whole flight
  back with your sticks shown; switch cameras while it runs to see your hover from the side or from above.
  <b>Save flight</b> writes the flight to a .json file; Settings → Load a saved flight replays it on any machine,
  so you can send a flight to an instructor or keep a good one. <b>Fly against it</b> (or Settings → Load a flight
  as a ghost) puts a translucent copy of that flight in the air on a loop while you fly: hover next to your own
  best hover and see where you drift, or follow an instructor's circuit line.</p>
  <p><b>Logbook</b> (Pilot tab): the last sixty flights on this device with duration, landing grade, peak
  altitude and G, and a line that compares your last ten flights with the ten before: clean-flight rate and
  landing softness. That is the number to watch from week to week.</p>
  <h4>Things the physics will do to you</h4>
  <ul>
    <li><b>Vortex ring state</b> (settling with power): descend nearly vertically at about the rotor's downwash speed and the
      disc re-ingests its own wake: thrust drops, it gets rough, and pulling collective makes it worse. The HUD warns.
      Escape with forward cyclic (fly out of it) or less collective; prevent it by descending with some forward speed.</li>
    <li><b>Blade stall</b>: too much collective for the head speed. The rotor bogs (rpm droops, torque spikes) and lift does
      not come. Ease the collective off and let the head speed recover.</li>
    <li><b>Hard landings</b> fold the skids: above about 2.8 m/s of sink at touchdown the flight is over (the
      training gear's foam balls take a little more). The debrief grades every touchdown.</li>
    <li><b>Autorotation</b> is flown with airspeed: collective to the bottom in throttle hold, nose a little down to
      keep 8–9 m/s, a nose-up flare around 12 m that bleeds the speed and raises the head speed, level the skids, then one
      smooth pull. A 450 has barely enough rotor energy for this; the 700 forgives much more. A micro cannot do it.</li>
    <li><b>Battery</b>: the pack sags under 30% and the motor quits at 0%. Land before the warning, or practise the
      autorotation that follows.</li>
    <li><b>The wake on the tail</b>: in a hover the rotor wake goes straight down and misses the tail. Between about
      2 and 6 m/s of airspeed it skews onto the stabiliser and tail rotor: a nose-up bump, less tail authority and a
      rough yaw. Real pilots feel this on every transition and in slow sideways flight; add a touch of forward cyclic
      and expect to work the rudder.</li>
    <li><b>Skids on grass</b> slide along their length but dig in sideways. A sideways touchdown with drift is what
      rolls a heli over; land straight or with a bit of forward motion.</li>
    <li><b>Ground effect</b> only exists in a hover; it fades with forward speed, which is why a fast low pass sinks.</li>
    <li><b>Wind</b> (Settings) is weaker near the ground and rough in the lee of trees and buildings; the windsock shows
      the mean. Learn hovers in calm, then add 3–5 m/s, then move the hover next to the barn.</li>
    <li><b>Boom strike</b>: on the flybar trainer, big cyclic while pushing negative G folds the blades into the tail boom.
      That is why 3D is flown on flybarless heads; on the trainer, keep the collective positive when you use a lot of cyclic.</li>
  </ul>
</section>

<section>
  <h4>Helicopters</h4>
  <ul>
    <li><b>450 flybar trainer</b> — softest and most damped. The mechanical flybar adds stability but less authority.</li>
    <li><b>450 flybarless</b> — modern electronics in rate mode: crisp and quick, holds whatever attitude you leave it in.</li>
    <li><b>700 3D</b> — big, powerful and fast. Lots of inertia, lots of thrust.</li>
    <li><b>250 Micro CP</b> — a garden-sized collective-pitch micro: light, quick, nervous, short on battery.</li>
  </ul>
  <p><b>Dual rates on the mode switch</b> (Settings → Input): real radios usually fly Normal with a lower cyclic rate
  and Idle-Up with full rate. The "Normal-mode rate" slider does that: 0.6 makes the hover gentle without touching 3D.</p>
  <p><b>Your own helicopter</b> (Settings → Helicopter → My helicopter): type the blade length, all-up weight,
  battery and head speeds from your real model, choose flybar or flybarless, and fly that. Everything the box does
  not tell you (inertias, rotor and tail geometry, drag, motor) is scaled between the 450 and 700 references, so a
  550 feels like a 550. It is saved on this device and with your account.</p>
  <p><b>Nitro</b> (My helicopter → Power): a glow engine behind a centrifugal clutch and a fuel tank instead of a
  battery. Torque peaks near the Idle-Up head speed and falls off above and below it; below about 10% throttle the
  clutch lets go and the rotor freewheels while the engine idles, which is why hold and autorotations work the way
  they do on nitro. Fuel burns with load; the engine quits dry. The sound is the engine's exhaust pulse, not a motor whine.</p>
  <p><b>Governor off / rate gyro</b> (Settings → Helicopter → Model setup): switch the ESC governor off and the
  head speed droops when you pull collective, as with a plain throttle curve; set the Idle-Up throttle to match your
  pitch. Switch the tail gyro to rate mode and the tail no longer holds its heading: every collective change
  swings it and you hold it with the rudder. Both are how helis were flown before heading-hold gyros and governors,
  and both teach why the modern ones are worth the money.</p>
  <p><b>Training gear</b> (Settings → Helicopter): the cross of rods and balls every instructor fits to a first heli. It
  makes tip-overs almost impossible on landings, costs some weight and crispness, and the physics includes all of it.
  Use it for your first hovers, then take it off.</p>
  <p><b>Model setup</b> (Settings → Helicopter): pitch curves per flight mode, head speed, tail gyro gain and cyclic rate,
  exactly the things you would set in your radio. Too much gyro gain wags the tail (the gyro's filter, the servo's
  speed and a few milliseconds of delay are all modelled, so the wag starts around 250% on a 450, 200% on a micro; the HUD warns and you hear the tail flutter); too
  little lets it wander. A lower head
  speed in Normal makes a trainer gentler; a higher pitch range in Idle-Up gives more 3D authority.</p>
  <ul>
  </ul>
</section>

<section>
  <h4>Assist</h4>
  <ul>
    <li><b>Rate (real)</b> — the stick commands a roll/pitch rate. Let go and the heli keeps its bank. This is how model
      helicopters work and what you must learn for the real thing.</li>
    <li><b>Attitude</b> — the stick commands a bank angle and the heli levels itself when you centre the stick, like a camera drone.
      Easier, not realistic. Good for a first hover or for the phone-tilt input.</li>
  </ul>
</section>

<section>
  <h4>Smoke trail</h4>
  <p>Press <b>T</b> (or Settings → Smoke trail) for a fading ribbon of the last 12 seconds of flight. It shows the
  real shape of your loop, eight or funnel from where you stand, the way smoke does at a show, and it also draws
  during replays.</p>
  <h4>Telemetry graph</h4>
  <p>Press <b>Y</b> (or Settings → Telemetry graph) for a strip chart of the last 30 seconds: head speed (yellow),
  collective (blue), altitude (green) and G (red), the way a radio's telemetry log looks. Watch the head speed sag
  on a hard pull with the governor off, or wander when the gyro gain is too high.</p>
  <h4>Camera</h4>
  <p>The <b>Cam</b> button (or C) cycles: <b>Pilot</b> — you stand on the field and the view zooms with distance, the
  realistic way and the one that transfers to the real model; <b>Chase</b> — behind the tail, turning with the heading;
  <b>Front</b> — ahead of the nose looking back, for nose-in practice; <b>Top</b> — straight above, north up, to see drift;
  <b>Drone</b> — a camera drone circling the model. Switch any time, even mid-flight. In Settings → Camera you can also
  choose where the pilot stands (helipad, barn, pond, tower, road) or press <b>G</b> to walk to wherever the heli is, like you
  would at the field. The <b>orientation arrow</b> under the model shows where the nose points; switch it off once nose-in
  stops confusing you.</p>
</section>

<section>
  <h4>HUD</h4>
  <p><b>Head speed</b> rotor rpm · <b>Collective</b> blade pitch · <b>Power</b> what the motor is delivering ·
  <b>Ground effect</b> extra lift close to the ground (why it floats at knee height) · <b>Distance</b> from where you stand.
  Tap the HUD on a phone to expand or collapse it.</p>
</section>

<section>
  <h4>The field and the landing challenges</h4>
  <p>Everything on the field is solid: trees, the fence, houses, the barn, hay bales, cows, sheep, the windsock pole. Blades
  touching anything is a crash; skids into a wall at speed too. The <b>windsock</b> next to the pad shows the live wind
  direction and droops when it is calm. Four <b>landing targets</b> have a yellow top with a white ring: the picnic table (right of
  the pad), the pickup truck bed (left), the pontoon on the pond (far right) and the 7 m tower pad (far ahead). Set all four
  skids down inside the ring and hold still for a moment: the sim measures your distance from the centre and remembers your
  best on this device. Try the table in Normal mode first, then the truck, the pontoon, and the tower last (it is high, small
  and out of ground effect).</p>
</section>

<section>
  <h4>The indoor gym</h4>
  <p>Settings → <b>Flying site</b> → Indoor gym loads a sports hall instead of the field: 36 × 48 m, 12 m to the
  ceiling, bleachers, two hoops, a stack of mats and a vault box to land on, and no wind. It is the place for the
  250 micro and for tight hover work; walls, ceiling, hoops and bleachers all bite. The circuits and hover
  challenges work in here; the ones that need altitude, wind or the field's targets are marked "Field only".</p>
  <h4>The parking lot</h4>
  <p>Settings → <b>Flying site</b> → Parking lot: the club's car park, 110 × 90 m of asphalt with painted bays,
  light poles, a few parked cars, two warehouses along the back and a shipping container whose roof is a landing
  target (2.6 m up, almost no ground effect). Open sky and wind, like a real club lot; the poles are the usual
  surprise. The field's picnic table, truck, pontoon and tower challenges are marked "Field only" there.</p>
  <h4>Rescue: the buddy box</h4>
  <p>Hold <b>Space</b> (or press and hold the 🛟 button) and the instructor takes the sticks: the heli rolls upright,
  the drift stops and it holds a hover where it is, climbing to 3 m first if it was lower. Let go and the sticks are
  yours again, with your assist mode restored. It is the trainer switch of a buddy box, or the rescue button of a
  flybarless unit: use it the moment you lose it, not after the ground arrives. Rescue needs a turning rotor and some
  height; on the ground or after a crash it does nothing. It is off during lessons and replays. With a real
  transmitter, Settings → Transmitter mapping → <b>Assign Rescue switch</b> puts it on a switch, exactly like the
  rescue function of an FBL unit.</p>
  <h4>Phone radio: your phone as the transmitter</h4>
  <p>Fly the sim on a laptop or TV with a phone in your hands: Settings → Input → <b>Pair a phone</b> shows a four-letter
  code; on the phone open <b>/radio.html</b> (same site), type the code, and its touch gimbals (or phone tilt for
  the cyclic) drive the sim. The two devices talk directly over WebRTC, so on the same Wi-Fi the sticks arrive in a
  few milliseconds; the rankings server only passes the pairing handshake. The phone page has the flight-mode and
  throttle-hold switches and shows the round-trip latency. If the link drops, the sim fails safe like a real
  receiver: cyclic and rudder centre, collective holds, and the keyboard or USB radio takes over.</p>
  <h4>The hillside</h4>
  <p>Settings → <b>Flying site</b> → Hillside: a sloping meadow with real terrain. The pad sits on the flat; in front
  of you the ground climbs at 10° to a knoll, and to the right a 20° bank rises. Two rings mark the slope landing
  spots. Slope landings are the skill: hover over the ring, let the <b>uphill skid</b> touch first, and bring the
  collective down slowly while the cyclic keeps the disc level. On the 20° bank the skids must lie <b>across</b> the
  slope (nose along the hill): skids slide along their length far more easily than sideways, so nose-up or nose-down
  the heli creeps away. Pushing the cyclic into the hill once a skid is down pivots the heli about that skid: that is
  dynamic rollover, and it happens here too. The altitude on the HUD is height above the grass under the heli, not
  above the pad, and the wind climbs the windward face (upwash) and sinks on the lee side. Self-level assist steps
  aside once the skids are down with the collective at the bottom, as the rescue modes on FBL units do.</p>
  <h4>Billboards: the Quave Holdings portfolio</h4>
  <p>The billboards around the field are the companies and products of <a href="https://quaveholdings.com/portfolio" target="_blank" rel="noopener">Quave Holdings</a>,
  the group behind this simulator. Tap or click a billboard in the scene to open its site, or use the links here:</p>
  <ul>
    ${BILLBOARDS.map((b) => `<li><a href="${b.url}" target="_blank" rel="noopener"><b>${b.name}</b></a> — ${b.tagline}</li>`).join('')}
  </ul>
</section>

<section>
  <h4>Show me / Teach me</h4>
  <p>Every challenge has two buttons in the Challenges panel. <b>Show me</b>: a demo pilot performs the whole challenge on the
  real physics while two big gimbals show exactly where its sticks are, with a caption per step and the switch states. Nothing
  the demo does counts for your score. <b>Teach me</b>: you fly it. The same steps and captions, but now a dashed ring on each
  gimbal shows where your stick should be at this instant (computed from what the helicopter is doing right now), the switches
  tell you when to flip Idle-Up or Hold, a translucent blue <b>ghost</b> flies the current step next to you, and a step only
  advances when you make it. A crash resets to the pad and restarts the
  lesson. What you fly in Teach me counts for the challenges and rankings.</p>
</section>

<section>
  <h4>Before you fly the real one</h4>
  <p>What transfers from here to the field, and what does not. The sim is honest about physics, but it cannot
  check your model. Before the first real flight of a day:</p>
  <ul>
    <li><b>Blade tracking and balance</b>: a wobble in the sim is a setup slider; on the real heli it is a loose blade or a
      bent shaft. Hover at eye level and look at the disc edge: one line, not two.</li>
    <li><b>Head speed and pitch range</b>: match the sim's model setup to your radio (Settings → Model setup). A hover at
      about 5–6° of pitch and the head speed your blades are rated for; too much pitch at too little head speed is the
      blade stall you met in here.</li>
    <li><b>Gyro gain</b>: set it just under the wag, the way you found it in Model setup. Tail wag on the real heli means
      the same thing: too much gain, or a slack belt or servo.</li>
    <li><b>Range check and failsafe</b>: a real transmitter has a range-check mode; use it, and know what the receiver
      does on signal loss (throttle hold is the right answer for a heli).</li>
    <li><b>Wind</b>: your limit in the sim is a number; outside, the lee of buildings and trees is rough and the hover
      drifts the way the crosswind challenge showed. First real flights: calm air, early morning.</li>
    <li><b>Battery and timer</b>: set a timer to land with 30% left. The sag you felt here below 30% is real and comes
      with a bogging head.</li>
    <li><b>Your stance</b>: stand where the pilot stands in the sim, model 5–10 m in front, tail toward you, and do
      exactly the first lesson: spool, light on the skids, lift to knee height, hold, set it down. Nothing else that day.</li>
  </ul>
  <p>Keep the sim honest too: fly it in Pilot camera, with Rate assist, with your own transmitter, in the same
  orientations you intend to fly outside.</p>
</section>

<section>
  <h4>Offline at the field</h4>
  <p>After the first visit the sim is cached and runs without signal; on a phone, use the browser's <b>Add to Home
  Screen</b> for a full-screen app. Rankings and sign-in need the network; everything else works offline.</p>
  <h4>Learning path</h4>
  <p>The challenges follow the progression every RC heli instructor teaches, grouped by level:</p>
  <ol>
    <li><b>Beginner</b>: first hover tail-in, hover box, side-in both ways, the Elevator (collective only), picnic table and
      spot landings, five minutes up. Normal mode, 450 trainer, no wind.</li>
    <li><b>Intermediate</b>: nose-in hover (the big one: cyclic feels reversed), pirouette, figure eight, the ring circuit,
      truck and pontoon landings, fifteen minutes up. Add wind in Settings once these are easy.</li>
    <li><b>Advanced</b>: tower landing out of ground effect, nose-in circuit, stall turn, autorotation.</li>
    <li><b>3D</b>: roll, loop, inverted hover, funnel, tic-toc, piro flip. Idle-Up, high up, and lots of Show me first.</li>
  </ol>
  <p>Rule of thumb from the field: do not move to the next item until the current one is boring.</p>
  <p>Crashes: a blade strike or a hard hit ends the flight. The crash banner offers <b>Replay last 10 s</b>: your flight
  plays back with your own stick inputs on the big gimbals so you can see what went wrong. Then R or Reset.</p>
</section>
`;
