import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, planMerge } from './upstream-sync.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-sync-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('sp-sync-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const run = args => git(args, { cwd: root });
  run(['init', '--initial-branch=multiplayer']);
  run(['config', 'user.name', 'Sync Test']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(root, 'rules'), 'four\n');
  run(['add', '.']); run(['commit', '-m', 'base']);
  run(['branch', 'upstream']);
  return { root, run, write: (file, value) => fs.writeFileSync(path.join(root, file), value),
    commit: () => { run(['add', '.']); run(['commit', '-m', 'change']); return run(['rev-parse', 'HEAD']); } };
}

test('already synchronized history stays unchanged', t => {
  const h = fixture(t), head = h.run(['rev-parse', 'HEAD']);
  assert.equal(planMerge(h.root, head).state, 'current');
  assert.equal(h.run(['rev-parse', 'HEAD']), head);
});

test('clean merge preserves multiplayer changes and records both parents', t => {
  const h = fixture(t);
  h.write('capacity', '20\n'); const base = h.commit();
  h.run(['switch', 'upstream']); h.write('plugin', 'enabled\n'); const incoming = h.commit();
  h.run(['switch', 'multiplayer']);
  const state = planMerge(h.root, incoming);
  assert.equal(state.state, 'ready'); assert.equal(state.base, base);
  assert.equal(fs.readFileSync(path.join(h.root, 'capacity'), 'utf8'), '20\n');
  assert.equal(fs.readFileSync(path.join(h.root, 'plugin'), 'utf8'), 'enabled\n');
  assert.deepEqual(h.run(['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').slice(1), [base, incoming]);
  assert.equal(h.run(['status', '--porcelain']), '');
});

test('conflict is listed and aborted with the multiplayer branch intact', t => {
  const h = fixture(t);
  h.write('rules', 'twenty grouped\n'); const base = h.commit();
  h.run(['switch', 'upstream']); h.write('rules', 'four plugins\n'); const incoming = h.commit();
  h.run(['switch', 'multiplayer']);
  const state = planMerge(h.root, incoming);
  assert.equal(state.state, 'conflict'); assert.deepEqual(state.conflicts, ['rules']);
  assert.equal(h.run(['rev-parse', 'HEAD']), base);
  assert.equal(fs.readFileSync(path.join(h.root, 'rules'), 'utf8'), 'twenty grouped\n');
  assert.equal(h.run(['status', '--porcelain']), '');
});

test('dirty worktree is rejected without deleting local work', t => {
  const h = fixture(t); h.write('local-note', 'keep\n');
  assert.throws(() => planMerge(h.root, h.run(['rev-parse', 'HEAD'])), /must be clean/);
  assert.equal(fs.readFileSync(path.join(h.root, 'local-note'), 'utf8'), 'keep\n');
});
