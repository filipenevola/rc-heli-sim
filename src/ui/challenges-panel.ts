import { CHALLENGES, TOTAL_POINTS, type ChallengeTracker, type FlightTimer } from '../game/challenges';
import { fmtTime, localRankings, saveLocalRanking, saveProfile, type Profile, type RankingClient } from '../game/player';

/**
 * Challenges + rankings drawer. Tabs: Challenges (list with live progress), Rankings (longest flight,
 * challenge points; local and online), Pilot (name, optional email verification).
 */
export class ChallengesPanel {
  private el: HTMLElement;
  private tab: 'challenges' | 'rankings' | 'pilot' = 'challenges';
  private online: { flight: unknown[]; challenge: unknown[] } | null = null;
  private status = '';
  private lastRender = 0;
  private pendingEmail: string | null = null;

  constructor(
    container: HTMLElement,
    private profile: Profile,
    private tracker: ChallengeTracker,
    private timer: FlightTimer,
    private client: RankingClient,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'challenges';
    this.el.style.display = 'none';
    container.appendChild(this.el);
    this.render();
  }

  toggle(): void {
    const open = this.el.style.display === 'none';
    this.el.style.display = open ? '' : 'none';
    if (open) {
      this.render();
      if (this.tab === 'rankings') void this.refreshOnline();
    }
  }

  get isOpen(): boolean {
    return this.el.style.display !== 'none';
  }

  /** Persist records locally and, when configured, online. Called after a flight ends or a challenge completes. */
  async sync(): Promise<void> {
    this.profile.completed = [...this.tracker.completed];
    this.profile.bestFlight = Math.max(this.profile.bestFlight, this.timer.best);
    saveProfile(this.profile);
    saveLocalRanking(this.profile.name, this.profile.bestFlight, this.tracker.points, this.profile.completed);
    if (this.client.online && this.profile.name) {
      try {
        await this.client.submit(this.profile);
      } catch (e) {
        this.status = `Online sync failed: ${(e as Error).message}`;
      }
    }
    if (this.isOpen) this.render();
  }

  private async refreshOnline(): Promise<void> {
    if (!this.client.online) return;
    try {
      const [flight, challenge] = await Promise.all([this.client.rankings('flight'), this.client.rankings('challenge')]);
      this.online = { flight, challenge };
    } catch (e) {
      this.status = `Could not load online rankings: ${(e as Error).message}`;
    }
    if (this.isOpen) this.render();
  }

  /** Live progress bars while open (cheap; throttled). */
  tick(): void {
    if (!this.isOpen || this.tab !== 'challenges') return;
    const now = performance.now();
    if (now - this.lastRender < 500) return;
    this.lastRender = now;
    for (const c of CHALLENGES) {
      const bar = this.el.querySelector<HTMLElement>(`[data-bar="${c.id}"]`);
      if (bar) bar.style.width = `${Math.round((this.tracker.completed.has(c.id) ? 1 : this.tracker.progress[c.id] ?? 0) * 100)}%`;
    }
    const t = this.el.querySelector('#air-time');
    if (t) t.textContent = this.timer.flying ? fmtTime(this.timer.airTime) : '—';
  }

  private render(): void {
    const p = this.profile;
    const tabs = (['challenges', 'rankings', 'pilot'] as const)
      .map((t) => `<button data-tab="${t}" class="${t === this.tab ? 'active' : ''}">${{ challenges: 'Challenges', rankings: 'Rankings', pilot: 'Pilot' }[t]}</button>`)
      .join('');
    let body = '';
    if (this.tab === 'challenges') {
      body = `
        <p class="hint">${this.tracker.points} / ${TOTAL_POINTS} points · ${this.tracker.completed.size} / ${CHALLENGES.length} done · current flight <b id="air-time">${this.timer.flying ? fmtTime(this.timer.airTime) : '—'}</b> · best clean flight <b>${fmtTime(Math.max(p.bestFlight, this.timer.best))}</b></p>
        <ul class="challenge-list">
          ${CHALLENGES.map((c) => {
            const done = this.tracker.completed.has(c.id);
            const pr = done ? 1 : this.tracker.progress[c.id] ?? 0;
            return `<li class="${done ? 'done' : ''}"><div class="row"><b>${done ? '✓ ' : ''}${c.title}</b><span>${c.points} pts</span></div><div class="desc">${c.description}</div><div class="bar"><i data-bar="${c.id}" style="width:${Math.round(pr * 100)}%"></i></div></li>`;
          }).join('')}
        </ul>`;
    } else if (this.tab === 'rankings') {
      const local = Object.entries(localRankings());
      const list = (rows: { name: string; value: string; verified?: boolean }[], empty: string) =>
        rows.length ? `<ol>${rows.map((r) => `<li><span>${esc(r.name)}${r.verified ? ' <i title="verified email">✔</i>' : ''}</span><b>${r.value}</b></li>`).join('')}</ol>` : `<p class="hint">${empty}</p>`;
      const flightLocal = local.filter(([, v]) => v.bestFlight > 0).sort((a, b) => b[1].bestFlight - a[1].bestFlight).map(([n, v]) => ({ name: n, value: fmtTime(v.bestFlight) }));
      const chalLocal = local.filter(([, v]) => v.points > 0).sort((a, b) => b[1].points - a[1].points).map(([n, v]) => ({ name: n, value: `${v.points} pts` }));
      const onl = this.online;
      body = `
        <div class="ranking-cols">
          <div><h5>Longest flight without a crash</h5>
            ${this.client.online ? `<h6>Online</h6>${onl ? list((onl.flight as { name: string; value: number; verified: boolean }[]).map((r) => ({ name: r.name, value: fmtTime(r.value), verified: r.verified })), 'Nobody yet. Be the first.') : '<p class="hint">Loading…</p>'}` : ''}
            <h6>This device</h6>${list(flightLocal, 'No flights recorded yet.')}
          </div>
          <div><h5>Challenge points</h5>
            ${this.client.online ? `<h6>Online</h6>${onl ? list((onl.challenge as { name: string; value: number; verified: boolean }[]).map((r) => ({ name: r.name, value: `${r.value} pts`, verified: r.verified })), 'Nobody yet.') : '<p class="hint">Loading…</p>'}` : ''}
            <h6>This device</h6>${list(chalLocal, 'No points yet.')}
          </div>
        </div>
        ${this.client.online ? '' : '<p class="hint">Online rankings are not configured in this build; records are kept on this device.</p>'}
        ${this.client.online && !p.name ? '<p class="hint">Set a pilot name in the Pilot tab to appear online.</p>' : ''}`;
    } else {
      body = `
        <label>Pilot name <input id="pilot-name" maxlength="24" value="${esc(p.name)}" placeholder="How you appear in rankings"></label>
        ${this.client.online ? `
        <p class="hint">Optional: verify an email to keep your records on every device. ${p.verified ? `<b>Verified as ${esc(p.email ?? '')}</b>` : ''}</p>
        <label>Email <input id="pilot-email" type="email" value="${esc(p.email ?? '')}" placeholder="you@example.com"></label>
        <div class="row-buttons"><button id="send-code">Send code</button>
        ${this.pendingEmail ? `<input id="pilot-code" inputmode="numeric" maxlength="6" placeholder="6-digit code"><button id="verify-code">Verify</button>` : ''}</div>` : '<p class="hint">This build has no online rankings; your name and records stay on this device.</p>'}
        <button id="save-pilot">Save</button>`;
    }
    this.el.innerHTML = `<h3>Challenges & rankings <button id="ch-close">×</button></h3><div class="tabs">${tabs}</div>${body}${this.status ? `<p class="hint status">${esc(this.status)}</p>` : ''}`;
    this.el.querySelector('#ch-close')!.addEventListener('click', () => this.toggle());
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as typeof this.tab;
        this.status = '';
        this.render();
        if (this.tab === 'rankings') void this.refreshOnline();
      });
    }
    this.el.querySelector('#save-pilot')?.addEventListener('click', () => {
      p.name = (this.el.querySelector('#pilot-name') as HTMLInputElement).value.trim().slice(0, 24);
      const emailEl = this.el.querySelector('#pilot-email') as HTMLInputElement | null;
      if (emailEl && emailEl.value.trim() !== (p.email ?? '')) {
        p.email = emailEl.value.trim() || null;
        p.verified = false;
        p.token = null;
      }
      saveProfile(p);
      this.status = p.name ? `Saved. Flying as ${p.name}.` : 'Saved.';
      void this.sync();
    });
    this.el.querySelector('#send-code')?.addEventListener('click', async () => {
      const name = (this.el.querySelector('#pilot-name') as HTMLInputElement).value.trim();
      const email = (this.el.querySelector('#pilot-email') as HTMLInputElement).value.trim();
      if (!name || !email) { this.status = 'Enter a pilot name and an email first.'; this.render(); return; }
      p.name = name;
      saveProfile(p);
      try {
        await this.client.requestCode(email, name);
        this.pendingEmail = email;
        this.status = `Code sent to ${email}. Check your inbox (and spam).`;
      } catch (e) {
        this.status = `Could not send the code: ${(e as Error).message}`;
      }
      this.render();
    });
    this.el.querySelector('#verify-code')?.addEventListener('click', async () => {
      const code = (this.el.querySelector('#pilot-code') as HTMLInputElement).value.trim();
      try {
        const r = await this.client.verifyCode(this.pendingEmail!, code);
        p.email = this.pendingEmail;
        p.verified = true;
        p.token = r.token;
        // Merge what the server knows for this email with what this device has.
        for (const id of r.completed) this.tracker.completed.add(id);
        p.bestFlight = Math.max(p.bestFlight, r.bestFlight);
        this.pendingEmail = null;
        this.status = 'Email verified. Your records follow you now.';
        saveProfile(p);
        await this.sync();
      } catch (e) {
        this.status = `Verification failed: ${(e as Error).message}`;
      }
      this.render();
    });
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
