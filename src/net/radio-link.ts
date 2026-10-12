/**
 * Phone radio link: the sim (desk) and a phone pair through a 4-letter code and then talk WebRTC peer to peer.
 * The rankings API only relays one offer and one answer (no trickle: each side waits for ICE gathering to finish
 * and ships the complete description), so on the same Wi-Fi the sticks travel straight from phone to laptop.
 */
import { CODE_ALPHABET } from './code';

export type LinkState = 'idle' | 'waiting' | 'connecting' | 'connected' | 'closed' | 'failed';

export interface RadioLink {
  readonly code: string;
  readonly channel: RTCDataChannel | null;
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

class Link implements RadioLink {
  state: LinkState = 'idle';
  onState: ((s: LinkState) => void) | null = null;
  onMessage: ((text: string) => void) | null = null;
  channel: RTCDataChannel | null = null;
  private stopped = false;
  constructor(readonly code: string, readonly pc: RTCPeerConnection) {
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected') this.set('connected');
      else if (pc.connectionState === 'failed') this.set('failed');
      else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') this.set(this.stopped ? 'closed' : 'failed');
    });
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
    ch.addEventListener('close', () => this.set(this.stopped ? 'closed' : 'failed'));
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

/** The sim side: open a room with the code, publish an offer, poll for the phone's answer. */
export function hostLink(api: string, code: string): RadioLink {
  const pc = new RTCPeerConnection(ICE);
  const link = new Link(code, pc);
  // Unordered, no retransmits: a stale stick frame is worse than a lost one.
  link.attach(pc.createDataChannel('sticks', { ordered: false, maxRetransmits: 0 }));
  void (async () => {
    try {
      link.set('waiting');
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      await signal(api, code, 'desk', JSON.stringify(pc.localDescription));
      while (!link.stopping && link.state === 'waiting') {
        await new Promise((r) => setTimeout(r, 1000));
        const peer = await signal(api, code, 'desk');
        if (peer) {
          link.set('connecting');
          await pc.setRemoteDescription(JSON.parse(peer) as RTCSessionDescriptionInit);
        }
      }
    } catch (e) {
      console.warn('phone radio host', e);
      link.set('failed');
    }
  })();
  return link;
}

/** The phone side: fetch the offer for the code, answer it. */
export function joinLink(api: string, code: string): RadioLink {
  const pc = new RTCPeerConnection(ICE);
  const link = new Link(code, pc);
  pc.addEventListener('datachannel', (e) => link.attach(e.channel));
  void (async () => {
    try {
      link.set('waiting');
      let offer: string | null = null;
      for (let i = 0; i < 20 && !offer && !link.stopping; i++) {
        offer = await signal(api, code, 'phone');
        if (!offer) await new Promise((r) => setTimeout(r, 1000));
      }
      if (!offer) throw new Error('No offer for this code');
      link.set('connecting');
      await pc.setRemoteDescription(JSON.parse(offer) as RTCSessionDescriptionInit);
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      await signal(api, code, 'phone', JSON.stringify(pc.localDescription));
    } catch (e) {
      console.warn('phone radio join', e);
      link.set('failed');
    }
  })();
  return link;
}
