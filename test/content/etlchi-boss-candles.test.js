import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { SharedBossPool } from '../../server/match/finalAssault.js';
import { BOSS_HIT_LIMIT } from '../../shared/constants.js';

const OP = 'chess_char_5_06_a';
function field({ kind = 'boss', chessId = OP, pool = new SharedBossPool(1e6), enemies = [{ key: 'e_boss', pos: [2, 5], tag: 'boss' }] } = {}) {
  return makeBattle({ kind, sharedBoss: pool, units: [{ chessId, row: 9, col: 4 }],
    defs: { enemies: {
      e_boss: enemyRec({ key: 'e_boss', hp: 1e6, speed: 0, def: 123, res: 25 }),
      e_normal: enemyRec({ key: 'e_normal', hp: 1e5, speed: 0 }),
      e_fly: enemyRec({ key: 'e_fly', hp: 1e6, speed: 0, motion: 'FLY' }),
    } }, enemies, autoFinish: false, timeLimit: 60 });
}
function cast(h, id = OP) {
  const u = h.unit(id);
  u.skill.gainSp(1000);
  assert.ok(u.skill.activate('manual'));
  return u;
}
const candles = (h, u) => h.b.enemies.filter(e => e.alive && e.mem.candleOwner === u);

for (const kind of ['boss', 'hidden']) for (const chessId of [OP, 'chess_char_5_06_b']) {
  test(kind + ' ' + chessId + ': Boss-only S3 creates a candle from current HP and transfers each hit exactly once', () => {
    const pool = new SharedBossPool(1e6);
    pool.hp = 600000;
    const h = field({ kind, chessId, pool });
    h.step();
    const boss = h.b.enemies.find(e => e.isBoss);
    const current = boss.hp;
    const u = cast(h, chessId), list = candles(h, u);
    assert.equal(list.length, 1);
    const candle = list[0];
    assert.equal(candle.mem.candleOf, boss);
    assert.equal(candle.s.maxHp, current * u.def.skill.bb['attack@max_hp_scale']);
    assert.equal(candle.s.def, boss.s.def);
    assert.equal(candle.s.res, boss.s.res);
    assert.equal(candle.counted, false);
    const before = pool.hp, credit = pool.byPlayer.get(u.ownerId) || 0;
    const dealt = h.b.dealDamage(u, candle, { amount: 1000, type: 'true', isAttack: true });
    assert.equal(dealt, 1000);
    assert.equal(before - pool.hp, dealt, 'one candle hit costs the shared pool once');
    assert.equal(pool.byPlayer.get(u.ownerId) - credit, dealt, 'Boss damage belongs to the caster');
    const protectedHp = candle.hp, p = pool.hp;
    assert.equal(h.b.dealDamage(null, candle, { amount: 1000, type: 'true' }), 0);
    assert.equal(candle.hp, protectedHp);
    assert.equal(pool.hp, p);
    u.skill.end();
    assert.equal(candles(h, u).length, 0);
    assert.equal(pool.hp, p, 'removing candles at skill end causes no extra Boss loss');
    assert.equal(h.b.errorCount, 0);
  });
}

test('automatic S3 now creates a candle when only a Boss is in range', () => {
  const h = field(); h.step(); const u = h.unit(OP); u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 3));
  assert.equal(candles(h, u).length, 1);
});

test('two Boss bodies sharing one pool can each have a candle without multiplying a single hit', () => {
  const h = field({ enemies: [{ key: 'e_boss', pos: [2, 5], tag: 'boss' }, { key: 'e_boss', pos: [3, 5], tag: 'boss' },
    { key: 'e_normal', pos: [2, 6] }, { key: 'e_normal', pos: [3, 6] }] });
  h.step(); const u = cast(h), list = candles(h, u);
  assert.equal(list.length, 3, 'the existing total target limit is preserved');
  assert.equal(list.filter(c => c.mem.candleOf.isBoss).length, 2, 'Bosses join the ordinary HP ranking');
  assert.equal(new Set(list.map(c => c.mem.candleOf)).size, 3);
  const before = h.b.sharedBoss.hp;
  const dealt = h.b.dealDamage(u, list[0], { amount: 1000, type: 'true' });
  assert.equal(before - h.b.sharedBoss.hp, dealt);
});

test('Boss candles preserve leader hit-limit checks and disappear with their original', () => {
  const h = field(); h.step(); const u = cast(h), candle = candles(h, u)[0];
  const before = h.b.sharedBoss.hp;
  assert.equal(h.b.dealDamage(u, candle, { amount: BOSS_HIT_LIMIT, type: 'true' }), BOSS_HIT_LIMIT);
  assert.equal(h.b.sharedBoss.hp, before, 'a transferred hit at the leader limit is still rejected');
  h.b.kill(candle.mem.candleOf, null);
  assert.equal(candle.alive, false);
  assert.equal(h.b.errorCount, 0);
});

test('flying and untargetable enemies still cannot receive candles', () => {
  const h = field({ enemies: [{ key: 'e_boss', pos: [2, 5], tag: 'boss' }, { key: 'e_fly', pos: [2, 6] },
    { key: 'e_normal', pos: [3, 5] }] });
  h.step(); const boss = h.b.enemies.find(e => e.isBoss);
  h.b.addBuff(boss, { key: 'test:untargetable', persist: true, flags: { untargetable: true } });
  const u = cast(h), list = candles(h, u);
  assert.equal(list.length, 1);
  assert.equal(list[0].mem.candleOf.defId, 'enemy_e_normal');
});
