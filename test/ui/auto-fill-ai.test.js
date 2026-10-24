import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutoFillAiToggle, autoFillAiOption } from '../../public/js/ui/capacity/autoFillAi.js';

const room = { mode: 'coop', hostId: 'host', autoFillAi: false };
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const found = find(child, predicate); if (found) return found; }
  return null;
}
test('auto-fill checkbox: host edits, guests only view, solo hides, old servers default off', () => {
  assert.equal(autoFillAiOption(null, 'host'), null);
  assert.equal(autoFillAiOption({ ...room, mode: 'solo' }, 'host'), null);
  assert.deepEqual(autoFillAiOption(room, 'host'), { on: false, editable: true });
  assert.deepEqual(autoFillAiOption({ ...room, autoFillAi: true }, 'guest'), { on: true, editable: false });
  assert.deepEqual(autoFillAiOption({ mode: 'coop', hostId: 'host' }, 'host'), { on: false, editable: true });
  assert.deepEqual(autoFillAiOption({ ...room, inMatch: true }, 'host'), { on: false, editable: false });
});
test('rendered checkbox exposes state, busy/guest disabling and a working toggle callback', () => {
  const calls = [];
  const render = props => AutoFillAiToggle({ room, myId: 'host', busy: null, onToggle: on => calls.push(on), ...props });
  const button = tree => find(tree, n => n.type === 'button');
  const off = button(render());
  assert.equal(off.props.role, 'checkbox');
  assert.equal(off.props['aria-checked'], 'false');
  assert.equal(off.props.disabled, false);
  off.props.onClick();
  assert.deepEqual(calls, [true]);
  const on = button(render({ room: { ...room, autoFillAi: true } }));
  assert.equal(on.props['aria-checked'], 'true');
  on.props.onClick();
  assert.deepEqual(calls, [true, false]);
  const guest = button(render({ myId: 'guest' }));
  assert.equal(guest.props.disabled, true);
  guest.props.onClick();
  assert.deepEqual(calls, [true, false]);
  assert.equal(button(render({ busy: 'autofill' })).props.disabled, true);
  assert.equal(render({ room: { ...room, mode: 'solo' } }), null);
});
