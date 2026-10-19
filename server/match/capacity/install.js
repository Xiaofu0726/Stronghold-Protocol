import { CapacityMatchSettle } from '../match/capacitySettle.js';
import { CapacityMatchUnite } from '../match/capacityUnite.js';
import { CapacityMatchPlatform } from '../match/capacityPlatform.js';
import { CapacityMatchViews } from '../match/capacityViews.js';
import { CapacityMatchPhases } from '../match/capacityPhases.js';
import { CapacityMatchSpDraft } from '../match/capacitySpDraft.js';
import { CapacityMatchTestCommands } from '../match/capacityTestCommands.js';

export function installCapacityMatch(Match) {
  // Small rooms run the upstream methods. Only larger rosters use the capacity overrides.
  for (const part of [CapacityMatchPlatform, CapacityMatchViews, CapacityMatchPhases, CapacityMatchSpDraft, CapacityMatchTestCommands, CapacityMatchSettle, CapacityMatchUnite]) {
    for (const key of Reflect.ownKeys(part.prototype)) {
      if (key === 'constructor') continue;
      const capacityMethod = part.prototype[key];
      const upstreamMethod = Match.prototype[key];
      Object.defineProperty(Match.prototype, key, { configurable: true, writable: true, value: function (...args) {
        const method = this.order.length > 4 || typeof upstreamMethod !== 'function' ? capacityMethod : upstreamMethod;
        return method.apply(this, args);
      } });
    }
  }
}
