import { BILLBOARDS } from '../sim/ads';

/** In-game manual. Plain HTML so it works on every device and can be read while paused. */
export class HelpPanel {
  private el: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'help';
    this.el.style.display = 'none';
    this.el.innerHTML = HELP_HTML;
    container.appendChild(this.el);
    this.el.querySelector('#help-close')!.addEventListener('click', () => this.toggle());
    window.addEventListener('keydown', (e) => {
      if (e.key === '?' || e.code === 'F1') {
        e.preventDefault();
        this.toggle();
      }
      if (e.code === 'Escape' && this.el.style.display !== 'none') this.toggle();
    });
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
  <h4>Helicopters</h4>
  <ul>
    <li><b>450 flybar trainer</b> — softest and most damped. The mechanical flybar adds stability but less authority.</li>
    <li><b>450 flybarless</b> — modern electronics in rate mode: crisp and quick, holds whatever attitude you leave it in.</li>
    <li><b>700 3D</b> — big, powerful and fast. Lots of inertia, lots of thrust.</li>
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
  <h4>Camera</h4>
  <p>The <b>Cam</b> button (or C) cycles: <b>Pilot</b> — you stand on the field and the view zooms with distance, the
  realistic way and the one that transfers to the real model; <b>Chase</b> — behind the tail, turning with the heading;
  <b>Front</b> — ahead of the nose looking back, for nose-in practice; <b>Top</b> — straight above, north up, to see drift;
  <b>Drone</b> — a camera drone circling the model. Switch any time, even mid-flight.</p>
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
  tell you when to flip Idle-Up or Hold, and a step only advances when you make it. A crash resets to the pad and restarts the
  lesson. What you fly in Teach me counts for the challenges and rankings.</p>
</section>

<section>
  <h4>Learning path</h4>
  <p>The challenges follow the progression every RC heli instructor teaches, grouped by level:</p>
  <ol>
    <li><b>Beginner</b>: first hover tail-in, hover box, side-in both ways, the Elevator (collective only), picnic table and
      spot landings, five minutes up. Normal mode, 450 trainer, no wind.</li>
    <li><b>Intermediate</b>: nose-in hover (the big one: cyclic feels reversed), pirouette, figure eight, the ring circuit,
      truck and pontoon landings, fifteen minutes up. Add wind in Settings once these are easy.</li>
    <li><b>Advanced</b>: tower landing out of ground effect, nose-in circuit, autorotation.</li>
    <li><b>3D</b>: roll, loop, inverted hover. Idle-Up, high up, and lots of Show me first.</li>
  </ol>
  <p>Rule of thumb from the field: do not move to the next item until the current one is boring.</p>
  <p>Crashes: a blade strike or a hard hit ends the flight; press R or Reset.</p>
</section>
`;
