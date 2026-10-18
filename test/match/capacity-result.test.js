import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InPageSimHost, WorkerSimHost } from '../../public/js/battle/simHost.js';

function hostFor(result, largeRoom) {
  const host = new InPageSimHost();
  host.largeRoom = largeRoom;
  host.battle = { result: () => result };
  host.sim = { spec: { compactResult: value => value, fitResult: value => value } };
  return host;
}

test('large-room results drop only optional unit stats before server takeover', () => {
  const leaked = [{ id: 'enemy', mods: { hp: 2 } }];
  const result = { perPlayer: { p: { leaked, unitStats: [{ name: 'x'.repeat(70000) }] } } };
  const trimmed = hostFor(result, true).compactResult({ battleId: 'b' });
  assert.deepEqual(trimmed.perPlayer.p.unitStats, []);
  assert.deepEqual(trimmed.perPlayer.p.leaked, leaked);
  assert.equal(result.perPlayer.p.unitStats.length, 1);
  assert.equal(hostFor(result, false).compactResult(), result, 'small rooms keep upstream fitting');
});

test('oversized settlement data and too many leak entries require server takeover only for large rooms', () => {
  for (const result of [
    { perPlayer: { p: { leaked: [{ mods: { text: 'x'.repeat(70000) } }] } } },
    { perPlayer: { p: { leaked: Array.from({ length: 401 }, () => ({ id: 'enemy' })) } } },
  ]) {
    assert.equal(hostFor(result, true).compactResult({ battleId: 'b' }), null);
    assert.equal(hostFor(result, false).compactResult(), result);
  }
});

test('worker receives the capacity flag only for large rooms', async () => {
  const host = new WorkerSimHost({ workerFactory: () => ({ terminate() {} }) });
  const calls = [];
  host.rpc = async (...args) => { calls.push(args); return { ev: [], state: {} }; };
  await host.start({ battleId: 'small' });
  await host.start({ battleId: 'large' }, { largeRoom: true });
  assert.deepEqual(calls, [
    ['start', [{ battleId: 'small' }]],
    ['start', [{ battleId: 'large' }, { largeRoom: true }]],
  ]);
  host.stop();
});
