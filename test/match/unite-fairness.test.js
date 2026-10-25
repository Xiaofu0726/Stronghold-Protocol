import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weightedUniteOrder, recordUniteFairness, uniteFairnessWeights, uniteFairnessRecords, installUniteFairness } from '../../server/match/capacity/uniteFairness.js';
import { capacityUnitePlan, nextUnitePlan } from '../../server/match/capacity/unite.js';
import { helperOrder, planUnite } from '../../server/match/unite.js';
import { createRng, deriveSeed } from '../../server/sim/rng.js';
import { makeMatch } from './harness.js';

const players = n => Array.from({ length: n }, (_, seat) => ({ playerId: 'p_' + seat, seat }));
const match = (n = 20) => ({ seed: 123, round: 1, order: players(n) });
const result = helpers => ({ perPlayer: Object.fromEntries(helpers.map(p => [p.playerId, {}])) });
const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, a + ' != ' + b);

test('five actual helpers yield the promised weights, reserves remain at one, and repeated settlement is idempotent', () => {
  const m = match(), actual = m.order.slice(0, 5), plan = { helpers: actual, reserveHelpers: m.order.slice(5) };
  recordUniteFairness(m, plan, result(actual));
  const weights = uniteFairnessWeights(m);
  for (let i = 0; i < 5; i++) approx(weights.get('p_' + i), 1 / (2 * (2 - i / 5)));
  for (let i = 5; i < 20; i++) assert.equal(weights.get('p_' + i), 1);
  const before = [...uniteFairnessRecords(m)];
  recordUniteFairness(m, plan, result(actual));
  assert.deepEqual([...uniteFairnessRecords(m)], before);
  m.round++;
  recordUniteFairness(m, { helpers: [m.order[0], m.order[5]] }, result([m.order[0], m.order[5]]));
  assert.deepEqual(uniteFairnessRecords(m).get('p_0'), { entries: 2, frontLoad: 2 });
  assert.deepEqual(uniteFairnessRecords(m).get('p_5'), { entries: 1, frontLoad: 0.5 });
  assert.equal(uniteFairnessWeights(m).get('p_6'), 1);
  assert.equal(uniteFairnessWeights(match()).get('p_0'), 1, 'new matches never inherit records');
});

test('only actual valid waves count; failed waves and normal rounds cannot penalize a reserve', () => {
  const m = match(), first = m.order.slice(0, 2), failed = m.order.slice(2, 4);
  recordUniteFairness(m, { helpers: failed, usedHelpers: first, history: [result(first)] }, { synthetic: true, perPlayer: result(failed).perPlayer });
  assert.equal(uniteFairnessRecords(m).size, 2);
  assert.equal(uniteFairnessWeights(m).get('p_2'), 1);
  m.round++;
  recordUniteFairness(m, null, null);
  recordUniteFairness(m, { helpers: failed }, { synthetic: true });
  assert.equal(uniteFairnessRecords(m).size, 2);
});

test('weights change odds rather than imposing a ranking: both low and high weights can lead', () => {
  const m = match(6), entered = m.order.slice(0, 5);
  recordUniteFairness(m, { helpers: entered }, result(entered));
  m.round = 2;
  const candidates = [m.order[0], m.order[4], m.order[5]], counts = new Map(candidates.map(p => [p.playerId, 0]));
  const weights = uniteFairnessWeights(m), total = candidates.reduce((sum, p) => sum + weights.get(p.playerId), 0);
  for (let seed = 1; seed <= 6000; seed++) {
    m.seed = seed;
    const order = weightedUniteOrder(m, candidates);
    assert.equal(new Set(order).size, candidates.length);
    counts.set(order[0].playerId, counts.get(order[0].playerId) + 1);
    assert.deepEqual(weightedUniteOrder(m, candidates.slice().reverse()), order, 'input order cannot favor a seat');
  }
  for (const p of candidates) {
    const observed = counts.get(p.playerId) / 6000, expected = weights.get(p.playerId) / total;
    assert.ok(Math.abs(observed - expected) < 0.025, JSON.stringify({ observed, expected }));
    assert.ok(counts.get(p.playerId) > 0 && counts.get(p.playerId) < 6000);
  }
  assert.ok(counts.get('p_5') > counts.get('p_4') && counts.get('p_4') > counts.get('p_0'));
});

test('a fixed eight-round window gives more different helpers a real entry opportunity than uniform randomness', () => {
  let fairCoverage = 0, uniformCoverage = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const m = match(); m.seed = seed;
    const eligible = m.order.slice(0, 19), fair = new Set(), uniform = new Set();
    for (m.round = 1; m.round <= 8; m.round++) {
      const helpers = weightedUniteOrder(m, eligible).slice(0, 2);
      for (const p of helpers) fair.add(p.playerId);
      recordUniteFairness(m, { helpers }, result(helpers));
      const reference = createRng(deriveSeed(seed, 'unite-order:' + m.round)).shuffle(eligible.slice()).slice(0, 2);
      for (const p of reference) uniform.add(p.playerId);
    }
    fairCoverage += fair.size; uniformCoverage += uniform.size;
  }
  assert.ok(fairCoverage / 300 > uniformCoverage / 300 + 1.5, JSON.stringify({ fair: fairCoverage / 300, uniform: uniformCoverage / 300 }));
});

for (const humans of [4, 8, 20]) for (const clientCombat of [false, true]) test(humans + ' seats ' + clientCombat + ': real settlement counts only entered helpers and preserves reserves', t => {
  const h = makeMatch({ humans, clientCombat, seed: 880, fake: true,
    script: b => b.kind === 'normal' ? { leaks: { p_0: 3 } } : {} }).start();
  t.after(() => h.m.dispose());
  h.toPrep(1);
  h.drive(() => h.m.phase === 'UNITE');
  const plan = h.m.unitePlan, entered = plan.helpers.map(p => p.playerId);
  const queue = [...plan.helpers, ...(plan.reserveHelpers || [])];
  h.drive(() => h.m.phase === 'SETTLE');
  assert.deepEqual([...uniteFairnessRecords(h.m).keys()], entered);
  for (let i = 0; i < entered.length; i++) {
    const r = uniteFairnessRecords(h.m).get(entered[i]);
    assert.deepEqual(r, { entries: 1, frontLoad: (entered.length - i) / entered.length });
  }
  for (const p of plan.reserveHelpers || []) assert.equal(uniteFairnessWeights(h.m).get(p.playerId), 1);
  const perfects = h.m.order.slice(1);
  assert.deepEqual(helperOrder(h.m, perfects), queue, 'the round snapshot does not reroll after recording');
  h.invariants();
});

test('all perfect defenders are candidates irrespective of army strength; leakers and imperfect clears remain ineligible', t => {
  const h = makeMatch({ humans: 20, fake: true }); t.after(() => h.m.dispose());
  const m = h.m, leak = { enemyKey: 'enemy_1007_slime', counted: true, spawned: true, lpr: 1 };
  const results = new Map(m.order.map((p, i) => [p.playerId, { leaked: i === 0 ? [leak] : [], perfect: i !== 1, unitsEnd: [] }]));
  const seen = new Set();
  for (let seed = 1; seed <= 100; seed++) {
    m.seed = seed;
    const plan = planUnite(m, results);
    for (const p of [...plan.helpers, ...plan.reserveHelpers]) {
      assert.ok(p.playerId !== 'p_0' && p.playerId !== 'p_1'); seen.add(p.playerId);
    }
  }
  assert.equal(seen.size, 18, 'even the last seats with no operators have a chance');
});


// Fairness changes identities/order only; keep all existing capacity boundaries.
test('1–20 seats retain helper and wave limits for every eligible count', () => {
  for (let seats = 1; seats <= 20; seats++) for (const configured of [1, 2, 3]) for (const bots of ['none', 'all', 'alternate']) {
    const groups = seats <= 5 ? 1 : seats <= 9 ? 2 : seats <= 13 ? 3 : seats <= 17 ? 4 : 5;
    for (let eligible = 0; eligible < seats; eligible++) {
      const m = { ...match(seats), gd: { unite: { maxHelpers: configured } }, poolGroups: Array(groups) };
      for (const p of m.order) p.isBot = bots === 'all' || (bots === 'alternate' && p.seat % 2 === 0);
      const candidates = m.order.slice(0, eligible), original = candidates.slice();
      const perWave = seats <= 4 ? configured : Math.min(2, configured);
      const limit = seats <= 4 ? configured : Math.min(10, perWave * groups);
      const ordered = helperOrder(m, candidates);
      assert.equal(ordered.length, Math.min(eligible, limit), JSON.stringify({ seats, configured, eligible }));
      assert.equal(new Set(ordered).size, ordered.length);
      assert.ok(ordered.every(p => candidates.includes(p)));
      assert.deepEqual(candidates, original);
      assert.equal(ordered.filter(p => !p.isBot).length, Math.min(candidates.filter(p => !p.isBot).length, limit));
      const firstBot = ordered.findIndex(p => p.isBot);
      if (firstBot >= 0) assert.ok(ordered.slice(firstBot).every(p => p.isBot));
      if (seats > 4 && ordered.length) {
        const plan = capacityUnitePlan(m, { helpers: ordered });
        assert.equal(plan.helpers.length, Math.min(perWave, eligible));
        assert.equal(plan.reserveHelpers.length, ordered.length - plan.helpers.length);
        assert.equal(plan.roundsMax, Math.min(groups, Math.ceil(ordered.length / perWave)));
        assert.equal(plan.round, 1);
      }
    }
  }
});

test('continuation retains stop conditions and consumes only the existing reserve queue', () => {
  const roster = players(7).map(p => ({ ...p, alive: true, left: false }));
  const leak = { enemyKey: 'enemy_a', sourcePlayerId: 'leaker', tag: null, lpr: 1, mods: null, bounty: null };
  const plan = { helpers: roster.slice(0, 2), reserveHelpers: roster.slice(2), usedHelpers: [], history: [],
    round: 1, roundsMax: 3, perRound: 2, skipRemaining: false, skipVotes: new Set(),
    leakers: [{ playerId: 'leaker' }], leaked: [leak], notReentered: new Map() };
  const wave = { perPlayer: { p_0: { leaked: [leak] }, p_1: { leaked: [] } } };
  const before = structuredClone(plan), waveBefore = structuredClone(wave);
  const next = nextUnitePlan(plan, wave);
  assert.deepEqual(next.helpers, roster.slice(2, 4));
  assert.deepEqual(next.reserveHelpers, roster.slice(4));
  assert.equal(next.round, 2);
  assert.equal(next.roundsMax, 3);
  assert.deepEqual(plan, before);
  assert.deepEqual(wave, waveBefore);
  for (const stopped of [null, { ...plan, skipRemaining: true }, { ...plan, round: 3 },
    { ...plan, reserveHelpers: [] }, { ...plan, reserveHelpers: roster.slice(2).map(p => ({ ...p, left: true })) },
    { ...plan, reserveHelpers: roster.slice(2).map(p => ({ ...p, alive: false })) }]) {
    assert.equal(nextUnitePlan(stopped, wave), null);
  }
  assert.equal(nextUnitePlan(plan, null), null);
  assert.equal(nextUnitePlan(plan, { ...wave, synthetic: true }), null);
  assert.equal(nextUnitePlan(plan, { perPlayer: { p_0: { leaked: [] } } }), null);
});

test('fairness settlement forwards original receiver, arguments and result without mutating game inputs', () => {
  const marker = Symbol('original settlement result');
  let seen;
  class OriginalMatch {
    settle(...args) { seen = { receiver: this, args }; return marker; }
  }
  installUniteFairness(OriginalMatch);
  const m = Object.assign(new OriginalMatch(), match(4));
  const plan = { helpers: m.order.slice(0, 2), reserveHelpers: m.order.slice(2), history: [], usedHelpers: [] };
  const wave = result(plan.helpers), extra = { unchanged: true };
  const before = structuredClone({ plan, wave, order: m.order, extra });
  assert.equal(m.settle(plan, wave, extra), marker);
  assert.equal(seen.receiver, m);
  assert.equal(seen.args[0], plan);
  assert.equal(seen.args[1], wave);
  assert.equal(seen.args[2], extra);
  assert.equal(seen.args.length, 3);
  assert.deepEqual({ plan, wave, order: m.order, extra }, before);
});


test('human priority is absolute even when an AI has a higher fairness weight; group lottery order stays intact', () => {
  const m = match(6);
  m.order.forEach(p => { p.isBot = p.seat % 2 === 0; });
  // Penalize two humans and one AI; untouched AI still cannot overtake any human.
  const entered = [m.order[1], m.order[2], m.order[3]];
  recordUniteFairness(m, { helpers: entered }, result(entered));
  m.round++;
  assert.ok(uniteFairnessWeights(m).get('p_0') > uniteFairnessWeights(m).get('p_1'));
  const leaders = new Map([[false, new Set()], [true, new Set()]]);
  for (let seed = 1; seed <= 1000; seed++) {
    m.seed = seed;
    const before = structuredClone(m.order);
    const order = weightedUniteOrder(m, [...m.order].reverse());
    const humans = order.filter(p => !p.isBot), bots = order.filter(p => p.isBot);
    assert.deepEqual(order, [...humans, ...bots]);
    assert.equal(order.length, m.order.length);
    assert.equal(new Set(order).size, m.order.length);
    // An all-human reference reproduces the previous unpartitioned weighted lottery.
    const reference = weightedUniteOrder(m, m.order.map(p => ({ ...p, isBot: false })));
    for (const isBot of [false, true]) {
      const ids = order.filter(p => !!p.isBot === isBot).map(p => p.playerId);
      const expected = reference.filter(p => !!m.order.find(x => x.playerId === p.playerId).isBot === isBot).map(p => p.playerId);
      assert.deepEqual(ids, expected, 'partition must not reorder a group or consume more RNG');
      leaders.get(isBot).add(ids[0]);
    }
    assert.deepEqual(m.order, before, 'ordering must not mutate player state');
  }
  assert.equal(leaders.get(false).size, 3, 'weights remain probabilistic among humans');
  assert.equal(leaders.get(true).size, 3, 'weights remain probabilistic among AI');
});

for (const seats of [4, 8, 20]) for (const clientCombat of [false, true]) {
  test(seats + ' mixed seats ' + clientCombat + ': human helper precedes AI in actual waves and fairness settlement', t => {
    const h = makeMatch({ humans: 2, bots: seats - 2, clientCombat, seed: 880, fake: true,
      script: b => b.kind === 'normal' ? { leaks: { p_0: 3 } } : { survivors: { p_0: 1 } } }).start();
    t.after(() => h.m.dispose());
    h.toPrep(1);
    h.drive(() => h.m.phase === 'UNITE');
    const first = h.m.unitePlan;
    const queue = [...first.helpers, ...(first.reserveHelpers || [])];
    assert.equal(queue[0].playerId, 'p_1');
    assert.ok(queue.slice(1).every(p => p.isBot));
    const groups = h.m.poolGroups.length;
    const limit = seats <= 4 ? 2 : Math.min(10, groups * 2);
    assert.equal(queue.length, Math.min(seats - 1, limit));
    assert.equal(first.helpers.length, 2);
    if (seats > 4) assert.equal(first.roundsMax, Math.min(groups, Math.ceil(queue.length / 2)));
    h.drive(() => h.m.phase === 'SETTLE');
    assert.deepEqual([...uniteFairnessRecords(h.m).keys()], queue.map(p => p.playerId));
    h.invariants();
  });
}
