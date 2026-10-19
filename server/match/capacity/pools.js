import { SharedPool, SharedItemPool } from '../pool.js';
import { poolGroupSizes, poolCopyScale } from '../../../shared/playerCapacity.js';

/** Groups are assigned by occupied seat order at match start and never reshuffled after eliminations. */
export function createPoolGroups(gd, players, opts = {}) {
  const sorted = players.slice().sort((a, b) => a.seat - b.seat);
  let offset = 0;
  return poolGroupSizes(sorted.length).map((size, i) => {
    const members = sorted.slice(offset, offset + size);
    const playerIds = members.map((p) => p.playerId);
    offset += size;
    const scale = poolCopyScale(size);
    return { id: i + 1, playerIds, scale, pool: new SharedPool(gd, { ...opts, scale }),
      itemPool: new SharedItemPool(gd, () => members, { scale }) };
  });
}
