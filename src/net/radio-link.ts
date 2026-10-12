/**
 * Phone radio link: the sim (desk) and a phone pair through a 4-letter code and then talk WebRTC peer to peer.
 * The rankings API only relays one offer and one answer per attempt (no trickle: each side waits for ICE
 * gathering to finish and ships the complete description), so on the same Wi-Fi the sticks travel straight from
 * phone to laptop.
 *
 * The PHONE makes the offer. Every attempt is a fresh offer, and the desk answers whatever the newest offer is, so
 * a phone that comes back (or a second phone) always wins over a stale one: the answer carries the id of the offer
 * it belongs to and a phone ignores answers meant for another offer.
 */
import { CODE_ALPHABET } from './code';

export type LinkState = 'idle' | 'waiting' | 'connecting' | 'connected' | 'closed' | 'failed';

export interface RadioLink {
  readonly code: string;
  readonly channel: RTCDataChannel | null;
  readonly pc: RTCPeerConnection;
  state: LinkState;
  onState: ((s: LinkState) => void) | null;
  onMessage: ((text: string) => void) | null;
  send(text: string): void;
  close(): void;
}

export function makeCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

async function signal(api: string, code: string, role: 'desk' | 'phone', sdp?: string): Promise<string | null> {
  const res = await fetch(`${api}/api/radio/signal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, role, sdp }) });
  if (!res.ok) throw new Error(res.status === 404 ? 'No such pairing code' : await res.text());
  return ((await res.json()) as { peer: string | null }).peer;
}

/** Resolve when ICE gathering is done (or after a short grace period: host candidates are what matter on a LAN). */
function gathered(pc: RTCPeerConnection, graceMs = 1500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(done, graceMs);
  });
}

/** Short id of an offer so an answer can say which offer it belongs to. */
function offerId(sdp: string): string {
  let h = 0;
  for (let i = 0; i < sdp.length; i++) h = (h * 31 + sdp.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Link implements RadioLink {
  state: LinkState = 'idle';
  onState: ((s: LinkState) => void) | null = null;
  onMessage: ((text: string) => void) | null = null;
  channel: RTCDataChannel | null = null;
  pc: RTCPeerConnection;
  private stopped = false;
  constructor(readonly code: string) {
    this.pc = this.newPc();
  }
  /** A fresh peer connection (the desk makes one per offer it answers). */
  newPc(): RTCPeerConnection {
    const pc = new RTCPeerConnection(ICE);
    pc.addEventListener('connectionstatechange', () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'connected') this.set('connected');
      else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') this.set(this.stopped ? 'closed' : 'failed');
    });
    pc.addEventListener('datachannel', (e) => { if (this.pc === pc) this.attach(e.channel); });
    this.pc = pc;
    return pc;
  }
  set(s: LinkState): void {
    if (this.state === s) return;
    this.state = s;
    this.onState?.(s);
  }
  attach(ch: RTCDataChannel): void {
    this.channel = ch;
    ch.addEventListener('message', (e) => this.onMessage?.(String(e.data)));
    ch.addEventListener('open', () => this.set('connected'));
    ch.addEventListener('close', () => { if (this.channel === ch) this.set(this.stopped ? 'closed' : 'failed'); });
  }
  send(text: string): void {
    if (this.channel?.readyState === 'open') this.channel.send(text);
  }
  close(): void {
    this.stopped = true;
    this.channel?.close();
    this.pc.close();
    this.set('closed');
  }
  get stopping(): boolean { return this.stopped; }
}

/** The sim side: open the room, answer the newest phone offer with a fresh connection, keep listening until connected. */
export function hostLink(api: string, code: string): RadioLink {
  const link = new Link(code);
  void (async () => {
    try {
      link.set('waiting');
      await signal(api, code, 'desk'); // opens the room
      let answered: string | null = null;
      while (!link.stopping && link.state !== 'connected') {
        const offer = await signal(api, code, 'desk');
        if (offer && offer !== answered) {
          answered = offer;
          link.set('connecting');
          const pc = link.newPc();
          await pc.setRemoteDescription(JSON.parse(offer) as RTCSessionDescriptionInit);
          await pc.setLocalDescription(await pc.createAnswer());
          await gathered(pc);
          await signal(api, code, 'desk', JSON.stringify({ for: offerId(offer), sdp: pc.localDescription }));
        }
        await sleep(1000);
      }
    } catch (e) {
      console.warn('phone radio host', e);
      link.set('failed');
    }
  })();
  return link;
}

/** The phone side: offer, then wait for the desk's answer to this very offer. */
export function joinLink(api: string, code: string): RadioLink {
  const link = new Link(code);
  void (async () => {
    try {
      link.set('waiting');
      const pc = link.pc;
      // Unordered, no retransmits: a stale stick frame is worse than a lost one.
      link.attach(pc.createDataChannel('sticks', { ordered: false, maxRetransmits: 0 }));
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      const offer = JSON.stringify(pc.localDescription);
      const mine = offerId(offer);
      await signal(api, code, 'phone', offer);
      for (let i = 0; i < 25 && !link.stopping && link.state === 'waiting'; i++) {
        await sleep(1000);
        const peer = await signal(api, code, 'phone');
        if (!peer) continue;
        let parsed: { for?: string; sdp?: RTCSessionDescriptionInit } = {};
        try { parsed = JSON.parse(peer) as typeof parsed; } catch { continue; }
        if (parsed.for !== mine || !parsed.sdp) continue; // an answer to someone else's (or an older) offer
        link.set('connecting');
        await pc.setRemoteDescription(parsed.sdp);
      }
      if (link.state === 'waiting') throw new Error('No answer from the sim');
    } catch (e) {
      console.warn('phone radio join', e);
      link.set('failed');
    }
  })();
  return link;
}
