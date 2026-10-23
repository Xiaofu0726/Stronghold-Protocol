// Differential four-player match check, using the same upstream harness for both implementations.
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const arg = process.argv.indexOf('--upstream');
if (arg < 0 || !process.argv[arg + 1]) throw new Error('Usage: node tools/check-four-player-parity.mjs --upstream <clean upstream checkout>');
const randomUnite = process.argv.includes('--random-unite-order');
const base = pathToFileURL(path.resolve(process.argv[arg + 1]) + path.sep);
const scratch = fs.mkdtempSync(path.join(tmpdir(), 'sp-four-player-parity-'));
const scratchUrl = pathToFileURL(scratch + path.sep);
const fork = new URL('../', import.meta.url);
const source = fs.readFileSync(new URL('test/match/harness.js', base), 'utf8');
for (const [name, root] of [['base', base], ['fork', fork]]) {
  const text = source.replace(/from '(\.[^']+)'/g, (_, path) => `from '${new URL(path, new URL('test/match/harness.js', root)).href}'`);
  fs.writeFileSync(new URL(`./parity-harness-${name}.mjs`, scratchUrl), text);
}
const upstream = await import(new URL('parity-harness-base.mjs', scratchUrl));
const { createRng, deriveSeed } = await import(new URL('server/sim/rng.js', base));
const capacity = await import(new URL('parity-harness-fork.mjs', scratchUrl));
function run(harness, options) {
  const trace = [], hooks = [];
  const h = harness.makeMatch({ ...options, fake: true, seed: 614, script: battle => battle.kind === 'normal'
    ? { leaks: { p_0: 3 }, duration: 0.1 } : battle.kind === 'unite'
      ? { survivors: { p_0: 1 }, duration: 0.1 } : { bossDps: 1e9, duration: 0.1 } });
  // Explicit reference-model adjustment for the approved fork rule only. Production upstream files stay untouched.
  // Selection and all downstream messages, field layouts, results and existing RNG states are still compared.
  if (randomUnite && harness === upstream) {
    const startUnite = h.m.startUnite;
    h.m.startUnite = function (plan) {
      const helpers = plan.helpers.slice();
      const rng = createRng(deriveSeed(this.seed, 'unite-order:' + this.round));
      for (let i = helpers.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [helpers[i], helpers[j]] = [helpers[j], helpers[i]];
      }
      return startUnite.call(this, { ...plan, helpers });
    };
  }
  const record = (channel, msg) => { if (!['b.snap', 'b.ev'].includes(msg.t)) trace.push(JSON.stringify([channel, msg])); };
  h.onSend.push((pid, msg) => record(pid, msg));
  h.onBroadcast.push(msg => record('*', msg));
  const dispatch = h.m.dispatch;
  h.m.dispatch = function (ps, name, event) {
    if (name === 'onBattleResult') hooks.push(JSON.stringify({ pid: ps.playerId, round: this.round, event }));
    return dispatch.apply(this, arguments);
  };
  for (const ps of h.m.order) ps.lp = 500;
  h.start();
  if (options.reconnect) {
    h.toPrep(1);
    h.m.onDisconnect('p_1'); h.m.onReconnect('p_1');
    h.m.handle('p_1', { t: 'g.autoplay', on: true });
    h.m.handle('p_1', { t: 'g.autoplay', on: false });
  }
  if (options.depart) { h.toPrep(2); h.m.onLeave('p_1'); }
  assert.ok(h.drive(() => h.ended != null));
  assert.equal(h.m.errorCount, 0, JSON.stringify(h.m.errors));
  const pools = [...h.m.pool.entries];
  const debt = [...h.m.itemPool.debt];
  const rng = Object.fromEntries(Object.entries(h.m).filter(([key, value]) => key.startsWith('rng') && value?.state)
    .map(([key, value]) => [key, value.state()]));
  const result = JSON.stringify(h.ended);
  h.m.dispose();
  return { trace, hooks, pools, debt, rng, result };
}
const cases = [];
for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) for (const aiPicksLast of [false, true]) {
  cases.push({ mode: 'coop', humans: 4, bots: 0, difficulty, aiPicksLast, clientCombat: false });
  cases.push({ mode: 'coop', humans: 2, bots: 2, difficulty, aiPicksLast, clientCombat: true });
}
cases.push({ mode: 'coop', humans: 4, difficulty: 'NORMAL', reconnect: true });
cases.push({ mode: 'coop', humans: 4, difficulty: 'HARD', depart: true });
const differences = [];
for (const [i, options] of cases.entries()) {
  const a = run(upstream, options), b = run(capacity, options);
  const diff = [];
  for (const key of ['trace', 'hooks', 'pools', 'debt', 'rng', 'result']) {
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    const index = Array.isArray(a[key]) ? a[key].findIndex((v, n) => JSON.stringify(v) !== JSON.stringify(b[key][n])) : null;
    diff.push({ key, index, upstream: index != null ? a[key][index] : a[key], fork: index != null ? b[key][index] : b[key] });
  }
  const row = { referenceRule: randomUnite ? 'random-unite-order' : 'unmodified-upstream', case: i + 1, options, wireMessages: a.trace.length, identical: !diff.length, diff };
  differences.push(row);
  console.log(JSON.stringify(row));
}
for (const name of ['base', 'fork']) fs.unlinkSync(new URL(`parity-harness-${name}.mjs`, scratchUrl));
fs.rmdirSync(scratch);
console.log(`Cases: ${cases.length}, identical: ${differences.filter(r => r.identical).length}`);
process.exitCode = differences.some(r => !r.identical) ? 1 : 0;
