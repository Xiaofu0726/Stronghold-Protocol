// Match-local weighted Unite lottery: humans precede AI seats; weights decide order within each group.
// Fewer entries and less front exposure improve odds, never guarantee a position within that group.
import { createRng, deriveSeed } from '../../sim/rng.js';

const states = new WeakMap();
function stateOf(m) {
  let state = states.get(m);
  if (!state) {
    state = { records: new Map(), roundWeights: new Map(), settled: new Set() };
    states.set(m, state);
  }
  return state;
}

/** Copies for diagnostics/tests. A never-entered player has weight one. */
export function uniteFairnessRecords(m) {
  return new Map([...stateOf(m).records].map(([pid, r]) => [pid, { ...r }]));
}
export function uniteFairnessWeights(m) {
  const state = stateOf(m);
  return new Map((m.order || []).map(p => {
    const r = state.records.get(p.playerId);
    return [p.playerId, r ? 1 / ((2 ** r.entries) * (1 + r.frontLoad)) : 1];
  }));
}

export function weightedUniteOrder(m, helpers) {
  const state = stateOf(m);
  if (!state.roundWeights.has(m.round)) state.roundWeights.set(m.round, uniteFairnessWeights(m));
  const weights = state.roundWeights.get(m.round);
  const pool = [...new Map(helpers.map(p => [p.playerId, p])).values()].sort((a, b) => a.seat - b.seat
    || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0));
  const rng = createRng(deriveSeed(m.seed, 'unite-order:' + m.round));
  const ordered = [];
  for (let remaining = pool.length; remaining > 0; remaining--) {
    const chosen = rng.weighted(pool, p => weights.get(p.playerId) ?? 1);
    ordered.push(chosen);
    pool.splice(pool.indexOf(chosen), 1);
  }
  // Stable partition before helper limits are applied: eligible humans always get the earlier slots.
  // Preserve the lottery and RNG consumption, including all-human and all-AI rooms.
  return [...ordered.filter(p => !p.isBot), ...ordered.filter(p => p.isBot)];
}

/** Settle once, based on actual non-synthetic waves, not on unused queue positions. */
export function recordUniteFairness(m, plan, result) {
  if (!plan) return;
  const state = stateOf(m);
  if (state.settled.has(m.round)) return;
  const ran = new Set();
  for (const wave of [...(plan.history || []), result]) {
    if (wave && !wave.synthetic) for (const pid of Object.keys(wave.perPlayer || {})) ran.add(pid);
  }
  const actual = [...(plan.usedHelpers || []), ...plan.helpers].filter(p => ran.has(p.playerId));
  const ids = [...new Set(actual.map(p => p.playerId))];
  if (!ids.length) return;
  state.settled.add(m.round);
  for (let i = 0; i < ids.length; i++) {
    const pid = ids[i], prior = state.records.get(pid) || { entries: 0, frontLoad: 0 };
    state.records.set(pid, { entries: prior.entries + 1, frontLoad: prior.frontLoad + (ids.length - i) / ids.length });
  }
}

/** One hook shared by the upstream small-room settlement and the capacity settlement. */
export function installUniteFairness(Match) {
  const settle = Match.prototype.settle;
  Match.prototype.settle = function (...args) {
    recordUniteFairness(this, args[0], args[1]);
    return settle.apply(this, args);
  };
}
