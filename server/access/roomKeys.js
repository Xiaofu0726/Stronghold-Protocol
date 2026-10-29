// Server-only room creation credentials, stored outside the checkout and reread on every create.
import { readFileSync } from 'node:fs';

const accessByRoom = new WeakMap();

export function roomKeysPath() {
  return process.env.SP_ROOM_KEYS_FILE || '/etc/stronghold/room-keys.json';
}

export function readRoomKeys(file = roomKeysPath()) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, keys: [] };
    throw new Error('Cannot read room key configuration', { cause: error });
  }
  let config;
  try { config = JSON.parse(text); } catch { throw new Error('Invalid room key configuration'); }
  if (config?.version !== 1 || !Array.isArray(config.keys)) throw new Error('Invalid room key configuration');
  const ids = new Set(), secrets = new Set();
  for (const entry of config.keys) {
    if (!entry || typeof entry.id !== 'string' || !/^k_[a-f0-9]{12}$/.test(entry.id)
      || typeof entry.key !== 'string' || !/^[A-Za-z0-9_-]{12}$/.test(entry.key)
      || typeof entry.remark !== 'string' || entry.remark.length > 200
      || typeof entry.enabled !== 'boolean' || ids.has(entry.id) || secrets.has(entry.key)) {
      throw new Error('Invalid room key configuration');
    }
    ids.add(entry.id);
    secrets.add(entry.key);
  }
  return config;
}

/** Missing/invalid credentials and unavailable configuration never authorise creation. */
export function authorizeRoomCreation(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{12}$/.test(key)) return null;
  try {
    const entry = readRoomKeys().keys.find((entry) => entry.enabled && entry.key === key);
    return entry ? { id: entry.id, remark: entry.remark } : null;
  } catch { return null; }
}

/** Never copy the secret into room.state or match data. */
export function bindRoomAccess(room, access) {
  accessByRoom.set(room, { id: access.id, remark: access.remark });
}

export function roomAccessOf(room) {
  return accessByRoom.get(room) || null;
}
