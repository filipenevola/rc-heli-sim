import { PART_GROUPS, partsFor, type HeadType, type PartInfo, type PowerType } from '../game/parts';

/** One step of the guided control demo: stick positions (-1..1) and what to watch. */
export interface DemoStep {
  caption: string;
  collective: number;
  elevator: number;
  aileron: number;
  rudder: number;
  /** Part to highlight while this step runs. */
  part: string;
}

export const DEMO: DemoStep[] = [
  { caption: 'Collective up: the whole swashplate rises and both blades take more pitch together. More lift.', collective: 1, elevator: 0, aileron: 0, rudder: 0, part: 'swashplate' },
  { caption: 'Collective down: the swashplate drops, pitch goes negative (that is how 3D machines fly upside down).', collective: -1, elevator: 0, aileron: 0, rudder: 0, part: 'swashplate' },
  { caption: 'Forward cyclic: the swashplate tilts forward. Each blade changes pitch as it goes round, so the disc tilts and pulls the heli forward.', collective: 0, elevator: 1, aileron: 0, rudder: 0, part: 'blade-grips' },
  { caption: 'Back cyclic: the swashplate tilts back.', collective: 0, elevator: -1, aileron: 0, rudder: 0, part: 'blade-grips' },
  { caption: 'Right cyclic (aileron): the swashplate tilts right; the three servos move by different amounts (120° CCPM).', collective: 0, elevator: 0, aileron: 1, rudder: 0, part: 'cyclic-servos' },
  { caption: 'Left cyclic.', collective: 0, elevator: 0, aileron: -1, rudder: 0, part: 'cyclic-servos' },
  { caption: 'Right rudder: the tail servo pulls the rod, the pitch slider moves along the tail shaft and the tail blades take more pitch.', collective: 0, elevator: 0, aileron: 0, rudder: 1, part: 'pitch-slider' },
  { caption: 'Left rudder: less tail pitch (through zero to negative).', collective: 0, elevator: 0, aileron: 0, rudder: -1, part: 'pitch-slider' },
];

export interface HangarCallbacks {
  onClose(): void;
  onSelect(id: string | null): void;
  onExplode(t: number): void;
  onCanopy(visible: boolean): void;
  onSpin(on: boolean): void;
  onDemo(on: boolean): void;
}

/**
 * The Hangar: name every part of your helicopter. A list grouped like a parts catalogue, the selected part's card
 * (what it does, how it breaks, what to know when you replace it), a floating label on the 3D model, and bench tools.
 */
export class HangarPanel {
  readonly el: HTMLElement;
  private label: HTMLElement;
  private parts: PartInfo[] = [];
  selected: string | null = null;
  private title = '';

  constructor(container: HTMLElement, private cb: HangarCallbacks) {
    this.el = document.createElement('div');
    this.el.className = 'hangar';
    this.el.style.display = 'none';
    container.appendChild(this.el);
    this.label = document.createElement('div');
    this.label.className = 'part-label';
    this.label.style.display = 'none';
    container.appendChild(this.label);
  }

  get isOpen(): boolean {
    return this.el.style.display !== 'none';
  }

  open(head: HeadType, modelName: string, power: PowerType = 'electric', gear = false): void {
    this.parts = partsFor(head, power, gear);
    this.title = modelName;
    this.selected = null;
    this.el.style.display = '';
    this.render();
  }

  close(): void {
    this.el.style.display = 'none';
    this.label.style.display = 'none';
  }

  select(id: string | null): void {
    this.selected = id;
    this.renderCard();
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-part]')) b.classList.toggle('active', b.dataset.part === id);
    const btn = id ? this.el.querySelector<HTMLElement>(`[data-part="${id}"]`) : null;
    btn?.scrollIntoView({ block: 'nearest' });
  }

  /** Floating name tag at a screen position (null hides it). */
  placeLabel(x: number | null, y: number, text: string): void {
    if (x === null) {
      this.label.style.display = 'none';
      return;
    }
    this.label.style.display = '';
    this.label.style.left = `${x}px`;
    this.label.style.top = `${y}px`;
    if (this.label.textContent !== text) this.label.textContent = text;
  }

  setReadout(html: string): void {
    const r = this.el.querySelector('.readout');
    if (r && r.innerHTML !== html) r.innerHTML = html;
  }

  setDemoCaption(text: string | null): void {
    const c = this.el.querySelector<HTMLElement>('.demo-caption');
    if (!c) return;
    c.style.display = text ? '' : 'none';
    if (text && c.textContent !== text) c.textContent = text;
  }

  nameOf(id: string): string {
    return this.parts.find((p) => p.id === id)?.name ?? id;
  }

  has(id: string): boolean {
    return this.parts.some((p) => p.id === id);
  }

  private render(): void {
    const groups = PART_GROUPS.map((g) => {
      const items = this.parts.filter((p) => p.group === g.id);
      if (!items.length) return '';
      return `<h5>${g.name}</h5><div class="part-list">${items.map((p) => `<button data-part="${p.id}">${p.name}</button>`).join('')}</div>`;
    }).join('');
    this.el.innerHTML = `
      <h3>🔧 Hangar <button class="close" title="Back to the field (G or Esc)">×</button></h3>
      <p class="hint">${this.title}. Drag to turn it, scroll or pinch to zoom, click any part. Move your sticks: this is a bench test, the swashplate and grips follow.</p>
      <div class="hangar-tools">
        <label>Exploded view <input type="range" id="explode" min="0" max="1" step="0.01" value="0"></label>
        <label class="check"><input type="checkbox" id="canopy" checked> Canopy</label>
        <label class="check"><input type="checkbox" id="spin"> Turn the rotor</label>
        <button id="demo">▶ Demo the controls</button>
      </div>
      <div class="readout"></div>
      <div class="demo-caption" style="display:none"></div>
      <div class="part-card"></div>
      ${groups}`;
    this.el.querySelector('.close')!.addEventListener('click', () => this.cb.onClose());
    const ex = this.el.querySelector<HTMLInputElement>('#explode')!;
    ex.addEventListener('input', () => this.cb.onExplode(Number(ex.value)));
    const can = this.el.querySelector<HTMLInputElement>('#canopy')!;
    can.addEventListener('change', () => this.cb.onCanopy(can.checked));
    const sp = this.el.querySelector<HTMLInputElement>('#spin')!;
    sp.addEventListener('change', () => this.cb.onSpin(sp.checked));
    const demo = this.el.querySelector<HTMLButtonElement>('#demo')!;
    demo.addEventListener('click', () => {
      const on = !demo.classList.contains('active');
      demo.classList.toggle('active', on);
      demo.textContent = on ? '■ Stop the demo' : '▶ Demo the controls';
      this.cb.onDemo(on);
    });
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-part]')) {
      b.addEventListener('click', () => {
        const id = b.dataset.part === this.selected ? null : b.dataset.part!;
        this.select(id);
        this.cb.onSelect(id);
      });
    }
    this.renderCard();
  }

  /** Sync the explode slider and canopy box when the host changes them (e.g. selecting the belt opens the boom). */
  setTools(explode: number, canopy: boolean): void {
    const ex = this.el.querySelector<HTMLInputElement>('#explode');
    if (ex) ex.value = String(explode);
    const can = this.el.querySelector<HTMLInputElement>('#canopy');
    if (can) can.checked = canopy;
  }

  private renderCard(): void {
    const card = this.el.querySelector<HTMLElement>('.part-card');
    if (!card) return;
    const p = this.parts.find((x) => x.id === this.selected);
    if (!p) {
      card.innerHTML = `<p class="hint">Pick a part from the list or click it on the model. Each card says what the part does, how it usually breaks, and what to know when you buy a spare.</p>`;
      return;
    }
    card.innerHTML = `
      <div class="part-name">${p.name}</div>
      ${p.aka ? `<div class="part-aka">${p.aka}</div>` : ''}
      <p>${p.what}</p>
      ${p.breaks ? `<p><b>Breaks:</b> ${p.breaks}</p>` : ''}
      ${p.tip ? `<p><b>Tip:</b> ${p.tip}</p>` : ''}`;
  }
}
