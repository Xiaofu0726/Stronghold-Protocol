// Two-branch maintenance. master is an exact upstream ref; only the tested feature head is published.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export const FEATURE = 'feat/20-player-rooms';
export const UPSTREAM = 'https://github.com/sganggs/Stronghold-Protocol.git';
export const ISSUE_MARKER = '<!-- stronghold-two-branch-sync -->';
const MASTER = 'refs/heads/master';
const featureRef = `refs/heads/${FEATURE}`;

function git(cwd, args) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (cause) { throw new Error(`git ${args[0]} failed: ${String(cause.stderr || cause.stdout || cause.message).slice(0, 6000)}`, { cause }); }
}
function ancestor(cwd, a, b) {
  try { git(cwd, ['merge-base', '--is-ancestor', a, b]); return true; }
  catch (error) { if (error.cause?.status === 1) return false; throw error; }
}
const statePath = cwd => path.resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'two-branch-sync.json']));
export function saveState(cwd, state) { fs.writeFileSync(statePath(cwd), JSON.stringify(state, null, 2)); }
export function readState(cwd) { return JSON.parse(fs.readFileSync(statePath(cwd), 'utf8')); }

export function assertScope(cwd, master, feature, allowedPaths = null) {
  const allowed = new Set(allowedPaths || JSON.parse(fs.readFileSync(path.join(cwd, 'tools/upstream-sync-scope.json'), 'utf8')).allowedPaths);
  const files = git(cwd, ['diff', '--name-only', '--no-renames', master, feature]).split('\n').filter(Boolean);
  const unexpected = files.filter(file => !allowed.has(file));
  if (unexpected.length) throw new Error(`Non-capacity changes relative to master:\n${unexpected.join('\n')}`);
  return files;
}

export function prepare({ cwd, upstream = UPSTREAM, forceValidation = false, log = console }) {
  if (git(cwd, ['status', '--porcelain'])) throw new Error('The sync checkout must be clean');
  const state = { stage: 'fetch', status: 'pending', conflicts: [], verified: false };
  saveState(cwd, state);
  try {
    git(cwd, ['fetch', '--no-tags', upstream, '+refs/heads/master:refs/remotes/sync-source/master']);
    git(cwd, ['fetch', '--no-tags', 'origin', `+${MASTER}:refs/remotes/origin/master`, `+${featureRef}:refs/remotes/origin/${FEATURE}`]);
    state.master = git(cwd, ['rev-parse', 'refs/remotes/sync-source/master']);
    state.previousMaster = git(cwd, ['rev-parse', 'refs/remotes/origin/master']);
    state.originalFeature = git(cwd, ['rev-parse', `refs/remotes/origin/${FEATURE}`]);
    state.stage = 'mirror-master'; saveState(cwd, state);
    if (state.previousMaster !== state.master) {
      git(cwd, ['push', 'origin', `${state.master}:${MASTER}`, `--force-with-lease=${MASTER}:${state.previousMaster}`]);
    }
    log.info(`master mirrors upstream at ${state.master}`);
    if (state.previousMaster !== state.master && !ancestor(cwd, state.previousMaster, state.master)
      && ancestor(cwd, state.previousMaster, state.originalFeature)) {
      throw new Error('Upstream history was rewritten. master is mirrored; manually rebase the capacity changes before publishing the feature branch.');
    }
    state.stage = 'merge-feature'; saveState(cwd, state);
    git(cwd, ['switch', '--detach', state.originalFeature]);
    if (!ancestor(cwd, state.master, state.originalFeature)) {
      try {
        git(cwd, ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
          'merge', '--no-ff', '-m', 'chore(sync): merge upstream master into 20-player rooms', state.master]);
      } catch (error) {
        state.conflicts = git(cwd, ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
        try { git(cwd, ['merge', '--abort']); } catch { /* preserve the original merge failure */ }
        throw error;
      }
    }
    state.head = git(cwd, ['rev-parse', 'HEAD']);
    state.status = state.head !== state.originalFeature || forceValidation ? 'ready' : 'unchanged';
    state.stage = state.status === 'ready' ? 'validation-pending' : 'unchanged';
    saveState(cwd, state);
    return state;
  } catch (error) {
    state.error = error.message; state.status = 'failed'; saveState(cwd, state); throw error;
  }
}

export function verify(cwd, { allowedPaths, runChecks = runValidation } = {}) {
  const state = readState(cwd);
  if (state.status !== 'ready' || git(cwd, ['rev-parse', 'HEAD']) !== state.head) throw new Error('No prepared feature head to verify');
  try {
    state.stage = 'scope-check'; saveState(cwd, state);
    assertScope(cwd, state.master, state.head, allowedPaths);
    state.stage = 'validation'; saveState(cwd, state);
    runChecks(cwd, state.master);
    if (git(cwd, ['status', '--porcelain'])) throw new Error('Validation modified tracked source files');
    state.verified = true; state.stage = 'verified'; saveState(cwd, state);
    return state;
  } catch (error) { state.error = error.message; state.status = 'failed'; saveState(cwd, state); throw error; }
}

function node(cwd, args) { execFileSync(process.execPath, args, { cwd, stdio: 'inherit' }); }
function runValidation(cwd, master) {
  node(cwd, ['--test', 'test/lobby-capacity.test.js', 'test/lobby.test.js', 'test/lobby-kick.test.js',
    'test/match/*-capacity.test.js', 'test/match/unite-fairness.test.js', 'test/match/gun-entry-timing.test.js', 'test/match/four-player-compat.test.js', 'test/match/capacity-result.test.js',
    'test/ui/*.test.js', 'test/docs-consistency.test.js', 'test/docs-paths.test.js', 'test/sync-upstream.test.js']);
  node(cwd, ['tools/golden.mjs', '--jobs', '2']);
  node(cwd, ['tools/ci.mjs', '--only', 'lint,imports,typecheck']);
  node(cwd, ['tools/i18n.mjs', 'check', '--all', '--strict']);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-sync-baseline-'));
  let added = false;
  try {
    git(cwd, ['worktree', 'add', '--detach', scratch, master]); added = true;
    fs.symlinkSync(path.join(cwd, 'node_modules'), path.join(scratch, 'node_modules'), 'junction');
    node(scratch, ['tools/vendor.mjs']);
    node(cwd, ['tools/check-four-player-parity.mjs', '--upstream', scratch, '--random-unite-order']);
  } finally {
    // Only remove this freshly created temporary worktree; never a user checkout.
    if (added) git(cwd, ['worktree', 'remove', '--force', scratch]);
    else fs.rmdirSync(scratch);
  }
}

export function publish(cwd, { allowedPaths } = {}) {
  const state = readState(cwd);
  try {
    if (!state.verified || state.status !== 'ready' || git(cwd, ['rev-parse', 'HEAD']) !== state.head) throw new Error('Refusing to publish an unverified head');
    if (!ancestor(cwd, state.originalFeature, state.head) || !ancestor(cwd, state.master, state.head)) throw new Error('Feature ancestry changed');
    assertScope(cwd, state.master, state.head, allowedPaths);
    state.stage = 'publish'; saveState(cwd, state);
    const remoteMaster = git(cwd, ['ls-remote', 'origin', MASTER]).split(/\s+/)[0];
    if (remoteMaster !== state.master) throw new Error('master changed during validation; retry on the next run');
    if (state.head !== state.originalFeature) {
      git(cwd, ['push', 'origin', `HEAD:${featureRef}`, `--force-with-lease=${featureRef}:${state.originalFeature}`]);
    }
    state.status = 'published'; state.stage = 'complete'; saveState(cwd, state);
    return state;
  } catch (error) { state.error = error.message; state.status = 'failed'; saveState(cwd, state); throw error; }
}

function conflictMarker(state) {
  if (!state.master || !state.originalFeature || !state.conflicts?.length) return null;
  const identity = [state.master, state.originalFeature, state.stage, [...new Set(state.conflicts)].sort()];
  return `<!-- stronghold-sync-conflict:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')} -->`;
}

export function issueBody(state, repository, runUrl) {
  const files = state.conflicts?.length ? state.conflicts.map(file => `- \`${file}\``).join('\n') : '无文本冲突文件；请检查运行日志中的同步或验证错误。';
  return `${ISSUE_MARKER}\n${conflictMarker(state) ? `${conflictMarker(state)}\n` : ''}自动同步暂未完成，\`feat/20-player-rooms\` 保留上次成功提交。\n\n`
    + `- 上游 master：\`${state.master || '未读取'}\`\n- 扩容分支：\`${state.originalFeature || '未读取'}\`\n- 失败阶段：\`${state.stage || 'setup'}\`\n\n`
    + `### 冲突文件\n${files}\n\n### 错误\n\`\`\`text\n${String(state.error || '工作流安装或验证步骤失败，请查看日志。').replaceAll('```', '~~~').slice(0, 6000)}\n\`\`\`\n\n`
    + `请在 \`feat/20-player-rooms\` 合入 \`origin/master\` 并处理冲突，只保留扩容差异。推送后可手动运行 Sync upstream master 工作流；恢复成功会自动关闭本 Issue。\n\n`
    + `[仓库](https://github.com/${repository}) · [首次记录的运行日志](${runUrl})\n`;
}

export function issueClient({ repository, token, request = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !token) throw new Error('Missing repository or GitHub token');
  const api = `https://api.github.com/repos/${repository}`;
  const call = async (route, method = 'GET', body) => {
    const response = await request(api + route, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json', 'User-Agent': 'Stronghold-upstream-sync' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`GitHub ${method} ${route} failed (${response.status})`);
    return response.status === 204 ? null : response.json();
  };
  const find = async () => {
    for (let page = 1; page <= 20; page++) {
      const rows = await call(`/issues?state=open&per_page=100&page=${page}`);
      const issue = rows.find(row => !row.pull_request && row.body?.includes(ISSUE_MARKER));
      if (issue) return issue;
      if (rows.length < 100) return null;
    }
    throw new Error('Issue search exceeded pagination limit');
  };
  return {
    find,
    async report(state, runUrl) {
      const existing = await find();
      // Runner paths, stderr text and run URLs do not change an unresolved merge conflict.
      const marker = conflictMarker(state);
      if (marker && existing?.body?.includes(marker)) return existing;
      // Keep the first log URL for the same failure so unchanged hourly runs do not spam issue updates.
      const firstUrl = existing?.body?.match(/首次记录的运行日志\]\(([^)]+)\)/)?.[1] || runUrl;
      const body = issueBody(state, repository, firstUrl);
      if (!existing) return call('/issues', 'POST', { title: '[upstream-sync] 上游同步或 20 人分支合入失败', body });
      return existing.body === body ? existing : call(`/issues/${existing.number}`, 'PATCH', { body });
    },
    async close() {
      const existing = await find();
      if (existing) await call(`/issues/${existing.number}`, 'PATCH', { state: 'closed', state_reason: 'completed' });
    },
  };
}

async function main() {
  const cwd = process.cwd(), mode = process.argv[2];
  const repository = process.env.GITHUB_REPOSITORY;
  const client = ['prepare', 'publish', 'report'].includes(mode)
    ? issueClient({ repository, token: process.env.SYNC_GH_TOKEN }) : null;
  if (mode === 'prepare') {
    const state = prepare({ cwd, forceValidation: process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' });
    if (state.status === 'unchanged' && await client.find()) { state.status = 'ready'; state.stage = 'validation-pending'; saveState(cwd, state); }
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `status=${state.status}\n`);
    console.log(`Sync status: ${state.status}`);
  } else if (mode === 'verify') verify(cwd);
  else if (mode === 'publish') { publish(cwd); await client.close(); }
  else if (mode === 'report') {
    let state;
    try { state = readState(cwd); } catch { state = { stage: 'setup' }; }
    const runUrl = `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
    await client.report(state, runUrl);
  } else throw new Error('Usage: node tools/sync-upstream.mjs prepare|verify|publish|report');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
