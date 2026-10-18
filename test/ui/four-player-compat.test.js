import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChoiceOverlay } from '../../public/js/ui/choiceOverlay.js';
import { normalizeSp } from '../../public/js/ui/gameLogic.js';

test('four-player and personal choices use the upstream two-tap component and numeric busy index', () => {
  const players = Array.from({ length: 4 }, (_, seat) => ({ seat, playerId: `p_${seat}` }));
  const sp = normalizeSp({ cards: ['one', 'two', 'three'], order: players.map(p => p.playerId), turn: 'p_0' }, players);
  const overlay = ChoiceOverlay({ sp, busyToken: { idx: 1, draftId: null, groupId: null } });
  assert.equal(overlay.type.name, 'UpstreamChoiceOverlay');
  assert.equal(overlay.props.busyIdx, 1);
  const personal = ChoiceOverlay({ sp, personal: true, busyIdx: 2 });
  assert.equal(personal.type, overlay.type);
  assert.equal(personal.props.busyIdx, 2);
});

test('grouped large-room choices retain the capacity component', () => {
  const overlay = ChoiceOverlay({ sp: { groups: [{ id: 1 }], ownGroupId: 1 } });
  assert.equal(overlay.type.name, 'CapacityChoiceOverlay');
});
