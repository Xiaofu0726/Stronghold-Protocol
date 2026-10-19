import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { validateData } from '../../shared/plugins/validate.js';

function configured(modeId, fixedBandId) {
  return { ...DATA, config: { ...DATA.config, modes: { ...DATA.config.modes,
    [modeId]: { ...DATA.config.modes[modeId], bandDraft: { fixedBandId } },
  } } };
}

for (const humans of [1, 4, 20]) for (const clientCombat of [false, true]) {
  test(`optional fixed band: ${humans} players, clientCombat=${clientCombat}`, t => {
    const mode = humans === 1 ? 'solo' : 'coop';
    const modeId = humans === 1 ? 'mode_single_normal' : 'mode_multi_normal';
    const h = makeMatch({ mode, modeId, humans, clientCombat, fake: true, data: configured(modeId, 'band_ducklord') });
    t.after(() => h.m.dispose());
    h.start();
    assert.ok(h.drive(() => h.m.phase === 'BATTLE_CHECK'));
    assert.equal(h.m.draft, null);
    for (const ps of h.m.order) {
      assert.equal(ps.bandId, 'band_ducklord');
      assert.equal(ps.lp, h.m.gd.startLp(ps.bandId));
    }
    h.invariants();
    h.toPrep(5);
    assert.equal(h.m.errorCount, 0);
    h.invariants();
  });
}

test('unconfigured mode retains the ordinary draft; another mode configuration cannot leak into it', t => {
  const h = makeMatch({ humans: 4, fake: true, data: configured('mode_single_normal', 'band_ducklord') });
  t.after(() => h.m.dispose());
  h.start();
  assert.ok(h.drive(() => h.m.phase === 'BAND_DRAFT'));
  assert.ok(h.m.draft);
  assert.equal(h.m.order.filter(p => p.bandId === 'band_ducklord').length, 0);
});

test('fixed mode assigns AI teammates as well as the human', t => {
  const h = makeMatch({ humans: 1, bots: 19, fake: true, data: configured('mode_multi_normal', 'band_ducklord') });
  t.after(() => h.m.dispose());
  h.start();
  assert.ok(h.drive(() => h.m.phase === 'BATTLE_CHECK'));
  assert.equal(h.m.order.length, 20);
  assert.ok(h.m.order.every(ps => ps.bandId === 'band_ducklord'));
  h.invariants();
});

test('content validation rejects invalid and mode-incompatible fixed bands', () => {
  for (const id of [null, 17, '', 'missing']) {
    assert.ok(validateData(configured('mode_multi_normal', id)).some(p => p.path.endsWith('.fixedBandId')));
  }
  const data = configured('mode_multi_normal', 'band_ducklord');
  data.bands = { ...data.bands, band_ducklord: { ...data.bands.band_ducklord, modeTypeList: ['SINGLE'] } };
  assert.ok(validateData(data).some(p => p.path.endsWith('.fixedBandId')));
  assert.deepEqual(validateData(configured('mode_multi_normal', 'band_ducklord')), []);
});
