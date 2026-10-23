import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { helperOrder, planUnite } from '../../server/match/unite.js';
import { bossPoolShareOf } from '../../server/match/gamedata.js';

for (const clientCombat of [false, true]) {
  test(`four players retain upstream settlement event keys (${clientCombat ? 'client' : 'server'} combat)`, t => {
    const h = makeMatch({ humans: 4, fake: true, clientCombat,
      script: battle => battle.kind === 'normal' ? { leaks: { p_0: 3 } } : { survivors: { p_0: 1 } },
    });
    t.after(() => h.m.dispose());
    const events = [];
    const dispatch = h.m.dispatch;
    h.m.dispatch = function (ps, hook, event) {
      if (hook === 'onBattleResult') events.push({ playerId: ps.playerId, event });
      return dispatch.apply(this, arguments);
    };
    h.start();
    assert.ok(h.drive(() => h.m.phase === 'SETTLE'));
    assert.equal(events.length, 4);
    for (const { event } of events) assert.deepEqual(Object.keys(event), ['result', 'lpLoss', 'perfect', 'unite']);
    assert.equal(events.find(e => e.playerId === 'p_0').event.lpLoss, 1);
    assert.deepEqual(Object.keys(h.m.unitePlan), ['helpers', 'leakers', 'leaked', 'notReentered']);
  });
}

test('four-player helper selection keeps the upstream configurable limit and plan shape', t => {
  const data = { ...DATA, config: { ...DATA.config, unite: { ...DATA.config.unite, maxHelpers: 3 } } };
  const h = makeMatch({ humans: 4, fake: true, data });
  t.after(() => h.m.dispose());
  const results = new Map(h.m.order.map((ps, i) => [ps.playerId, {
    perfect: i !== 0, unitsEnd: [], layerGains: {},
    leaked: i === 0 ? [{ enemyKey: 'enemy_1007_slime', counted: true, spawned: true, lpr: 1 }] : [],
  }]));
  const perfects = h.m.order.slice(1);
  assert.deepEqual(helperOrder(h.m, perfects, results).map(p => p.playerId).sort(), ['p_1', 'p_2', 'p_3']);
  const plan = planUnite(h.m, results);
  assert.equal(plan.helpers.length, 3);
  assert.deepEqual(Object.keys(plan), ['helpers', 'leakers', 'leaked', 'notReentered']);
});

test('four-player counts keep the upstream aliveFull override; expanded counts may exceed four', () => {
  assert.equal(bossPoolShareOf(null, { aliveFull: 2 }, false, 4), 2);
  assert.equal(bossPoolShareOf(null, { aliveFull: 2, perPlayer: false, aliveScaling: true }, false, 4), 1);
  assert.equal(bossPoolShareOf(null, null, false, 4), 4);
  assert.equal(bossPoolShareOf(null, null, false, 20), 20);
});
