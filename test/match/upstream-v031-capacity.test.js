import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { readOfferFile, readOfferCards } from '../../shared/plugins/offers.js';

const ITEM = 'chess_item_5_07_e_a';

test('displayed equipment debt and repayment stay in the receiving fixed group', t => {
  const h = makeMatch({ humans: 8, fake: true }).start().toPrep();
  t.after(() => h.m.dispose());
  const a = h.ps('p_0'), b = h.ps('p_1'), other = h.ps('p_4');
  const pool = h.m.itemPoolFor(a), peer = h.m.itemPoolFor(other);
  assert.equal(pool.cap(ITEM), 2);
  assert.ok(a.acquireItem(ITEM));
  assert.ok(b.acquireItem(ITEM));
  assert.equal(pool.left(ITEM), 0);
  b.shop.slots[0] = { kind: 'item', id: ITEM, basePrice: 0, sold: false };
  assert.deepEqual(b.buy(0), { ok: true });
  assert.equal(pool.held(ITEM), 3);
  assert.equal(pool.debtOf(ITEM), 1);
  assert.equal(peer.left(ITEM), 2);
  assert.equal(peer.debtOf(ITEM), 0);
  assert.equal(pool.pick(h.m.rngShop, [ITEM]), null, 'new draws still exclude the depleted group stock');
  const item = a.hand.find(p => p?.kind === 'item' && p.id === ITEM);
  assert.ok(item);
  assert.deepEqual(a.destroy(item.uid), { ok: true });
  assert.equal(pool.debtOf(ITEM), 0);
  assert.equal(pool.left(ITEM), 0);
  assert.equal(peer.left(ITEM), 2);
  h.invariants();
});

test('a plugin equipment offer reads the recipient group instead of the first group', t => {
  const h = makeMatch({ humans: 8, fake: true }).start().toPrep();
  t.after(() => h.m.dispose());
  h.ps('p_0').acquireItem(ITEM);
  h.ps('p_1').acquireItem(ITEM);
  const raw = readOfferFile({ offer: 1, id: 'group-stock', when: { at: ['prep'], rounds: [1] }, windowSec: 30,
    quorum: 'all', slots: 1, options: { source: 'cards.json' }, apply: { item: ITEM } }, { pluginId: 'capacity-test' });
  assert.deepEqual(raw.problems, []);
  const cards = readOfferCards([{ id: 'item', name: 'Item', desc: 'Grant', icon: 'funds' }], raw.offer);
  assert.deepEqual(cards.problems, []);
  h.m.offers = [{ pluginId: 'capacity-test', ...raw.offer, cards: cards.cards }];
  assert.equal(h.m.openOfferWindow('prep', 1), 'open');
  const view = h.m.offerViews()[0];
  assert.equal(view.seats.find(p => p.playerId === 'p_0').slots[0].available, false);
  assert.equal(view.seats.find(p => p.playerId === 'p_4').slots[0].available, true);
  assert.deepEqual(h.m.requestOffer(h.ps('p_4'), 'group-stock', 0), { ok: true });
  assert.equal(h.m.itemPoolFor('p_4').held(ITEM), 1);
  assert.equal(h.m.itemPoolFor('p_0').held(ITEM), 2);
  h.invariants();
});

test('test-mode timers hold every strategy group and resume independent group turns', t => {
  const h = makeMatch({ humans: 20, fake: true, test: true }).start();
  t.after(() => h.m.dispose());
  for (const p of h.m.order) h.m.handle(p.playerId, { t: 'g.infoReady' });
  h.runToPhase(PHASE.BAND_DRAFT);
  assert.equal(h.m.draft.groups.length, 5);
  assert.deepEqual(h.m.handle('p_0', { t: 'g.test', cmd: 'timers', args: { on: false } }), { ok: true });
  h.sched.advance(60000);
  assert.deepEqual(Object.keys(h.m.draft.picks), []);
  assert.ok(h.m.draft.groups.every(group => group.turnDeadline === 0));
  assert.deepEqual(h.m.handle('p_0', { t: 'g.test', cmd: 'timers', args: { on: true } }), { ok: true });
  h.sched.advance(h.m.bandTurnMs() + 1);
  assert.ok(h.m.draft.groups.every(group => Object.keys(group.picks).length === 1));
  assert.equal(h.m.errorCount, 0);
});

test('test tracing keeps the emergency clock and can freeze a twenty-seat match', t => {
  const h = makeMatch({ humans: 20, fake: true, test: true }).start().toPrep();
  t.after(() => h.m.dispose());
  const deadline = h.m.deadline;
  h.m.setEmergencyFreeze(true, { reason: 'test' });
  h.sched.advance(120000);
  assert.equal(h.m.phase, PHASE.PREP);
  assert.equal(h.m.deadline, deadline);
  h.m.setEmergencyFreeze(false, {});
  assert.equal(h.m.deadline, deadline + 120000);
  assert.equal(h.m.errorCount, 0);
});
