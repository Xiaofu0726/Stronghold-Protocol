// Additional waves for rosters larger than four; base leak/bounty planning stays upstream.
import { createRng, deriveSeed } from '../../sim/rng.js';
import { MAX_UNITE_HELPERS, uniteRoundLimit } from '../../../shared/playerCapacity.js';

/** Shuffle selected helpers once per game round, independently of shop/wave/plugin RNG streams. */
export function randomUniteOrder(m, helpers) {
  return createRng(deriveSeed(m.seed, 'unite-order:' + m.round)).shuffle(helpers.slice());
}

export function capacityUnitePlan(m, plan) {
  const ordered = plan.helpers;
  const perRound = Math.max(1, Math.min(2, Math.trunc(m.gd.unite.maxHelpers)));
  return { ...plan, helpers: ordered.slice(0, perRound), reserveHelpers: ordered.slice(perRound), round: 1, perRound,
    roundsMax: Math.min(uniteRoundLimit(m.poolGroups?.length), Math.ceil(ordered.length / perRound)), history: [], usedHelpers: [],
    skipVotes: new Set(), skipRemaining: false };
}

export function capacityHelperOrder(m, perfects, results, helperStats) {
  const st = new Map(perfects.map((ps) => [ps.playerId, helperStats(m, ps, results)]));
  const S = (ps) => st.get(ps.playerId);
  const perRound = Math.max(1, Math.min(2, Math.trunc(m.gd.unite.maxHelpers)));
  const limit = Math.min(MAX_UNITE_HELPERS, perRound * uniteRoundLimit(m.poolGroups?.length));
  const selected = perfects.slice().sort((a, b) => S(b).units - S(a).units || (S(b).active - S(a).active) || S(b).standing - S(a).standing || a.seat - b.seat)
    .slice(0, limit);
  const ordered = [];
  for (let i = 0; i < selected.length; i += perRound) {
    ordered.push(...selected.slice(i, i + perRound).sort((a, b) => S(b).units - S(a).units || (S(b).active - S(a).active)
      || S(b).layers - S(a).layers || S(b).standing - S(a).standing || a.seat - b.seat));
  }
  return randomUniteOrder(m, ordered);
}

/** Count the enemies the next wave would have to face when a wave could not run. */
export function plannedUniteSurvivors(plan) {
  const out = new Map(plan.notReentered);
  for (const l of plan.leaked) out.set(l.sourcePlayerId, (out.get(l.sourcePlayerId) || 0) + 1);
  return out;
}

/** Recover still leaking enemies for the next wave, retaining their source, stats and bounty when possible. */
export function uniteRemainingLeaks(plan, result) {
  // A twenty-player wave can carry thousands of leaks. Index the original spawns once so matching survivors does not
  // scan the entire list for every enemy. The same row belongs to its source/key/tag bucket and its exact-mods bucket.
  const bySource = new Map();
  const byMods = new Map();
  const queue = (map, key) => {
    let q = map.get(key);
    if (!q) { q = { rows: [], cursor: 0 }; map.set(key, q); }
    return q;
  };
  const take = (q) => {
    if (!q) return null;
    // loop-cap: each queued leak row is visited once.
    while (q.cursor < q.rows.length && q.rows[q.cursor].used) q.cursor++;
    const row = q.rows[q.cursor++] || null;
    if (row) row.used = true;
    return row;
  };
  const keyOf = (entry) => JSON.stringify([entry.sourcePlayerId, entry.enemyKey, entry.tag ?? null]);
  for (const leak of plan.leaked) {
    const key = keyOf(leak);
    const row = { leak, used: false };
    queue(bySource, key).rows.push(row);
    let variants = byMods.get(key);
    if (!variants) { variants = new Map(); byMods.set(key, variants); }
    queue(variants, JSON.stringify(leak.mods)).rows.push(row);
  }
  const sources = new Set(plan.leakers.map((p) => p.playerId));
  const claim = (entry) => {
    const key = keyOf(entry);
    const row = (entry.mods == null ? null : take(byMods.get(key)?.get(JSON.stringify(entry.mods))))
      || take(bySource.get(key));
    return row?.leak || null;
  };
  const out = [];
  const add = (entry) => {
    if (!entry || !sources.has(entry.sourcePlayerId) || !entry.enemyKey) return;
    const prior = claim(entry);
    out.push({ enemyKey: entry.enemyKey, sourcePlayerId: entry.sourcePlayerId, tag: entry.tag ?? null,
      mods: entry.mods ?? prior?.mods ?? null, lpr: entry.lpr ?? prior?.lpr ?? 1, bounty: prior?.bounty ?? null });
  };
  // Unspawned entries have no mods in BattleResult, so reserve their exact original spawn before matching children.
  for (const u of result.unspawned || []) add(u);
  for (const pp of Object.values(result.perPlayer || {})) for (const l of (pp && pp.leaked) || []) {
    if (l && l.counted !== false) add(l);
  }
  return out;
}

/** Eligible unused helpers, in the original whole-room order, shared by continuation and the skip-vote view. */
export function uniteReserveHelpers(plan) {
  if (!plan) return [];
  const seen = new Set([...plan.usedHelpers, ...plan.helpers].map((ps) => ps.playerId));
  const reserve = [];
  for (const ps of plan.reserveHelpers) {
    if (!ps.alive || ps.left || seen.has(ps.playerId)) continue;
    seen.add(ps.playerId);
    reserve.push(ps);
  }
  return reserve;
}

/** Another unused pair is used only while enemies remain, under the opening groups' fixed limit. */
export function nextUnitePlan(plan, result) {
  if (!plan || plan.skipRemaining || plan.round >= plan.roundsMax || !result || result.synthetic) return null;
  const leaked = uniteRemainingLeaks(plan, result);
  const perRound = Math.max(1, Math.min(2, Math.trunc(plan.perRound ?? plan.helpers.length)));
  const usedHelpers = [...plan.usedHelpers, ...plan.helpers];
  const reserve = uniteReserveHelpers(plan);
  const helpers = reserve.slice(0, perRound);
  if (!leaked.length || !helpers.length) return null;
  return { ...plan, helpers, reserveHelpers: reserve.slice(perRound), leaked, round: plan.round + 1, perRound,
    history: [...plan.history, result], usedHelpers, skipVotes: new Set(), skipRemaining: false };
}
