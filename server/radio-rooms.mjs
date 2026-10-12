// Phone-radio signalling rooms. Two browsers (the sim on a desktop, the phone used as a transmitter) exchange one
// WebRTC offer and one answer through here, keyed by a short code, then talk peer to peer. Nothing is persisted:
// a room lives in memory for a few minutes and only ever holds two SDP blobs.

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createRooms({ ttlMs = 10 * 60 * 1000, maxRooms = 500, maxSdp = 32 * 1024, now = () => Date.now() } = {}) {
  const rooms = new Map();
  const sweep = () => {
    const t = now();
    for (const [code, r] of rooms) if (t - r.at > ttlMs) rooms.delete(code);
  };
  const validCode = (c) => typeof c === 'string' && c.length === 4 && [...c].every((ch) => CODE_ALPHABET.includes(ch));
  return {
    /**
     * Store this side's description (when given) and return the other side's. The desk opens the room; the phone
     * posts offers and the desk posts answers. Returns null for a bad code, an unknown room (phone side) or when the room table is full.
     */
    signal(code, role, sdp) {
      sweep();
      if (!validCode(code) || (role !== 'desk' && role !== 'phone')) return null;
      let room = rooms.get(code);
      if (!room) {
        if (role !== 'desk') return null; // the desk opens the room; a phone cannot create one
        if (rooms.size >= maxRooms) return null;
        room = { desk: null, phone: null, at: now() };
        rooms.set(code, room);
      }
      if (typeof sdp === 'string' && sdp.length > 0 && sdp.length <= maxSdp) {
        room[role] = sdp;
        room.at = now();
        // The phone offers; a fresh offer invalidates the desk's answer to the previous one.
        if (role === 'phone') room.desk = null;
      }
      return { peer: role === 'desk' ? room.phone : room.desk };
    },
    close(code) {
      rooms.delete(code);
    },
    get size() {
      sweep();
      return rooms.size;
    },
  };
}
