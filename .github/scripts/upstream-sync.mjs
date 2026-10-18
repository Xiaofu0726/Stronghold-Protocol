// Maintenance for Xiaofu0726's multiplayer fork. No third-party packages are needed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'Xiaofu0726/Stronghold-Protocol';
export const BRANCH = 'feat/IncreasePlayerCapacity';
export const UPSTREAM = 'https://github.com/sganggs/Stronghold-Protocol.git';
const MARKER = '<!-- multiplayer-upstream-sync -->';
const ISSUE_TITLE = 'Upstream master 同步需要处理';
const STATE = '.cache/upstream-sync.json';

export function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

export function planMerge(root, incoming) {
  const run = args => git(args, { cwd: root });
  if (run(['status', '--porcelain'])) throw new Error('Working tree must be clean before syncing.');
  const base = run(['rev-parse', 'HEAD']);
  try {
    run(['merge-base', '--is-ancestor', incoming, base]);
    return { state: 'current', base, upstream: incoming };
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  try {
    run(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=github-actions[bot]@users.noreply.github.com',
      'merge', '--no-ff', '--no-commit', incoming]);
  } catch (error) {
    const conflicts = run(['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
    if (!conflicts.length) throw error;
    run(['merge', '--abort']);
    return { state: 'conflict', base, upstream: incoming, conflicts };
  }
  run(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=github-actions[bot]@users.noreply.github.com',
    'commit', '-m', `chore(upstream): merge master ${incoming.slice(0, 12)}`]);
  return { state: 'ready', base, upstream: incoming, merge: run(['rev-parse', 'HEAD']) };
}

function identity() {
  if (process.env.GITHUB_REPOSITORY !== REPOSITORY) throw new Error('This workflow belongs to ' + REPOSITORY);
}

function save(state) {
  fs.mkdirSync('.cache', { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `state=${state.state}\n`);
  summary(`Sync status: **${state.state}**. Upstream: \`${state.upstream}\`.\n`);
}

function summary(value) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, value + '\n');
  console.log(value);
}

async function api(route, method = 'GET', data) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required for GitHub updates.');
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json', 'User-Agent': 'multiplayer-upstream-sync' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub ${method} ${route} returned ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function findIssue() {
  for (let page = 1; ; page++) {
    const issues = await api(`/issues?state=open&per_page=100&page=${page}`);
    const match = issues.find(issue => !issue.pull_request && issue.body?.includes(MARKER));
    if (match || issues.length < 100) return match;
  }
}

async function report(state, failure) {
  const run = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const details = state.conflicts?.length
    ? `合并存在 ${state.conflicts.length} 个冲突文件，需要结合 docs/development/UPSTREAM.md 与 DECISIONS.md 处理：\n\n` +
      state.conflicts.map(file => `- \`${file}\``).join('\n')
    : '合并、安装、验证或发布失败，请查看工作流日志；没有强制更新多人分支。';
  // Keep the marker and source hashes stable so unchanged conflicts do not create repeated notifications.
  const body = `${MARKER}\n\n维护分支：\`${BRANCH}\`\n\n上游：sganggs/Stronghold-Protocol master\n\n` +
    `上游提交：\`${state.upstream || 'fetch failed'}\`\n\n多人基线：\`${state.base || 'unknown'}\`\n\n` +
    `状态：${failure ? '验证或发布失败' : '合并冲突'}。当前维护分支保持原状。\n\n${details}\n\n` +
    '完成适配并验证后，将合并结果推送到维护分支；后续定时同步会继续检查。';
  const issue = await findIssue();
  let result = issue;
  if (!issue) result = await api('/issues', 'POST', { title: ISSUE_TITLE, body });
  else if (issue.body !== body) result = await api(`/issues/${issue.number}`, 'PATCH', { body });
  summary(`Needs attention: ${result.html_url}\n\nWorkflow: ${run}`);
}

async function closeIssue() {
  const issue = await findIssue();
  if (issue) await api(`/issues/${issue.number}`, 'PATCH', { state: 'closed', state_reason: 'completed' });
}

async function publish(state) {
  if (state.state !== 'ready' || git(['rev-parse', 'HEAD']) !== state.merge) throw new Error('Unexpected merge HEAD.');
  if (git(['status', '--porcelain'])) throw new Error('Validation changed the working tree; refusing to publish.');
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required.');
  // Credentials live only in this child's environment, never in repository config, a file, or printed arguments.
  const authorization = Buffer.from(`x-access-token:${process.env.GITHUB_TOKEN}`).toString('base64');
  const env = { ...process.env, GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authorization}` };
  const remote = `https://github.com/${REPOSITORY}.git`;
  const remoteHead = git(['ls-remote', remote, `refs/heads/${BRANCH}`], { env }).split(/\s+/)[0];
  if (remoteHead !== state.base) throw new Error('Maintenance branch changed during validation; retry with its new HEAD.');
  git(['push', remote, `HEAD:refs/heads/${BRANCH}`], { env });
  summary(`Updated ${BRANCH} to ${state.merge}.`);
  await closeIssue();
}

async function main(command) {
  identity();
  if (command === 'prepare') {
    // Persist a baseline even if the network fetch fails, so the failure report has useful context.
    save({ state: 'fetching', base: git(['rev-parse', 'HEAD']) });
    git(['fetch', '--no-tags', UPSTREAM, 'master']);
    const incoming = git(['rev-parse', 'FETCH_HEAD']);
    save(planMerge(process.cwd(), incoming));
  } else {
    const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    if (command === 'publish') await publish(state);
    else if (command === 'conflict') await report(state, false);
    else if (command === 'failure') await report(state, true);
    else if (command === 'current') await closeIssue();
    else throw new Error('Expected prepare, publish, conflict, failure, or current.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(error => {
    // Do not dump child-process errors: their environment may contain authentication information.
    console.error(error instanceof Error && error.message.startsWith('Command failed:')
      ? 'Git command failed; inspect the preceding workflow step.' : error.message);
    process.exitCode = 1;
  });
}
