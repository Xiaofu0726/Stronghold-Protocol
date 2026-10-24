import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData } from '../../server/match/gamedata.js';
import { buildBossWave, setupMatchWaves } from '../../server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';
import { DATA } from './harness.js';
import { makeBattle } from '../helpers/battleHarness.js';

const gun = 'enemy_9017_achunt_2';
const springs = ['enemy_9018_actrpa', 'enemy_9019_actrpb', 'enemy_9020_actrpc'];
function wave(solo = false, bossId = 'boss_9') {
  const gd = new GameData(DATA, 'mode_multi_abyss');
  const setup = setupMatchWaves(gd, createRng(8));
  return buildBossWave(gd, createRng(8), setup.factions, bossId === 'boss_9' ? 15 : 14, { solo, bossId });
}

test('only multiplayer Hidden Core Gun timing changes; source data and every other action stay intact', () => {
  for (const solo of [false, true]) {
    const w = wave(solo), tpl = DATA.waves[w.templateId];
    assert.equal(w.spawns.find(s => s.enemyKey === gun).time, 0.1);
    for (const s of w.spawns) {
      const original = tpl.spawns[s.actionIndex];
      const expected = s.enemyKey === gun ? 0.1 : original.time;
      assert.equal(s.time, expected);
      assert.equal(w.actions.find(a => a.index === s.actionIndex).time, expected);
      assert.equal(s.routeIndex, original.routeIndex);
    }
    assert.equal(tpl.spawns.find(s => s.key === gun).time, solo ? 0.1 : 10);
  }
  for (const solo of [false, true]) assert.equal(wave(solo, 'boss_2').spawns.find(s => s.tag === 'boss').time, 0);
});

for (const count of [1, 2]) test(count + ' players on a field: Gun(s) enter by 0.2 s, springs retain original targeting and transfer damage', () => {
  const w = wave(count === 1);
  const pool = { hp: 1e7, maxHp: 1e7, damage(id, amount) { this.hp -= amount; } };
  const h = makeBattle({ kind: 'hidden', routes: w.routes, setup: b => { b.opts.waveId = w.templateId; }, autoFinish: false, sharedBoss: pool,
    players: Array.from({ length: count }, (_, i) => ({ playerId: 'p' + i, colOffset: i * 8, units: [], bonds: {} })),
    enemies: w.spawns.map(s => ({ ...s, key: s.enemyKey, route: s.routeIndex })) });
  h.step();
  assert.equal(h.b.enemies.filter(e => springs.includes(e.defId)).length, 3);
  for (const e of h.b.enemies.filter(e => springs.includes(e.defId))) {
    assert.ok(!e.s.flags.untargetable && !e.s.flags.invulnerable, 'no fork entry protection remains');
  }
  h.run(0.2);
  assert.equal(h.b.enemies.filter(e => e.defId === gun && e.alive).length, count);
  const spring = h.b.enemies.find(e => e.defId === springs[0]);
  const before = pool.hp;
  const dealt = h.b.dealDamage(null, spring, { amount: 100, type: 'true', canDodge: false });
  assert.ok(dealt > 0);
  assert.equal(before - pool.hp, dealt, 'spring damage reaches the existing shared Boss pool');
  h.run(10.2);
  assert.equal(h.b.enemies.filter(e => e.defId === gun && e.alive).length, count, 'no duplicate Gun at the former 10 s entry');
  assert.equal(h.b.errorCount, 0);
});
