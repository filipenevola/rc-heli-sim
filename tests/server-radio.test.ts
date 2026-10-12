import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, createRooms } from '../server/radio-rooms.mjs';
import { CODE_ALPHABET as CLIENT_ALPHABET } from '../src/net/code';

describe('phone radio signalling rooms', () => {
  it('shares the pairing alphabet with the client', () => {
    expect(CODE_ALPHABET).toBe(CLIENT_ALPHABET);
  });

  it('lets the desk open a room, the phone offer, the desk answer, and each side read the other', () => {
    const rooms = createRooms();
    expect(rooms.signal('ABCD', 'phone', 'offer-sdp')).toBeNull(); // no room yet: a phone cannot create one
    expect(rooms.signal('ABCD', 'desk')).toEqual({ peer: null }); // the desk opens it
    expect(rooms.signal('ABCD', 'phone', 'offer-sdp')).toEqual({ peer: null });
    expect(rooms.signal('ABCD', 'desk')).toEqual({ peer: 'offer-sdp' });
    expect(rooms.signal('ABCD', 'desk', 'answer-sdp')).toEqual({ peer: 'offer-sdp' });
    expect(rooms.signal('ABCD', 'phone')).toEqual({ peer: 'answer-sdp' });
    // A new offer on the same code drops the stale answer.
    expect(rooms.signal('ABCD', 'phone', 'offer-2')).toEqual({ peer: null });
    expect(rooms.signal('ABCD', 'desk')).toEqual({ peer: 'offer-2' });
  });

  it('rejects bad codes, bad roles and oversized blobs, and expires rooms', () => {
    let t = 0;
    const rooms = createRooms({ ttlMs: 1000, now: () => t, maxSdp: 10 });
    expect(rooms.signal('abcd', 'desk', 'x')).toBeNull(); // lowercase / ambiguous letters are not in the alphabet
    expect(rooms.signal('AB', 'desk', 'x')).toBeNull();
    expect(rooms.signal('ABCD', 'judge' as never, 'x')).toBeNull();
    expect(rooms.signal('ABCD', 'desk')).toEqual({ peer: null });
    expect(rooms.signal('ABCD', 'phone', 'this is far too long')).toEqual({ peer: null });
    expect(rooms.signal('ABCD', 'desk')).toEqual({ peer: null }); // oversized offer was not stored
    expect(rooms.signal('ABCD', 'phone', 'offer')).toEqual({ peer: null });
    expect(rooms.size).toBe(1);
    t = 2000;
    expect(rooms.size).toBe(0);
    expect(rooms.signal('ABCD', 'phone')).toBeNull();
  });

  it('caps the number of rooms', () => {
    const rooms = createRooms({ maxRooms: 2 });
    expect(rooms.signal('AAAA', 'desk', 'o')).not.toBeNull();
    expect(rooms.signal('BBBB', 'desk', 'o')).not.toBeNull();
    expect(rooms.signal('CCCC', 'desk', 'o')).toBeNull();
  });
});
