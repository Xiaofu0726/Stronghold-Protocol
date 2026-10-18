import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { FEATURE, ISSUE_MARKER, prepare, verify, publish, readState, issueClient } from '../tools/sync-upstream.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const log = { info() {} };
function fixture(t, { conflict = false, unrelated = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-sync-test-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const origin = path.join(root, 'origin.git'), upstream = path.join(root, 'upstream.git'), seed = path.join(root, 'seed');
  fs.mkdirSync(seed);
  git(root, 'init', '--bare', '--initial-branch=master', origin);
  git(root, 'init', '--bare', '--initial-branch=master', upstream);
  git(seed, 'init', '--initial-branch=master');
  git(seed, 'config', 'user.name', 'Sync Test'); git(seed, 'config', 'user.email', 'test@example.invalid');
  fs.writeFileSync(path.join(seed, 'rules.txt'), 'original upstream\n');
  git(seed, 'add', '.'); git(seed, 'commit', '-m', 'base');
  const initialMaster = git(seed, 'rev-parse', 'HEAD');
  git(seed, 'remote', 'add', 'origin', origin); git(seed, 'remote', 'add', 'upstream', upstream);
  git(seed, 'push', 'origin', 'master'); git(seed, 'push', 'upstream', 'master');
  git(seed, 'switch', '-c', FEATURE);
  fs.writeFileSync(path.join(seed, conflict ? 'rules.txt' : 'capacity.txt'), '20-player feature\n');
  if (unrelated) fs.writeFileSync(path.join(seed, 'unrelated.txt'), 'not capacity\n');
  git(seed, 'add', '.'); git(seed, 'commit', '-m', 'capacity');
  const feature = git(seed, 'rev-parse', 'HEAD'); git(seed, 'push', 'origin', FEATURE);
  git(seed, 'switch', 'master');
  const cwd = path.join(root, 'runner'); git(root, 'clone', '--branch', FEATURE, origin, cwd);
  return {
    root, origin, upstream, seed, cwd, feature, initialMaster,
    head: ref => git(origin, 'rev-parse', ref),
    update() {
      fs.writeFileSync(path.join(seed, 'rules.txt'), 'new upstream rules\n');
      git(seed, 'add', '.'); git(seed, 'commit', '-m', 'upstream change'); git(seed, 'push', 'upstream', 'master');
      return git(seed, 'rev-parse', 'HEAD');
    },
  };
}

test('mirror exact upstream first; publish feature only after scope and validation pass', t => {
  const f = fixture(t), upstreamHead = f.update();
  const state = prepare({ cwd: f.cwd, upstream: f.upstream, log });
  assert.equal(state.status, 'ready');
  assert.equal(f.head('master'), upstreamHead);
  assert.equal(f.head(FEATURE), f.feature, 'merge candidate is still local');
  let checked = false;
  verify(f.cwd, { allowedPaths: ['capacity.txt'], runChecks: () => { checked = true; } });
  publish(f.cwd, { allowedPaths: ['capacity.txt'] });
  assert.equal(checked, true);
  assert.equal(git(f.origin, 'show', `${FEATURE}:rules.txt`), 'new upstream rules');
  assert.equal(git(f.origin, 'show', `${FEATURE}:capacity.txt`), '20-player feature');
  assert.equal(f.head('master'), upstreamHead);
  assert.equal(git(f.origin, 'branch', '--format=%(refname:short)').split('\n').length, 2);
});

test('text conflict keeps feature unchanged while master still exactly mirrors upstream', t => {
  const f = fixture(t, { conflict: true }), upstreamHead = f.update();
  assert.throws(() => prepare({ cwd: f.cwd, upstream: f.upstream, log }), /git .+ failed/);
  assert.equal(f.head('master'), upstreamHead);
  assert.equal(f.head(FEATURE), f.feature);
  assert.deepEqual(readState(f.cwd).conflicts, ['rules.txt']);
  assert.equal(readState(f.cwd).stage, 'merge-feature');
  assert.equal(git(f.cwd, 'rev-parse', 'HEAD'), f.feature);
  assert.equal(git(f.cwd, 'status', '--porcelain'), '');
});

test('an unapproved path blocks publication without running tests on the candidate', t => {
  const f = fixture(t, { unrelated: true }); f.update();
  prepare({ cwd: f.cwd, upstream: f.upstream, log });
  let called = false;
  assert.throws(() => verify(f.cwd, { allowedPaths: ['capacity.txt'], runChecks: () => { called = true; } }), /unrelated.txt/);
  assert.equal(called, false);
  assert.throws(() => publish(f.cwd, { allowedPaths: ['capacity.txt'] }), /unverified/);
  assert.equal(f.head(FEATURE), f.feature);
});

test('failed validation never advances the feature branch', t => {
  const f = fixture(t); f.update(); prepare({ cwd: f.cwd, upstream: f.upstream, log });
  assert.throws(() => verify(f.cwd, { allowedPaths: ['capacity.txt'], runChecks: () => { throw new Error('four-player parity changed'); } }), /parity changed/);
  assert.equal(f.head(FEATURE), f.feature);
  assert.equal(readState(f.cwd).stage, 'validation');
});

test('concurrent feature commits are preserved by the publish lease', t => {
  const f = fixture(t); f.update(); prepare({ cwd: f.cwd, upstream: f.upstream, log });
  verify(f.cwd, { allowedPaths: ['capacity.txt'], runChecks() {} });
  const tree = git(f.origin, 'rev-parse', `${f.feature}^{tree}`);
  const concurrent = git(f.origin, '-c', 'user.name=Sync Test', '-c', 'user.email=test@example.invalid', 'commit-tree', tree, '-p', f.feature, '-m', 'concurrent edit');
  git(f.origin, 'update-ref', `refs/heads/${FEATURE}`, concurrent);
  assert.throws(() => publish(f.cwd, { allowedPaths: ['capacity.txt'] }), /push failed/);
  assert.equal(f.head(FEATURE), concurrent);
});

test('master moving during verification blocks stale feature publication', t => {
  const f = fixture(t); f.update(); prepare({ cwd: f.cwd, upstream: f.upstream, log });
  verify(f.cwd, { allowedPaths: ['capacity.txt'], runChecks() {} });
  git(f.origin, 'update-ref', 'refs/heads/master', f.initialMaster);
  assert.throws(() => publish(f.cwd, { allowedPaths: ['capacity.txt'] }), /master changed/);
  assert.equal(f.head(FEATURE), f.feature);
});

test('rewritten upstream is mirrored but requires manual feature rebase', t => {
  const f = fixture(t);
  git(f.seed, 'switch', '--orphan', 'replacement');
  fs.writeFileSync(path.join(f.seed, 'rules.txt'), 'rewritten upstream\n');
  git(f.seed, 'add', '.'); git(f.seed, 'commit', '-m', 'new root');
  const replacement = git(f.seed, 'rev-parse', 'HEAD');
  git(f.seed, 'push', '--force', 'upstream', 'HEAD:master');
  assert.throws(() => prepare({ cwd: f.cwd, upstream: f.upstream, log }), /history was rewritten/);
  assert.equal(f.head('master'), replacement);
  assert.equal(f.head(FEATURE), f.feature);
});

test('unchanged upstream creates no commits, while manual validation can still be requested', t => {
  const f = fixture(t);
  assert.equal(prepare({ cwd: f.cwd, upstream: f.upstream, log }).status, 'unchanged');
  assert.equal(f.head(FEATURE), f.feature);
  assert.equal(prepare({ cwd: f.cwd, upstream: f.upstream, forceValidation: true, log }).status, 'ready');
  assert.throws(() => publish(f.cwd, { allowedPaths: ['capacity.txt'] }), /unverified/);
});

test('one issue per ongoing failure; unchanged failures do not update it; recovery closes it', async () => {
  let issue = null, next = 1;
  const mutations = [];
  const request = async (url, options) => {
    const route = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    if (options.method === 'POST') { issue = { ...body, number: next++, state: 'open' }; mutations.push('create'); }
    if (options.method === 'PATCH') { Object.assign(issue, body); mutations.push(body.state === 'closed' ? 'close' : 'update'); }
    return { ok: true, status: 200, json: async () => options.method === 'GET' ? (issue?.state === 'open' ? [issue] : []) : issue, route };
  };
  const client = issueClient({ repository: 'example/repo', token: 'fixture-only', request });
  const state = { stage: 'merge-feature', master: 'abc', originalFeature: 'def', conflicts: ['file.js'], error: 'conflict' };
  await client.report(state, 'https://example.invalid/run/1');
  await client.report(state, 'https://example.invalid/run/2');
  assert.deepEqual(mutations, ['create']);
  assert.ok(issue.body.includes(ISSUE_MARKER)); assert.ok(issue.body.includes('file.js'));
  await client.report({ ...state, master: 'new' }, 'https://example.invalid/run/3');
  await client.close();
  assert.deepEqual(mutations, ['create', 'update', 'close']);
});
