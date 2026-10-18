import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runtimeImportMapCsp, SIM_WORKER_CSP } from '../server/http/csp.js';

test('runtime import maps authorize their exact bytes while keeping the page and Worker policies separate', () => {
  const map = JSON.stringify({ imports: { '/js/main.js': '/js/main.js?rv=' + 'a'.repeat(64) } });
  const policy = "default-src 'self'; script-src 'self' 'sha256-original'; worker-src 'self' blob:; object-src 'none'";
  const next = runtimeImportMapCsp(policy, Buffer.from(`<script type="importmap">${map}</script>`));
  const expected = createHash('sha256').update(map).digest('base64');
  assert.ok(next.includes(`'sha256-${expected}'`));
  assert.ok(next.includes("'sha256-original'"));
  assert.ok(next.includes("object-src 'none'"));
  assert.ok(!next.includes('unsafe-eval'));
  assert.ok(SIM_WORKER_CSP.includes("connect-src 'none'"));
  assert.equal(runtimeImportMapCsp(policy, '<html></html>'), policy);
});
