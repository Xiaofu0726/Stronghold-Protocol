import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch } from './harness.js';
import { FakeBattle } from './fakeBattle.js';
import { validateC2S } from '../../shared/protocol.js';
import { helperOrder, nextUnitePlan } from '../../server/match/unite.js';
import { uniteFairnessRecords } from '../../server/match/capacity/uniteFairness.js';

test('a unite progress frame reports every leaker in a twenty-player match', () => {
  const left = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p_${i}`, i + 1]));
  const msg = { t: 'b.progress', battleId: 'unite', gt: 1, killed: 0, total: 20, left };
  assert.equal(validateC2S(msg), null);
  assert.notEqual(validateC2S({ ...msg, left: { ...left, p_20: 1 } }), null);
});

for (const clientCombat of [false, true]) {
  test(`eight players: two ${clientCombat ? 'client' : 'server'} unite waves use four unique helpers and final survivors`, () => {
    const waveSeeds = new Map();
    const h = makeMatch({ humans: 8, fake: true, clientCombat, seed: 707,
      script: (battle) => {
        if (battle.kind === 'normal') return { leaks: { p_0: 6 } };
        if (battle.kind === 'unite') {
          if (!waveSeeds.has(battle.opts.seed)) waveSeeds.set(battle.opts.seed, waveSeeds.size + 1);
          const first = waveSeeds.get(battle.opts.seed) === 1;
          const helper = battle.players[0];
          return { survivors: { p_0: first ? 3 : 1 }, coins: { [helper]: first ? 5 : 7 }, damage: { [helper]: first ? 123 : 456 } };
        }
        return {};
      },
    }).start();
    const m = h.m;
    h.toPrep(1);
    h.ps('p_0').lp = 30;
    h.drive(() => m.phase === PHASE.UNITE && m.unitePlan.round === 1);
    const first = m.unitePlan.helpers.map((p) => p.playerId);
    const reserve = m.unitePlan.reserveHelpers.map((p) => p.playerId);
    assert.equal([...first, ...reserve].length, 4);
    assert.equal(new Set([...first, ...reserve]).size, 4);
    assert.ok([...first, ...reserve].every(pid => pid !== 'p_0' && m.players.has(pid)));
    assert.deepEqual([m.publicView().unite.round, m.publicView().unite.roundsMax], [1, 2]);
    h.drive(() => m.phase === PHASE.UNITE && m.unitePlan.round === 2);
    const second = m.unitePlan.helpers.map((p) => p.playerId);
    assert.deepEqual(second, reserve);
    assert.equal(new Set([...first, ...second]).size, 4);
    assert.equal(m.unitePlan.leaked.length, 3, 'only first-wave survivors re-enter');
    assert.deepEqual([m.publicView().unite.round, m.publicView().unite.roundsMax], [2, 2]);
    h.drive(() => m.phase === PHASE.SETTLE);
    assert.equal(new Set(FakeBattle.instances.filter((b) => b.kind === 'unite').map((b) => b.opts.seed)).size, 2);
    assert.deepEqual([...uniteFairnessRecords(m).keys()], [...first, ...second], 'all actual waves enter the same fairness history');
    assert.equal(h.ps('p_0').lp, 29, 'only the final survivor costs the original leaker LP');
    assert.equal(h.ps(first[0]).pendingFunds, 5, 'first-wave bounty credits survive second-wave settlement');
    assert.equal(h.ps(second[0]).pendingFunds, 7);
    assert.ok(h.ps(first[0]).stats.dmgDealt >= 123 && h.ps(second[0]).stats.dmgDealt >= 456);
    assert.deepEqual(m.publicView().uniteResult, {
      through: 1, helpers: [...first, ...second], leakers: ['p_0'],
      losses: Object.fromEntries(m.order.map((p) => [p.playerId, p.playerId === 'p_0' ? 1 : 0])),
    }, 'the upstream result dialog reports both waves and the actual final LP charge');
    h.invariants();
    m.dispose();
  });
}

for (const n of [7, 8, 20]) {
  test(`${n} players: unite stops when only one helper exists or the first wave clears`, () => {
    const h = makeMatch({ humans: n, fake: true, seed: 708,
      script: (battle) => battle.kind === 'normal' ? { leaks: { p_0: 3 } } : {},
    }).start();
    const m = h.m;
    h.toPrep(1);
    h.drive(() => m.phase === PHASE.SETTLE);
    assert.equal(FakeBattle.instances.filter((b) => b.kind === 'unite').length, 1);
    assert.equal(h.ps('p_0').stats.lpLost, 0);
    h.invariants();
    m.dispose();
  });
}

test('second unite wave preserves duplicate enemies by source and mods and respects a one-helper wave limit', () => {
  const leak = (sourcePlayerId, rank, coins) => ({ enemyKey: 'enemy_a', sourcePlayerId, tag: null,
    mods: { rank }, lpr: 1, bounty: { coins, ownerPlayerId: sourcePlayerId } });
  const plan = { round: 1, roundsMax: 2, perRound: 1, helpers: [{ playerId: 'h_0' }],
    reserveHelpers: [{ playerId: 'h_1', alive: true, left: false }, { playerId: 'h_2', alive: true, left: false }],
    leakers: [{ playerId: 'p_0' }, { playerId: 'p_1' }], notReentered: new Map(),
    leaked: [leak('p_0', 1, 3), leak('p_0', 2, 5), leak('p_1', 1, 7)], history: [], usedHelpers: [] };
  const result = { unspawned: [{ enemyKey: 'enemy_a', sourcePlayerId: 'p_0', tag: null }],
    perPlayer: { h_0: { leaked: [
      { enemyKey: 'enemy_a', sourcePlayerId: 'p_0', tag: null, mods: { rank: 2 } },
      { enemyKey: 'enemy_a', sourcePlayerId: 'p_1', tag: null, mods: { rank: 1 } },
    ] } } };
  const next = nextUnitePlan(plan, result);
  assert.deepEqual(nextUnitePlan(plan, result, 7), next,
    'the old living-player argument no longer lowers the opening groups\' fixed limit');
  assert.deepEqual(next.helpers.map((p) => p.playerId), ['h_1']);
  assert.deepEqual(next.reserveHelpers.map((p) => p.playerId), ['h_2']);
  assert.deepEqual(next.leaked.map((l) => [l.sourcePlayerId, l.mods.rank, l.bounty.coins]),
    [['p_0', 1, 3], ['p_0', 2, 5], ['p_1', 1, 7]]);
});

for (const humans of [1, 2, 3, 4, 8, 20]) {
  test(humans + ' players: helper order is reproducible, random and keeps selection limits', t => {
    const h = makeMatch({ humans, fake: true, seed: 123 });
    t.after(() => h.m.dispose());
    const m = h.m;
    m.round = 5;
    const candidates = m.order.slice(1);
    const ids = players => players.map(p => p.playerId);
    const first = ids(helperOrder(m, candidates, new Map()));
    const limit = humans > 4 ? Math.min(10, 2 * m.poolGroups.length) : 2;
    assert.equal(first.length, Math.min(limit, candidates.length));
    assert.ok(first.every(pid => candidates.some(p => p.playerId === pid)));
    assert.deepEqual(ids(helperOrder(m, candidates.slice().reverse(), new Map())), first);
    const streamStates = () => ['rngSetup', 'rngShop', 'rngWaves', 'rngDraft', 'rngBots', 'rngMeta'].map(k => m[k].state());
    const before = streamStates();
    const orders = new Set();
    for (let seed = 1; seed <= 32; seed++) {
      m.seed = seed;
      const order = ids(helperOrder(m, candidates, new Map()));
      assert.deepEqual(ids(helperOrder(m, candidates, new Map())), order);
      assert.equal(order.length, first.length);
      assert.equal(new Set(order).size, order.length);
      assert.ok(order.every(pid => candidates.some(p => p.playerId === pid)));
      orders.add(order.join(','));
    }
    assert.deepEqual(streamStates(), before, 'ordering consumes no existing random stream');
    if (first.length > 1) assert.ok(orders.size > 1, 'different matches can change entry order');
    m.seed = 123;
    const rounds = new Set();
    for (m.round = 1; m.round <= 20; m.round++) rounds.add(ids(helperOrder(m, candidates, new Map())).join(','));
    if (first.length > 1) assert.ok(rounds.size > 1, 'a new game round can change entry order');
  });
}
